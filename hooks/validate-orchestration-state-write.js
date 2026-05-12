#!/usr/bin/env node
/**
 * PostToolUse hook: validate-orchestration-state-write (non-blocking, informational)
 *
 * After Write|Edit on an `orchestration-state.json` file under <artifact-root>/tasks/,
 * parse the JSON and warn (stderr) on schema violations: bad enum values, missing
 * required fields for the file's schema_version, malformed gates / stage_history.
 *
 * Why a hook (not just a skill check):
 *   The `orchestrator-state` skill is the canonical writer, but mid-session bugs
 *   or out-of-band edits can land malformed state. Catching it at Write/Edit time
 *   surfaces the issue at the boundary instead of much later at a P4 gate or
 *   resume-orchestrator scan, when the cause is harder to attribute.
 *
 * Non-blocking on purpose:
 *   - Always exits 0. The hook prints WARNING lines to stderr; downstream
 *     guards (pre-task-guard.js Phase 3/3.5, validate-artifact-chain.js,
 *     guard-chief-orchestrator-stop.js) remain the authoritative gates.
 *   - This matches the validate-summary-telemetry.js model: warn early,
 *     enforce later.
 *
 * Validation scope (intentionally narrow):
 *   1. File parses as JSON.
 *   2. Required top-level: `task_id` (string), `schema_version` (1|2|3), `phase`.
 *   3. `phase` ∈ {planning, planned, execution, blocked, complete}. `answered`
 *      is conceptual-only (direct-answer tasks never persist state) and is
 *      intentionally excluded so a stray persisted `answered` is flagged.
 *   4. `gates` is an object with `p1_approved` (boolean), `p1_revise_count` (integer ≥ 0).
 *   5. If schema_version >= 3: `stage` ∈ {intake, planning, execution, closure},
 *      `previous_stage` ∈ stage-enum ∪ {null}, `stage_history` is an array,
 *      `stage_reopen_count` is integer ≥ 0, `pending_subtasks_needing_rereview`
 *      is an array.
 *   6. Each `stage_history` entry has `stage` (string), `entered_at` (string),
 *      and `exited_at`/`exit_reason` either both null (open entry) or both set
 *      (closed entry).
 *   7. Consecutive `stage_history` entries form a valid transition per
 *      `skills/orchestrator-state/references/stage-discipline.md` →
 *      "Phase Transition Table". Invalid transitions (e.g., `execution → planned`,
 *      `closure → planning`) WARN — they signal either an orchestrator bug or
 *      out-of-band state surgery.
 *   8. If a sibling `orchestration-history.json` exists, its `task_id` matches
 *      the hot state's `task_id`. Documented in state-schemas.md as a
 *      consistency key; mismatch signals one of the two files was copied from
 *      a different task or corrupted.
 *
 * Out of scope (deferred to other hooks/skills):
 *   - Length-parity between `last_completed_seq` and history file
 *     (P4 consistency check in `orchestrator-user-gates`).
 *   - Agent-whitelist per stage at dispatch time (`pre-task-guard.js` Phase 3.5).
 *   - `gates.p1_approved_signature` shape (sha256 is a content concern, not a
 *     schema concern).
 *
 * Run:
 *   node hooks/validate-orchestration-state-write.js <file_path>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveArtifactRoot, canonicalize } = require('./lib/artifact-root');
const hookLog = require('./lib/hook-log');

const filePath = process.argv[2] || '';

if (!filePath || !fs.existsSync(filePath)) {
  process.exit(0);
}

if (path.basename(filePath) !== 'orchestration-state.json') {
  process.exit(0);
}

// Must live under <resolved-artifact-root>/tasks/.
const ARTIFACT = resolveArtifactRoot();
if (!ARTIFACT.root) {
  process.exit(0);
}
const tasksRoot = canonicalize(path.join(ARTIFACT.root, 'tasks'));
const canonicalTarget = canonicalize(path.resolve(filePath));
if (canonicalTarget !== tasksRoot && !canonicalTarget.startsWith(tasksRoot + path.sep)) {
  process.exit(0);
}

// `answered` is intentionally absent. Per
// `skills/orchestrator-state/references/state-schemas.md`, direct-answer tasks
// never persist a state file, so `phase: answered` should never appear on
// disk. Keeping it out of the enum surfaces orphan / out-of-band writes (e.g.
// a copy-paste from another task or a stale script) as WARNs at write time
// rather than letting them slip silently to a later resume-orchestrator scan.
const PHASE_ENUM = new Set([
  'planning',
  'planned',
  'execution',
  'blocked',
  'complete',
]);
const STAGE_ENUM = new Set(['intake', 'planning', 'execution', 'closure']);

// (7) Valid stage transitions per stage-discipline.md → "Phase Transition Table".
// Keys are `<from>:<to>`; only listed pairs are legal.
const VALID_STAGE_TRANSITIONS = new Set([
  'intake:planning',
  'intake:execution', // execution-trivial skips planning
  'planning:execution',
  'planning:closure', // plan-only
  'execution:closure',
  'execution:planning', // soft reopen (needs-replan / p2-replan)
  'closure:execution', // reversal
]);

function warn(msg) {
  console.error(`[validate-orchestration-state-write] WARNING: ${msg}\nFile: ${filePath}`);
}

let raw;
try {
  raw = fs.readFileSync(filePath, 'utf8');
} catch (_e) {
  // Unreadable mid-write race — no signal worth emitting.
  process.exit(0);
}

let state;
try {
  state = JSON.parse(raw);
} catch (e) {
  warn(`file is not valid JSON: ${e.message}`);
  process.exit(0);
}

if (!state || typeof state !== 'object' || Array.isArray(state)) {
  warn('top-level JSON must be an object');
  process.exit(0);
}

const issues = [];

// (2) Required top-level fields.
if (typeof state.task_id !== 'string' || state.task_id.length === 0) {
  issues.push('missing or empty `task_id` (expected string)');
}

const schemaVersion = state.schema_version;
if (![1, 2, 3].includes(schemaVersion)) {
  issues.push(
    `\`schema_version\` is ${JSON.stringify(schemaVersion)}; expected one of 1, 2, 3`,
  );
}

// (3) phase enum.
if (state.phase !== undefined && !PHASE_ENUM.has(state.phase)) {
  issues.push(
    `\`phase\` is ${JSON.stringify(state.phase)}; expected one of {${[...PHASE_ENUM].join(', ')}}`,
  );
}

// (4) gates shape.
if (state.gates !== undefined) {
  if (typeof state.gates !== 'object' || state.gates === null || Array.isArray(state.gates)) {
    issues.push('`gates` must be an object');
  } else {
    if (typeof state.gates.p1_approved !== 'boolean') {
      issues.push('`gates.p1_approved` must be a boolean');
    }
    if (
      state.gates.p1_revise_count !== undefined &&
      (!Number.isInteger(state.gates.p1_revise_count) || state.gates.p1_revise_count < 0)
    ) {
      issues.push('`gates.p1_revise_count` must be a non-negative integer');
    }
  }
}

// (5) v3 fields.
if (schemaVersion >= 3) {
  if (!STAGE_ENUM.has(state.stage)) {
    issues.push(
      `\`stage\` is ${JSON.stringify(state.stage)}; expected one of {${[...STAGE_ENUM].join(', ')}} (schema_version >= 3)`,
    );
  }
  if (state.previous_stage !== null && !STAGE_ENUM.has(state.previous_stage)) {
    issues.push(
      `\`previous_stage\` is ${JSON.stringify(state.previous_stage)}; expected null or one of {${[...STAGE_ENUM].join(', ')}}`,
    );
  }
  if (!Array.isArray(state.stage_history)) {
    issues.push('`stage_history` must be an array (schema_version >= 3)');
  } else {
    // (6) per-entry shape.
    state.stage_history.forEach((entry, idx) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        issues.push(`\`stage_history[${idx}]\` must be an object`);
        return;
      }
      if (!STAGE_ENUM.has(entry.stage)) {
        issues.push(
          `\`stage_history[${idx}].stage\` is ${JSON.stringify(entry.stage)}; expected stage-enum`,
        );
      }
      if (typeof entry.entered_at !== 'string') {
        issues.push(`\`stage_history[${idx}].entered_at\` must be an ISO-8601 string`);
      }
      const exitedAtIsNull = entry.exited_at === null || entry.exited_at === undefined;
      const exitReasonIsNull = entry.exit_reason === null || entry.exit_reason === undefined;
      if (exitedAtIsNull !== exitReasonIsNull) {
        issues.push(
          `\`stage_history[${idx}]\` is half-open: \`exited_at\` and \`exit_reason\` must be both null (open entry) or both set (closed entry)`,
        );
      }
    });

    // (7) Transition graph: consecutive entries must form a valid transition.
    // Only check pairs where both stages are well-formed — bad stages already
    // surfaced above, no need to double-flag.
    for (let i = 0; i + 1 < state.stage_history.length; i++) {
      const from = state.stage_history[i];
      const to = state.stage_history[i + 1];
      if (!from || !to || !STAGE_ENUM.has(from.stage) || !STAGE_ENUM.has(to.stage)) {
        continue;
      }
      const key = `${from.stage}:${to.stage}`;
      if (!VALID_STAGE_TRANSITIONS.has(key)) {
        issues.push(
          `invalid stage transition at \`stage_history[${i}→${i + 1}]\`: ${from.stage} → ${to.stage}. ` +
            `Valid transitions live at \`skills/orchestrator-state/references/stage-discipline.md\` → Phase Transition Table.`,
        );
      }
    }
  }
  if (
    !Number.isInteger(state.stage_reopen_count) ||
    state.stage_reopen_count < 0
  ) {
    issues.push('`stage_reopen_count` must be a non-negative integer (schema_version >= 3)');
  }
  if (!Array.isArray(state.pending_subtasks_needing_rereview)) {
    issues.push(
      '`pending_subtasks_needing_rereview` must be an array (schema_version >= 3)',
    );
  }
}

// (8) task_id parity with sibling orchestration-history.json.
// Skipped silently when history file does not yet exist (first subtask hasn't
// closed yet) or is unreadable / unparseable — those are not parity failures.
if (typeof state.task_id === 'string' && state.task_id.length > 0) {
  const historyPath = path.join(path.dirname(filePath), 'orchestration-history.json');
  if (fs.existsSync(historyPath)) {
    let historyRaw, history;
    try {
      historyRaw = fs.readFileSync(historyPath, 'utf8');
      history = JSON.parse(historyRaw);
    } catch (_e) {
      history = null;
    }
    if (
      history &&
      typeof history === 'object' &&
      typeof history.task_id === 'string' &&
      history.task_id !== state.task_id
    ) {
      issues.push(
        `task_id parity mismatch: state file has ${JSON.stringify(state.task_id)} but sibling orchestration-history.json has ${JSON.stringify(history.task_id)} — one of these files was copied from a different task or is corrupted`,
      );
    }
  }
}

if (issues.length > 0) {
  const summary = `state file has ${issues.length} schema issue${issues.length === 1 ? '' : 's'}: ${issues.join(' ; ')}`;
  warn(summary);
  hookLog.append({
    taskId: hookLog.taskIdFromFilePath(filePath),
    hook: 'validate-orchestration-state-write',
    decision: 'warn',
    reason: summary,
  });
}

process.exit(0);

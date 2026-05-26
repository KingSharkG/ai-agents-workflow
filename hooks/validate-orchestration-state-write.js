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
 * Severity split:
 *   - Structural/schema issues are non-blocking WARNs (exit 0).
 *   - Closure-invariant violations (phase=complete must pair with stage=closure,
 *     empty pending arrays, history seq parity, workflow_state agreement) are
 *     BLOCKING (exit 2). The model is expected to self-correct: re-write the
 *     state file with the missing fields before continuing. This makes the
 *     `execution → closure` stage flip and final completion contract
 *     unforgeable rather than merely advisory.
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
 *      "Stage Transition Table". Invalid transitions (e.g., `execution → planned`,
 *      `closure → planning`) WARN — they signal either an orchestrator bug or
 *      out-of-band state surgery.
 *   8. If a sibling `orchestration-history.json` exists, its `task_id` matches
 *      the hot state's `task_id`. Documented in state-schemas.md as a
 *      consistency key; mismatch signals one of the two files was copied from
 *      a different task or corrupted.
 *
 * Closure invariants (BLOCKING — exit 2 with stderr message):
 *   C1. If `phase === "complete"` then `stage === "closure"`.
 *   C2. If `phase === "complete"` then `pending_subtasks`, `blocked_gates`,
 *       `pending_user_actions` are all `[]` and `current_subtask` is null.
 *   C3. If `phase === "complete"` then `last_completed_seq` (when present)
 *       equals sibling `orchestration-history.json.completed_subtasks.length`.
 *   C4. `workflow_state` and `phase` MUST agree: workflow_state ∈ {complete,done}
 *       requires phase=complete AND stage=closure; workflow_state=blocked
 *       requires phase=blocked.
 *   C5. If `phase === "complete"` (v3+) then the LAST `stage_history` entry
 *       must have `stage === "closure"` AND be closed: both `exited_at` and
 *       `exit_reason` set, with `exit_reason ∈ {p4-approved,
 *       completed-without-p4}`. Per ORCHESTRATION.md → "Stage exit (terminal
 *       closure entry shape)", an open closure entry with `exited_at: null`
 *       at phase=complete is no longer legitimate. Also: an empty or missing
 *       `stage_history` at phase=complete is a violation (cannot verify
 *       closure protocol ran).
 *   C6. If `phase === "planned"` (v3+) then `stage === "closure"`. Plan-only
 *       terminal state lives in closure with an OPEN closure entry; without
 *       this check, a write of phase=planned with stage != closure is only
 *       caught at SubagentStop time.
 *   C7. needs-replan follow-through (v3+): when `current_subtask`'s
 *       `summary.md` carries `review_verdict: needs-replan`, the state file
 *       MUST acknowledge it on this write — either by transitioning to
 *       `stage="planning"` (the soft reopen path) or by recording a
 *       `pending_user_actions` / `blocked_gates` entry referencing the
 *       replan / reopen decision (the soft-cap escalation path). Without
 *       this, the orchestrator can leave a needs-replan verdict dangling in
 *       `stage="execution"`; the next dispatch then trips Phase 3.5 of
 *       `pre-task-guard.js` with a cryptic stage-mismatch error far from
 *       the actual cause. Cleared once `previous_stage === "execution"` and
 *       `stage === "planning"` (the reopen happened) — re-greps `summary.md`
 *       on every subsequent write are skipped because the post-reopen
 *       Reviewer cycle will rewrite the verdict anyway.
 *
 * Out of scope (deferred to other hooks/skills):
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
const { resolveArtifactRoot, canonicalize, posixize } = require('./lib/artifact-root');
const hookLog = require('./lib/hook-log');
const { findSubtaskSummary } = require('./lib/find-subtask-summary');

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
const tasksRoot = posixize(canonicalize(path.join(ARTIFACT.root, 'tasks')));
const canonicalTarget = posixize(canonicalize(path.resolve(filePath)));
if (canonicalTarget !== tasksRoot && !canonicalTarget.startsWith(tasksRoot + '/')) {
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

// (7) Valid stage transitions per stage-discipline.md → "Stage Transition Table".
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

function isEmptyArrayField(v) {
  return Array.isArray(v) && v.length === 0;
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
const blockingErrors = [];

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
            `Valid transitions live at \`skills/orchestrator-state/references/stage-discipline.md\` → Stage Transition Table.`,
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

// ---------- Closure invariants (BLOCKING) ----------
// These checks make the documented closure protocol unforgeable. Each must
// independently hold; we emit ALL violations so chief can fix them in one
// state-rewrite rather than discovering them one at a time.

if (state.phase === 'complete') {
  // C1 — phase=complete pairs with stage=closure.
  if (schemaVersion >= 3 && state.stage !== 'closure') {
    blockingErrors.push(
      `phase="complete" but stage=${JSON.stringify(state.stage)} — Step 12.5 (execution→closure transition) was skipped. Write stage="closure" with a closed execution stage_history entry (exit_reason="all-subtasks-approved") before setting phase="complete".`,
    );
  }

  // C2 — current_subtask must be explicitly null (omission is also a violation:
  // the field is required per state-schemas.md and the closure protocol must
  // explicitly null it).
  if (state.current_subtask !== null) {
    blockingErrors.push(
      `phase="complete" but current_subtask=${JSON.stringify(state.current_subtask)} (must be explicitly null) — Step 13 cleanup was skipped.`,
    );
  }
  // C2 — pending arrays must be explicitly present and empty. Missing field is
  // a violation because state-schemas.md marks all three required.
  // `pending_subtasks_needing_rereview` (v3+) is also a pending-work signal:
  // a non-empty list means a soft reopen left re-review work that closure
  // would silently drop. Treat it as a closure invariant on v3+ state files.
  const requiredEmpty = ['pending_subtasks', 'blocked_gates', 'pending_user_actions'];
  if (schemaVersion >= 3) {
    requiredEmpty.push('pending_subtasks_needing_rereview');
  }
  for (const field of requiredEmpty) {
    if (!isEmptyArrayField(state[field])) {
      blockingErrors.push(
        `phase="complete" but ${field}=${JSON.stringify(state[field])} is not an empty array — task is not actually complete.`,
      );
    }
  }

  // C5 — terminal closure stage_history entry shape.
  if (schemaVersion >= 3 && (!Array.isArray(state.stage_history) || state.stage_history.length === 0)) {
    blockingErrors.push(
      `phase="complete" but stage_history is empty/missing — cannot verify closure. v3 closure protocol requires at least one closed closure entry with exit_reason ∈ {"p4-approved", "completed-without-p4"}.`,
    );
  }
  if (schemaVersion >= 3 && Array.isArray(state.stage_history) && state.stage_history.length > 0) {
    const last = state.stage_history[state.stage_history.length - 1];
    if (!last || typeof last !== 'object') {
      blockingErrors.push(
        `phase="complete" but the last stage_history entry is malformed — cannot verify closure.`,
      );
    } else {
      if (last.stage !== 'closure') {
        blockingErrors.push(
          `phase="complete" but the last stage_history entry has stage=${JSON.stringify(last.stage)} (must be "closure"). Step 12.5 must append a fresh closure entry before phase="complete".`,
        );
      }
      const exitedAtMissing = last.exited_at === null || last.exited_at === undefined;
      const exitReasonMissing = last.exit_reason === null || last.exit_reason === undefined;
      if (exitedAtMissing || exitReasonMissing) {
        blockingErrors.push(
          `phase="complete" but the closure stage_history entry is still open (exited_at=${JSON.stringify(last.exited_at)}, exit_reason=${JSON.stringify(last.exit_reason)}). Close it with an ISO-8601 exited_at and exit_reason ∈ {"p4-approved", "completed-without-p4"} before setting phase="complete".`,
        );
      } else {
        const VALID_CLOSURE_EXIT_REASONS = new Set(['p4-approved', 'completed-without-p4']);
        if (!VALID_CLOSURE_EXIT_REASONS.has(last.exit_reason)) {
          blockingErrors.push(
            `phase="complete" but the closure stage_history entry has exit_reason=${JSON.stringify(last.exit_reason)} — must be one of {"p4-approved", "completed-without-p4"}.`,
          );
        }
      }
    }
  }

  // C3 — last_completed_seq parity with sibling history file.
  if (state.last_completed_seq !== undefined && Number.isInteger(state.last_completed_seq)) {
    const historyPath = path.join(path.dirname(filePath), 'orchestration-history.json');
    if (fs.existsSync(historyPath)) {
      let history;
      try {
        history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      } catch (_e) {
        history = null;
      }
      if (
        history &&
        Array.isArray(history.completed_subtasks) &&
        history.completed_subtasks.length !== state.last_completed_seq
      ) {
        blockingErrors.push(
          `phase="complete" but last_completed_seq=${state.last_completed_seq} disagrees with orchestration-history.json.completed_subtasks.length=${history.completed_subtasks.length} — hot state and history file are desynced.`,
        );
      }
    }
  }
}

// C7 — needs-replan follow-through. Re-grep the current subtask's summary.md
// to surface a stale needs-replan verdict that the orchestrator hasn't
// honored yet. We tolerate three legitimate write shapes:
//   1. stage transition to "planning" — the soft execution→planning reopen.
//   2. pending_user_actions entry mentioning replan/reopen — soft-cap
//      escalation path (≥ 3 reopens, awaiting user decision).
//   3. blocked_gates entry mentioning replan/reopen — same as (2) but
//      modeled as a gate.
// Skipped when the reopen has already happened in this write (previous_stage
// would be "execution" and stage would be "planning") — the post-reopen
// Reviewer cycle will rewrite the verdict, so re-checking it would be
// chasing a value about to change.

function extractReviewVerdictFromSummary(summaryPath) {
  let text;
  try {
    text = fs.readFileSync(summaryPath, 'utf8');
  } catch (_e) {
    return null;
  }
  // Match `- **review_verdict**: <value>` (canonical Status field shape used
  // in Subtask Summary). Tolerate optional trailing whitespace / parenthetical.
  const m = text.match(/^[ \t]*-\s*\*\*review_verdict\*\*:\s*([A-Za-z0-9_-]+)/im);
  return m ? m[1].toLowerCase() : null;
}

if (
  schemaVersion >= 3 &&
  typeof state.current_subtask === 'string' &&
  state.current_subtask.length > 0 &&
  // Skip ONLY when the soft reopen happens on this exact write
  // (previous_stage="execution" + stage="planning"). Earlier drafts also
  // gated on `state.stage !== 'planning'`, but that outer guard subsumed
  // the inner predicate and silently widened the skip window — any write
  // landing in stage="planning" (e.g. an initial intake→planning) was
  // exempted even though it had nothing to do with a needs-replan reopen.
  !(state.previous_stage === 'execution' && state.stage === 'planning')
) {
  const summaryPath = findSubtaskSummary(path.dirname(filePath), state.current_subtask);
  if (summaryPath) {
    const verdict = extractReviewVerdictFromSummary(summaryPath);
    if (verdict === 'needs-replan' || verdict === 'needs_replan') {
      // Tight match: "reopen" alone is too generic — it can land in
      // unrelated pending-action text (e.g. "Reopen the GitHub issue once
      // deployed") and falsely satisfy the invariant. Require explicit
      // replan / stage-reopen language.
      const replanRe = /needs[-_ ]?replan|stage[-_ ]?reopen|execution.*?planning/i;
      const blob = JSON.stringify({
        pending_user_actions: state.pending_user_actions,
        blocked_gates: state.blocked_gates,
      });
      const acknowledged = replanRe.test(blob);
      if (!acknowledged) {
        blockingErrors.push(
          `current_subtask ${JSON.stringify(state.current_subtask)} has review_verdict="needs-replan" in ${path.relative(process.cwd(), summaryPath) || summaryPath}, ` +
            `but this state write has stage=${JSON.stringify(state.stage)} and no pending_user_actions / blocked_gates entry referencing the replan or reopen decision. ` +
            `A needs-replan verdict requires either (a) a soft execution→planning reopen on this write — set stage="planning", increment stage_reopen_count, append a stage_history entry — or (b) a pending_user_actions / blocked_gates entry recording the soft-cap escalation (≥ 3 reopens awaiting user decision). ` +
            `Without acknowledgement, the next dispatch trips pre-task-guard.js Phase 3.5 with a cryptic stage-mismatch error far from the actual cause.`,
        );
      }
    }
  }
}

// C6 — phase=planned implies stage=closure (v3+). Plan-only tasks terminate
// in stage=closure with phase=planned (the closure entry stays OPEN so the
// task is resumable). Without this check, a write of phase=planned with
// stage != closure would only be caught much later at SubagentStop.
if (schemaVersion >= 3 && state.phase === 'planned' && state.stage !== 'closure') {
  blockingErrors.push(
    `phase="planned" but stage=${JSON.stringify(state.stage)} — plan-only terminal state requires stage="closure" with an OPEN closure stage_history entry (exit_reason="p1-approved-stop" on the prior planning entry).`,
  );
}

// C4 — workflow_state must agree with phase.
if (state.workflow_state !== undefined) {
  const ws = state.workflow_state;
  if ((ws === 'complete' || ws === 'done') && state.phase !== 'complete') {
    blockingErrors.push(
      `workflow_state=${JSON.stringify(ws)} but phase=${JSON.stringify(state.phase)} — workflow_state cannot substitute for phase. The two MUST agree.`,
    );
  }
  if ((ws === 'complete' || ws === 'done') && schemaVersion >= 3 && state.stage !== 'closure') {
    blockingErrors.push(
      `workflow_state=${JSON.stringify(ws)} but stage=${JSON.stringify(state.stage)} — terminal workflow_state requires stage="closure".`,
    );
  }
  if (ws === 'blocked' && state.phase !== 'blocked') {
    blockingErrors.push(
      `workflow_state="blocked" but phase=${JSON.stringify(state.phase)} — the two MUST agree.`,
    );
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

if (blockingErrors.length > 0) {
  const summary = `state file violates ${blockingErrors.length} closure invariant${blockingErrors.length === 1 ? '' : 's'}: ${blockingErrors.join(' ; ')}`;
  console.error(`[validate-orchestration-state-write] BLOCKING: ${summary}\nFile: ${filePath}`);
  hookLog.append({
    taskId: hookLog.taskIdFromFilePath(filePath),
    hook: 'validate-orchestration-state-write',
    decision: 'block',
    reason: summary,
  });
  process.exit(2);
}

process.exit(0);

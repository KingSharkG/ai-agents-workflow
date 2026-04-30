#!/usr/bin/env node
/**
 * PreToolUse hook: guard-pre-dispatch-p1 (blocking)
 *
 * Blocks subtask agent dispatch until the P1 gate (Delivery Plan Approval)
 * has been recorded in the active task's orchestration-state.json.
 *
 * Specifically: if the dispatched subagent_type is one of
 *   lead | executor | reviewer | design-agent | integration-checker
 * AND the active task's orchestration-state.json has
 *   gates.p1_approved !== true
 * then block with a stderr diagnostic naming the missing gate.
 *
 * Allowed regardless: chief-orchestrator, delivery-pm, init.
 *
 * Legacy pass-through: state files lacking `schema_version` are treated as
 * v1 (created before this hook landed). The hook allows the call through
 * and prints a one-line stderr warning naming the task id; the orchestrator
 * is expected to upgrade the file in place on its next touch per
 * skills/orchestrator-state/references/state-schemas.md → "Migration".
 *
 * Active-task discovery: parse task_id from CLAUDE_TOOL_INPUT_PROMPT
 * (matches the strategy in guard-subtask-skeleton.js); fall back to the
 * most-recently-modified ai-workflow-data/tasks/<id>/orchestration-state.json
 * when the prompt does not name a task. If neither resolves, exit 0 — the
 * downstream guards already enforce skeleton/bundle invariants and can
 * surface mis-dispatch.
 *
 * Env vars read:
 *   CLAUDE_TOOL_INPUT_SUBAGENT_TYPE — agent role being dispatched
 *   CLAUDE_TOOL_INPUT_PROMPT        — agent prompt (parsed for task_id)
 *   CLAUDE_PLUGIN_ROOT              — plugin installation root (unused; kept for parity)
 *
 * Exit semantics:
 *   0 — allow
 *   1 — block (stderr carries the actionable message)
 */

const fs = require('fs');
const path = require('path');

// Strip plugin namespace prefix if present
// (e.g., "ai-agents-workflow:executor" → "executor").
const rawSubagentType = process.env.CLAUDE_TOOL_INPUT_SUBAGENT_TYPE || '';
const subagentType = rawSubagentType.includes(':')
  ? rawSubagentType.split(':').pop()
  : rawSubagentType;

const ALLOWED_BEFORE_P1 = new Set([
  'chief-orchestrator',
  'delivery-pm',
  'init',
]);

const GATED_ROLES = new Set([
  'lead',
  'executor',
  'reviewer',
  'design-agent',
  'integration-checker',
]);

// No subagent named, or role is unconditionally allowed → exit fast.
if (!subagentType || ALLOWED_BEFORE_P1.has(subagentType)) {
  process.exit(0);
}

// Only enforce the gate for the recognized subtask roles. Unknown roles
// fall through (other guards handle them).
if (!GATED_ROLES.has(subagentType)) {
  process.exit(0);
}

// --- Locate the active task ---

const TASKS_ROOT = path.join('ai-workflow-data', 'tasks');

function parseTaskIdFromPrompt(prompt) {
  if (!prompt) return null;
  // Mirror guard-subtask-skeleton.js — try 3-segment first, then 2-segment.
  const m =
    prompt.match(/\b([A-Z]{2,}-[A-Z0-9]+-\d+)\b/) ||
    prompt.match(/\b([A-Z]{2,}-\d+)\b/);
  return m ? m[1] : null;
}

// A 3-segment id like "TP-042-E2" is a subtask id; the parent task id is the
// first two segments ("TP-042"). Strip the trailing segment so we look up the
// real task directory. 2-segment ids are returned unchanged.
function taskPrefixFor(id) {
  if (!id) return null;
  const segs = id.split('-');
  if (segs.length >= 3) return segs.slice(0, 2).join('-');
  return id;
}

function mostRecentTaskDir() {
  if (!fs.existsSync(TASKS_ROOT)) return null;
  let best = null;
  let bestMtime = -Infinity;
  let entries;
  try {
    entries = fs.readdirSync(TASKS_ROOT, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const statePath = path.join(TASKS_ROOT, entry.name, 'orchestration-state.json');
    if (!fs.existsSync(statePath)) continue;
    let mtime;
    try {
      mtime = fs.statSync(statePath).mtimeMs;
    } catch (_) {
      continue;
    }
    if (mtime > bestMtime) {
      bestMtime = mtime;
      best = entry.name;
    }
  }
  return best;
}

const prompt = process.env.CLAUDE_TOOL_INPUT_PROMPT || '';
const parsedId = parseTaskIdFromPrompt(prompt);

// Resolution order:
//   1. Parsed id as-is (handles 2-segment task ids).
//   2. Parsed id stripped to its 2-segment task prefix (handles prompts that
//      mention only a subtask id like "TP-042-E2" — the parent task is "TP-042").
//   3. Most-recently-modified task dir (no id mentioned anywhere).
// Each candidate is accepted only if its orchestration-state.json exists.
function resolveTaskId() {
  const candidates = [];
  if (parsedId) {
    candidates.push(parsedId);
    const prefix = taskPrefixFor(parsedId);
    if (prefix && prefix !== parsedId) candidates.push(prefix);
  }
  for (const id of candidates) {
    if (fs.existsSync(path.join(TASKS_ROOT, id, 'orchestration-state.json'))) {
      return id;
    }
  }
  return mostRecentTaskDir();
}

const taskId = resolveTaskId();

if (!taskId) {
  // No active task we can resolve — defer to other guards.
  process.exit(0);
}

const statePath = path.join(TASKS_ROOT, taskId, 'orchestration-state.json');
if (!fs.existsSync(statePath)) {
  // First subtask of a freshly created task; the orchestrator may dispatch
  // delivery-pm before writing state. delivery-pm is allow-listed above, so
  // any role reaching here without a state file means setup is incomplete —
  // let guard-subtask-skeleton produce the targeted diagnostic.
  process.exit(0);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
} catch (e) {
  // Malformed JSON is the skeleton guard's domain — don't double-block.
  process.exit(0);
}

// --- Legacy pass-through: missing schema_version means pre-v2 task ---
if (!Object.prototype.hasOwnProperty.call(parsed, 'schema_version')) {
  console.error(
    `[guard-pre-dispatch-p1] WARN: legacy task ${taskId} ` +
      `(no schema_version) — allowing dispatch; the orchestrator must ` +
      `upgrade ${statePath} to schema_version=2 with ` +
      `gates.p1_approved=true and signature="legacy-migration" on its ` +
      `next touch (see skills/orchestrator-state/references/state-schemas.md ` +
      `→ Migration).\n`,
  );
  process.exit(0);
}

// --- Enforce gate ---
const gates = parsed.gates || {};
if (gates.p1_approved === true) {
  process.exit(0);
}

console.error(
  `[guard-pre-dispatch-p1] BLOCKED: dispatch of ${subagentType} for task ${taskId} ` +
    `is not allowed before the P1 (Delivery Plan Approval) gate.\n` +
    `Active state file: ${statePath}\n` +
    `Required: gates.p1_approved === true\n` +
    `Observed: gates = ${JSON.stringify(gates)}\n` +
    `Resolution: present the Delivery Plan via the orchestrator-user-gates ` +
    `skill (P1 section) and only set gates.p1_approved=true after the user ` +
    `selects "Approve plan" in AskUserQuestion. Record gates.p1_approved_at ` +
    `(ISO-8601 UTC) and gates.p1_approved_signature (sha256 of normalized ` +
    `Block 1 + Block 2 + Block 3 bytes) at the same time.\n`,
);
process.exit(1);

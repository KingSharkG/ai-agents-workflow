#!/usr/bin/env node
/**
 * SubagentStop hook: guard-chief-orchestrator-stop (blocking)
 *
 * Purpose
 * -------
 * The chief-orchestrator subagent must, after it commits to one of the five
 * intake paths, EITHER (a) classify as `direct-answer`/`plan-only` and write
 * the corresponding minimal artifacts, OR (b) create `tasks/<task_id>/` and
 * dispatch at least one subtask agent via Task().
 *
 * v1.8.1 made the four-option intake popup mandatory in `orchestrator-intake`.
 * If chief lacks `AskUserQuestion` in its tool allowlist, the popup degrades
 * to a numbered chat-text fallback. After the user replies, chief silently
 * exits without artifacts and without dispatching anything — Lead, Executor,
 * Reviewer never run. None of the existing PreToolUse hooks fire (no Task,
 * no Edit, no Write, no Skill happened to be called).
 *
 * This hook fires on SubagentStop and is the structural backstop for that
 * failure mode.
 *
 * Detection
 * ---------
 * Claude Code passes a JSON payload on stdin (`session_id`, `transcript_path`,
 * `stop_hook_active`). We:
 *   1. Read stdin and resolve the transcript file.
 *   2. Walk the transcript looking for a Skill tool_use with skill name
 *      `orchestrator-intake`. Only chief invokes that skill — its presence
 *      auto-scopes the hook to chief without needing CLAUDE_SUBAGENT_TYPE.
 *   3. If absent, exit 0 (this is some other subagent, or chief errored
 *      before classification).
 *   4. If present, look for either:
 *        a. Any Task() tool_use in the same transcript (means chief did
 *           dispatch a subtask agent), OR
 *        b. A Write/Edit whose target is `task-data.md` AND whose contents
 *           record `final_path: direct-answer` (legitimate inline answer)
 *           or `final_path: plan-only` (legitimate stop at P1).
 *   5. If neither, block the stop with an actionable message. Exit 2 with
 *      stderr is the SubagentStop block convention.
 *
 * Failure-open: any unrecognized state (no transcript path, malformed JSON,
 * unreadable transcript, `stop_hook_active: true` to avoid infinite loops)
 * exits 0 with a stderr note.
 *
 * Exit semantics:
 *   0 — allow (no block)
 *   2 — block (stderr carries the actionable message)
 */

'use strict';

const fs = require('fs');

// -------- Read stdin payload (best-effort, non-blocking) --------

function readStdinSync() {
  try {
    const stat = fs.fstatSync(0);
    if (stat && stat.isCharacterDevice() && process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

const stdinRaw = readStdinSync();
let payload = {};
if (stdinRaw) {
  try {
    payload = JSON.parse(stdinRaw);
  } catch (_) {
    payload = {};
  }
}

// Avoid recursion: if Claude Code is re-firing this hook after a previous
// block, do not block again. The agent has been told what to do.
if (payload && payload.stop_hook_active === true) {
  process.exit(0);
}

const transcriptPath =
  (payload && payload.transcript_path) ||
  process.env.CLAUDE_TRANSCRIPT_PATH ||
  '';

if (!transcriptPath || !fs.existsSync(transcriptPath)) {
  process.exit(0);
}

// -------- Parse transcript (JSONL) --------

let lines;
try {
  lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
} catch (_) {
  process.exit(0);
}

function entriesIter() {
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function* toolUses(entries) {
  for (const entry of entries) {
    const content =
      (entry.message && entry.message.content) || entry.content || null;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && part.type === 'tool_use') yield part;
    }
  }
}

const entries = entriesIter();

// -------- Did chief invoke orchestrator-intake? --------

function isIntakeSkill(toolUse) {
  if (!toolUse || toolUse.name !== 'Skill') return false;
  const input = toolUse.input || {};
  // The Skill tool's primary param is `skill`.
  const name = String(input.skill || input.name || '');
  // Match both bare and namespaced (`ai-agents-workflow:orchestrator-intake`).
  return name === 'orchestrator-intake' || name.endsWith(':orchestrator-intake');
}

let intakeInvoked = false;
for (const tu of toolUses(entries)) {
  if (isIntakeSkill(tu)) {
    intakeInvoked = true;
    break;
  }
}

if (!intakeInvoked) {
  // Either this is not chief's transcript, or chief errored out before
  // classification (e.g., CWD validation failure). Either way, not our
  // failure mode. Allow.
  process.exit(0);
}

// -------- What roles did chief dispatch? --------

function bareSubagent(input) {
  const sub = String((input && input.subagent_type) || '');
  return sub.includes(':') ? sub.split(':').pop() : sub;
}

const dispatchedRoles = new Set();
for (const tu of toolUses(entries)) {
  if (tu.name === 'Task') {
    const role = bareSubagent(tu.input);
    if (role) dispatchedRoles.add(role);
  }
}

const anyDispatch = dispatchedRoles.size > 0;
const dispatchedExecutor = dispatchedRoles.has('executor');

// -------- Did chief write task-data.md with a legitimate exit-without-dispatch path? --------

const TASK_DATA_RE = /(^|\/)task-data\.md$/;
const FINAL_PATH_RE = /^\s*[-*]?\s*\*?\*?final_path\*?\*?\s*[:=]\s*([A-Za-z0-9_-]+)/im;

function isTaskDataWrite(toolUse) {
  if (!toolUse) return false;
  if (toolUse.name !== 'Write' && toolUse.name !== 'Edit') return false;
  const input = toolUse.input || {};
  const filePath = String(input.file_path || '');
  return TASK_DATA_RE.test(filePath);
}

function extractFinalPath(toolUse) {
  if (!toolUse) return null;
  const input = toolUse.input || {};
  // For Write: full content is in `content`. For Edit: look at `new_string`.
  const blob = String(input.content || input.new_string || '');
  const m = blob.match(FINAL_PATH_RE);
  return m ? m[1].toLowerCase() : null;
}

let recordedFinalPath = null;
for (const tu of toolUses(entries)) {
  if (!isTaskDataWrite(tu)) continue;
  const fp = extractFinalPath(tu);
  if (fp) {
    recordedFinalPath = fp;
    // Don't break — later writes may overwrite earlier ones; take the last.
  }
}

const EXECUTE_PATHS = new Set([
  'execution-trivial',
  'execution-simple',
  'execution-full',
]);

const isExecutePath = recordedFinalPath && EXECUTE_PATHS.has(recordedFinalPath);
const isStopPath =
  recordedFinalPath === 'direct-answer' || recordedFinalPath === 'plan-only';

// Allow legitimate stop-without-execution paths.
if (isStopPath && !anyDispatch) {
  process.exit(0);
}

// On execute paths, require an Executor dispatch specifically. Lead-only
// or design-only dispatches are not enough — code changes must run.
if (isExecutePath && dispatchedExecutor) {
  process.exit(0);
}

// Backwards-compat: if final_path was never recorded (older runs) but at
// least one Task was dispatched, allow. The artifact-chain validators
// catch downstream gaps.
if (!recordedFinalPath && anyDispatch) {
  process.exit(0);
}

// -------- Block --------

let reason;
if (isExecutePath && !dispatchedExecutor) {
  reason =
    `final_path is "${recordedFinalPath}" but no Task(executor) dispatch ` +
    `was found in this turn (dispatched roles: ` +
    `${[...dispatchedRoles].join(', ') || 'none'}). Execute paths require ` +
    `Executor to run so ai-work.md and summary.md are produced and ` +
    `Reviewer can finalize the cycle.`;
} else if (!recordedFinalPath && !anyDispatch) {
  reason =
    `orchestrator-intake ran but no task-data.md final_path was recorded ` +
    `and no Task() dispatch was made. This is the v1.8.1 silent-skip-` +
    `dispatch failure mode (intake popup degraded to chat-text fallback ` +
    `if AskUserQuestion is missing from chief's tool allowlist).`;
} else {
  reason =
    `orchestrator-intake ran but the orchestrator returned without a ` +
    `complete artifact chain. final_path=${recordedFinalPath || '<unset>'}, ` +
    `dispatched=[${[...dispatchedRoles].join(', ') || 'none'}].`;
}

process.stderr.write(
  `[guard-chief-orchestrator-stop] BLOCKED: ${reason}\n` +
    `\n` +
    `Resolution: on execute paths, dispatch Task(executor) (and Task(reviewer) ` +
    `to finalize) before returning. On non-execute paths, write task-data.md ` +
    `with final_path: direct-answer or plan-only. If the popup truly cannot ` +
    `be rendered in this environment, escalate via blocker-escalation-report ` +
    `rather than continuing inline.\n`,
);
process.exit(2);

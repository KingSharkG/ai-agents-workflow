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
 *   4. If present, classify by the recorded `final_path` in task-data.md:
 *        a. `direct-answer` / `plan-only` with no Task() dispatch → allow.
 *        b. `execution-trivial` / `execution-simple` / `execution-full` →
 *           require ALL of:
 *             • Task(executor) was dispatched in this turn.
 *             • orchestration-state.json reflects a terminal/hand-off state:
 *               phase ∈ {"complete","blocked"}, OR workflow_state="complete",
 *               OR pending_user_actions / blocked_gates non-empty.
 *             • The current subtask's <!-- section:implementation --> in
 *               ai-work.md contains non-whitespace content.
 *             • Task(reviewer) was dispatched, UNLESS the legitimate stop is
 *               a hand-off (pending_user_actions / blocked_gates non-empty).
 *        c. Older runs without a recorded final_path but with at least one
 *           Task() dispatch → allow (downstream artifact-chain validators
 *           catch gaps).
 *   5. Otherwise, block the stop with an actionable message naming each
 *      missing invariant. Exit 2 with stderr is the SubagentStop block
 *      convention.
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
const path = require('path');
const { resolveArtifactRoot } = require('./lib/artifact-root');

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

// -------- Resolve task_id + read orchestration-state.json (best effort) --------
//
// On execute paths we need the post-turn state to decide whether the orchestrator
// reached a legitimate terminal state (phase: complete) or a legitimate
// hand-off (pending_user_actions / blocked_gates non-empty). We resolve the
// task_id from the most recent task-data.md write in the transcript, or fall
// back to the most-recently-touched task directory under <artifact-root>/tasks/.

function extractTaskIdFromTaskDataPath(filePath) {
  if (!filePath) return null;
  // Match .../tasks/<task_id>/task-data.md — task_id is the segment immediately
  // before /task-data.md.
  const m = String(filePath).match(/(?:^|\/)tasks\/([^/]+)\/task-data\.md$/);
  return m ? m[1] : null;
}

let resolvedTaskId = null;
for (const tu of toolUses(entries)) {
  if (!isTaskDataWrite(tu)) continue;
  const fp = (tu.input && (tu.input.file_path || '')) || '';
  const tid = extractTaskIdFromTaskDataPath(fp);
  if (tid) resolvedTaskId = tid; // last write wins
}

const ARTIFACT = resolveArtifactRoot();
const ARTIFACT_ROOT = ARTIFACT.root || null;
const TASKS_ROOT = ARTIFACT_ROOT ? path.join(ARTIFACT_ROOT, 'tasks') : null;

function mostRecentTaskDir() {
  if (!TASKS_ROOT || !fs.existsSync(TASKS_ROOT)) return null;
  let best = null;
  let bestMtime = -Infinity;
  let entriesList;
  try {
    entriesList = fs.readdirSync(TASKS_ROOT, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  for (const entry of entriesList) {
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

if (!resolvedTaskId && TASKS_ROOT) {
  resolvedTaskId = mostRecentTaskDir();
}

const taskDir = resolvedTaskId && TASKS_ROOT
  ? path.join(TASKS_ROOT, resolvedTaskId)
  : null;
const statePath = taskDir ? path.join(taskDir, 'orchestration-state.json') : null;

let state = null;
if (statePath && fs.existsSync(statePath)) {
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (_) {
    state = null;
  }
}

function nonEmptyArrayOrObject(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

function isLegitimateTerminalState(s) {
  if (!s) return false;
  if (s.phase === 'complete' || s.phase === 'blocked' || s.workflow_state === 'complete') {
    return true;
  }
  if (nonEmptyArrayOrObject(s.pending_user_actions)) return true;
  if (nonEmptyArrayOrObject(s.blocked_gates)) return true;
  return false;
}

// -------- Implementation-section non-empty check (Defect 3 backstop) --------
//
// On execute paths, the current subtask's <!-- section:implementation --> must
// contain non-whitespace content between the open/close markers. An empty
// section means the Executor returned without writing the Implementation
// Report — a contract violation that must not slip past the Stop boundary.

function findAiWorkPath(rootDir, subtaskId) {
  if (!rootDir || !subtaskId) return null;
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let dirEntries;
    try {
      dirEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of dirEntries) {
      if (!e.isDirectory()) continue;
      if (e.name === subtaskId) {
        const candidate = path.join(dir, e.name, 'ai-work.md');
        if (fs.existsSync(candidate)) return candidate;
      }
      stack.push(path.join(dir, e.name));
    }
  }
  return null;
}

function implementationSectionEmpty(aiWorkPath) {
  if (!aiWorkPath || !fs.existsSync(aiWorkPath)) return false; // can't tell — fail open
  let text;
  try {
    text = fs.readFileSync(aiWorkPath, 'utf8');
  } catch (_) {
    return false;
  }
  const m = text.match(
    /<!--\s*section:implementation\s*-->([\s\S]*?)<!--\s*\/section:implementation\s*-->/i,
  );
  if (!m) return false; // no section — older format; let other validators catch it
  return m[1].trim().length === 0;
}

const subtaskForCheck =
  state && typeof state.current_subtask === 'string' && state.current_subtask
    ? state.current_subtask
    : null;
const aiWorkPath = taskDir && subtaskForCheck ? findAiWorkPath(taskDir, subtaskForCheck) : null;
const implSectionEmpty = aiWorkPath ? implementationSectionEmpty(aiWorkPath) : false;

const dispatchedReviewer = dispatchedRoles.has('reviewer');
const stateLooksTerminal = isLegitimateTerminalState(state);

// On execute paths, require ALL of:
//   1. Executor was dispatched (existing).
//   2. State reflects a legitimate terminal/hand-off (phase: complete | blocked,
//      OR pending_user_actions / blocked_gates non-empty).
//   3. <!-- section:implementation --> in the current subtask's ai-work.md is
//      non-empty (when we can locate it).
//   4. Reviewer was dispatched, UNLESS the legitimate terminal state is a
//      hand-off (blocked_gates / pending_user_actions non-empty) where Reviewer
//      may legitimately not have run yet.
if (isExecutePath && dispatchedExecutor) {
  const handoffStop =
    nonEmptyArrayOrObject(state && state.pending_user_actions) ||
    nonEmptyArrayOrObject(state && state.blocked_gates);
  const reviewerOk = dispatchedReviewer || handoffStop;
  if (stateLooksTerminal && !implSectionEmpty && reviewerOk) {
    process.exit(0);
  }
  // Fall through to block with a specific reason below.
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
} else if (isExecutePath && dispatchedExecutor) {
  // Compose a precise block reason naming each missing piece.
  const missing = [];
  if (!stateLooksTerminal) {
    const phaseStr = state ? `phase=${JSON.stringify(state.phase)}` : 'no readable state';
    const wfStr =
      state && 'workflow_state' in state
        ? `, workflow_state=${JSON.stringify(state.workflow_state)}`
        : '';
    missing.push(
      `orchestration-state.json does not reflect a terminal/hand-off state ` +
        `(${phaseStr}${wfStr}; pending_user_actions and blocked_gates both empty). ` +
        `Run the orchestrator-state skill's Post-Approval Closure procedure to set ` +
        `phase: "complete" — or record an entry in pending_user_actions / ` +
        `blocked_gates if this is a legitimate hand-off.`,
    );
  }
  if (implSectionEmpty) {
    missing.push(
      `<!-- section:implementation --> in ${path.relative(process.cwd(), aiWorkPath) || aiWorkPath} ` +
        `is empty. The Executor's role contract requires appending the Implementation Report ` +
        `(impl-metadata, impl-summary, impl-files-changed, impl-tests-run, impl-dynamic-skills, ` +
        `impl-unresolved-issues, impl-project-state) before returning. An empty section means ` +
        `the Executor returned without honoring the produce-artifact-first rule.`,
    );
  }
  const handoffStop =
    nonEmptyArrayOrObject(state && state.pending_user_actions) ||
    nonEmptyArrayOrObject(state && state.blocked_gates);
  if (!dispatchedReviewer && !handoffStop) {
    missing.push(
      `Task(reviewer) was not dispatched in this turn (dispatched roles: ` +
        `${[...dispatchedRoles].join(', ') || 'none'}). Execute paths require Reviewer to ` +
        `finalize the cycle (append <!-- section:review --> to ai-work.md, finalize summary.md) ` +
        `unless the orchestrator is parking the task in a hand-off state ` +
        `(pending_user_actions or blocked_gates non-empty).`,
    );
  }
  reason =
    `final_path is "${recordedFinalPath}" and Executor ran, but the closure invariants ` +
    `for execute paths are not satisfied:\n` +
    missing.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
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
    `Resolution: on execute paths, after Task(executor) returns, dispatch ` +
    `Task(reviewer) to append <!-- section:review --> to ai-work.md and finalize ` +
    `summary.md, then invoke the orchestrator-state skill's Post-Approval Closure ` +
    `procedure (skills/shared/orchestrator-state/SKILL.md → "Post-Approval Closure") ` +
    `to clear current_subtask, drain pending_subtasks, advance last_completed_seq, ` +
    `transition stage execution → closure, and set phase: "complete" in ` +
    `orchestration-state.json BEFORE returning. If the orchestrator must hand ` +
    `off mid-flow (P2/P4 gate, integration-check, dependency install), record ` +
    `that in pending_user_actions or blocked_gates first. On non-execute paths, ` +
    `write task-data.md with final_path: direct-answer or plan-only. If a ` +
    `dispatch is genuinely impossible, escalate via blocker-escalation-report ` +
    `rather than continuing inline.\n`,
);
process.exit(2);

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
const { resolveArtifactRoot, canonicalize, posixize } = require('./lib/artifact-root');
const { bareRole, mostRecentTaskDir, firstUserPromptText } = require('./lib/active-task');

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

// Anchor on the LATEST orchestrator-intake invocation, not the first. Each
// chief subagent runs in its own JSONL transcript, so multi-task false-allows
// across sessions can't happen — but a model could invoke intake more than
// once within a single turn (e.g. reclassification retry). Latest-wins keeps
// the post-intake popup check honest in that case.
let intakeInvoked = false;
let intakeLastIdx = -1;
{
  let runningIdx = 0;
  for (const tu of toolUses(entries)) {
    if (isIntakeSkill(tu)) {
      intakeInvoked = true;
      intakeLastIdx = runningIdx;
    }
    runningIdx++;
  }
}

// -------- Was the four-option confirm popup fired after intake? --------
//
// orchestrator-intake mandates a 4-option AskUserQuestion popup (Direct answer
// / Plan only / Execute lightweight / Execute full pipeline). Skipping it means
// the user got no chance to override the heuristic verdict — a silent contract
// violation. But the skill ALSO uses AskUserQuestion for an optional clarify
// gate before classification (≤3 freeform questions), so a shape-blind check
// would false-allow runs that fired only the clarify gate. Real transcripts
// also show model drift on labels and headers — strict equality would
// false-block valid runs. The rule below balances both concerns:
//   - hard structural gates: name=AskUserQuestion, exactly 1 question,
//     multiSelect=false, exactly 4 options
//   - label tolerance: require ≥2 of 4 canonical labels to match (after
//     stripping ` (Recommended)` and any trailing ` — ...` suffix)
//
// Exception: when the originating user prompt (the first user-role entry in
// this subagent's transcript — corresponds to the Task tool's `prompt` param)
// contains the literal marker `[E2E_AUTO_APPROVE_MODE]`, the popup is
// intentionally skipped. See skills/intake/orchestrator-intake/SKILL.md.

const CONFIRM_POPUP_CANONICAL_LABELS = [
  /^Direct answer\b/i,
  /^Plan only\b/i,
  /^Execute \(lightweight\)/i,
  /^Execute \(full pipeline\)/i,
];

function stripPopupSuffixes(label) {
  // Strip "(Recommended)" suffix and any trailing " — ..." commentary the
  // model sometimes appends (observed: "Execute (lightweight) — overriding full").
  return String(label || '')
    .replace(/\s*\(Recommended\)\s*$/i, '')
    .trim();
}

function isConfirmPopup(toolUse) {
  if (!toolUse || toolUse.name !== 'AskUserQuestion') return false;
  const qs = toolUse.input && toolUse.input.questions;
  if (!Array.isArray(qs) || qs.length !== 1) return false;
  const q = qs[0];
  if (q && q.multiSelect === true) return false;
  if (!q || !Array.isArray(q.options) || q.options.length !== 4) return false;
  const labels = q.options.map((o) => stripPopupSuffixes(o && o.label));
  let hits = 0;
  for (const re of CONFIRM_POPUP_CANONICAL_LABELS) {
    if (labels.some((l) => re.test(l))) hits++;
  }
  return hits >= 2;
}

let confirmPopupPostIntake = false;
if (intakeInvoked) {
  let runningIdx = 0;
  for (const tu of toolUses(entries)) {
    if (runningIdx > intakeLastIdx && isConfirmPopup(tu)) {
      confirmPopupPostIntake = true;
      break;
    }
    runningIdx++;
  }
}

// Scope the E2E marker scan to the originating user prompt only — the first
// user-role entry in the transcript, which carries the Task tool's `prompt`
// field. Scanning the whole transcript would false-positive on tool results
// that happen to quote the marker (e.g. a Read of orchestrator-intake/SKILL.md
// which documents it).
const e2eAutoApprove = intakeInvoked
  ? firstUserPromptText(entries).includes('[E2E_AUTO_APPROVE_MODE]')
  : false;

// Secondary scoping: when chief never invoked orchestrator-intake at all
// (CAKE-5997 mode — chief silently skipped Step 0), the intake-invoked
// signal can't tell us this is chief. Fall back to CLAUDE_SUBAGENT_TYPE.
const envSaysChief = bareRole(process.env.CLAUDE_SUBAGENT_TYPE || '') === 'chief-orchestrator';

if (!intakeInvoked && !envSaysChief) {
  // Either this is not chief's transcript, or chief errored out before
  // classification AND we have no env signal either. Allow.
  process.exit(0);
}

// -------- What roles did chief dispatch? --------

const dispatchedRoles = new Set();
for (const tu of toolUses(entries)) {
  if (tu.name === 'Task') {
    const role = bareRole(String((tu.input && tu.input.subagent_type) || ''));
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
let taskDataWritten = false;
for (const tu of toolUses(entries)) {
  if (!isTaskDataWrite(tu)) continue;
  taskDataWritten = true;
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

// -------- Out-of-artifact Edit/Write detection (Layer 2 backstop) --------
//
// CAKE-5997: chief edited consumer-repo source files directly across multiple
// dispatches. The PreToolUse source-write hook should have blocked this, but
// when scope detection fails (env var unset, hooks not loaded in consumer
// install), the writes go through. This is the SubagentStop retroactive
// backstop — even if Layer 1 was bypassed, we catch it here at stop time.
//
// Scope: Edit and Write only. Bash-based mutations (rm / sed -i / >>) against
// consumer-repo paths are caught by the PreToolUse `guard-orchestrator-source-
// writes.js` hook, which already inspects Bash command strings. The
// SubagentStop layer scans the post-hoc tool_use ledger, where Bash arguments
// would require re-parsing the same shell-lex logic; we deliberately leave
// that to the PreToolUse layer and keep this scan narrow.
//
// We compute outOfArtifactWrites before the legitimate-stop early-exit below:
// a direct-answer / plan-only run with out-of-artifact writes is still a
// protocol violation, so the legitimate-stop allow-path must check this list.

const ARTIFACT = resolveArtifactRoot();
const ARTIFACT_ROOT = ARTIFACT.root || null;
const TASKS_ROOT = ARTIFACT_ROOT ? path.join(ARTIFACT_ROOT, 'tasks') : null;
const artifactRootCanon = ARTIFACT_ROOT ? posixize(canonicalize(ARTIFACT_ROOT)) : null;

function isUnderArtifact(p) {
  // Intentional fail-open: when the resolver couldn't locate an artifact root
  // (no aiaw-data-* folder; legacy ai-workflow-data/ still present), we can't
  // judge whether a path is "inside" or "outside" — so we say "inside" and
  // skip flagging. The missing-artifact-root case is caught earlier on the
  // dispatch path by `pre-task-guard.js`, which blocks non-init dispatches
  // when the resolver fails. This hook stays narrow and doesn't double-block.
  if (!p || !artifactRootCanon) return true;
  try {
    const abs = posixize(canonicalize(path.resolve(process.cwd(), p)));
    return abs === artifactRootCanon || abs.startsWith(`${artifactRootCanon}/`);
  } catch (_) {
    return true;
  }
}

// Well-known workflow artifact filenames at their canonical depths under
// `/tasks/<id>/`:
//   - tasks/<id>/{task-data,orchestration-state,orchestration-history}.{md,json}
//   - tasks/<id>/[phase-X/]<subtask_id>/{ai-work,summary}.md
// Even when these land outside the resolved artifact root (e.g. tests using
// synthetic /tmp paths, or the resolver picking a different layout), they are
// unambiguously workflow artifacts and should not trip the out-of-artifact
// check.
const ARTIFACT_FILE_PATTERN = /(^|\/)tasks\/[^/]+\/(?:phase-[A-Za-z0-9-]+\/)?(?:[^/]+\/)?(?:task-data|orchestration-state|orchestration-history|ai-work|summary)\.(?:md|json)$/;

function isKnownArtifactPath(p) {
  if (!p) return false;
  return ARTIFACT_FILE_PATTERN.test(posixize(p));
}

const outOfArtifactWrites = [];
for (const tu of toolUses(entries)) {
  if (tu.name !== 'Edit' && tu.name !== 'Write') continue;
  const fp = String((tu.input && tu.input.file_path) || '');
  if (!fp) continue;
  if (isKnownArtifactPath(fp)) continue;
  if (!isUnderArtifact(fp)) {
    outOfArtifactWrites.push({ tool: tu.name, path: fp });
  }
}

// Allow legitimate stop-without-execution paths — UNLESS chief made
// out-of-artifact Edit/Write calls in the same turn (CAKE-5997 mode), in
// which case the legitimate-stop path is moot. Also UNLESS the intake
// classification popup was skipped OR intake errored mid-flight (see
// intakePartialFailure below).
// Two distinct failure modes share the "intake fired but no popup" branch:
//   - "popup skipped" — task-data.md WAS written, so chief committed to a path
//     without showing the user the four-option override popup.
//   - "intake errored" — task-data.md was NOT written either; chief invoked
//     the skill, never popped the popup, never recorded a final_path. The
//     classification process itself failed mid-flight. Same root block, but
//     different remediation advice for the user.
const popupSkipped =
  intakeInvoked && !confirmPopupPostIntake && taskDataWritten && !e2eAutoApprove;
const intakeErrored =
  intakeInvoked && !confirmPopupPostIntake && !taskDataWritten && !e2eAutoApprove;
const intakePartialFailure = popupSkipped || intakeErrored;

if (
  isStopPath &&
  !anyDispatch &&
  outOfArtifactWrites.length === 0 &&
  !intakePartialFailure
) {
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
  // before /task-data.md. posixize the input first so Windows-style paths
  // (`tasks\foo\task-data.md`) match the same regex.
  const m = posixize(filePath).match(/(?:^|\/)tasks\/([^/]+)\/task-data\.md$/);
  return m ? m[1] : null;
}

let resolvedTaskId = null;
for (const tu of toolUses(entries)) {
  if (!isTaskDataWrite(tu)) continue;
  const fp = (tu.input && (tu.input.file_path || '')) || '';
  const tid = extractTaskIdFromTaskDataPath(fp);
  if (tid) resolvedTaskId = tid; // last write wins
}

if (!resolvedTaskId && TASKS_ROOT) {
  resolvedTaskId = mostRecentTaskDir(TASKS_ROOT, 'state');
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

function matcherWord(n) {
  return n === 1 ? 'Edit/Write call' : 'Edit/Write calls';
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
  const MAX_DEPTH = 8;
  const visited = new Set();
  const stack = [{ dir: rootDir, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > MAX_DEPTH) continue;
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch (_) {
      continue;
    }
    if (visited.has(real)) continue;
    visited.add(real);
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
      stack.push({ dir: path.join(dir, e.name), depth: depth + 1 });
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
// outOfArtifactWrites is computed earlier (before the isStopPath early-exit).

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
  // Out-of-artifact writes by chief override an otherwise-legitimate execute
  // path: even with executor + reviewer + closure complete, chief is not
  // permitted to edit consumer-repo files itself. Block with the
  // out-of-artifact reason below instead of allowing.
  if (
    stateLooksTerminal &&
    !implSectionEmpty &&
    reviewerOk &&
    outOfArtifactWrites.length === 0 &&
    !intakePartialFailure
  ) {
    process.exit(0);
  }
  // Fall through to block with a specific reason below.
}

// Backwards-compat: if final_path was never recorded (older runs) but at
// least one Task was dispatched, allow. The artifact-chain validators
// catch downstream gaps.
//
// EXCEPTION: skip the backwards-compat allow when (a) chief made any
// out-of-artifact Edit/Write in this turn, or (b) chief never invoked
// orchestrator-intake (CAKE-5997 mode — the env-says-chief fallback put us
// in this hook). Those cases must always block.
if (
  !recordedFinalPath &&
  anyDispatch &&
  outOfArtifactWrites.length === 0 &&
  intakeInvoked &&
  !intakePartialFailure
) {
  process.exit(0);
}

// -------- Block --------

let reason;
if (outOfArtifactWrites.length > 0) {
  // CAKE-5997 retroactive backstop: chief edited consumer-repo source files
  // directly. Layer 1 (PreToolUse guard-orchestrator-source-writes / step0)
  // should have blocked at write time; if it didn't (env unset, hooks not
  // loaded), we catch it here.
  const sample = outOfArtifactWrites
    .slice(0, 5)
    .map((w) => `  ${w.tool}: ${w.path}`)
    .join('\n');
  const more =
    outOfArtifactWrites.length > 5
      ? `\n  ... and ${outOfArtifactWrites.length - 5} more`
      : '';
  reason =
    `chief-orchestrator made ${outOfArtifactWrites.length} ${matcherWord(outOfArtifactWrites.length)} ` +
    `to paths outside the artifact root. Code changes in the consumer repo are ` +
    `reserved for Task(executor) — chief must NEVER Edit/Write source files itself.\n` +
    `Offending tool calls (first 5):\n${sample}${more}\n` +
    `Resolution: the next dispatch must go through Task(executor) with the same change ` +
    `expressed as a TEP. If these edits are already on disk, the work itself isn't ` +
    `discarded, but the orchestrator's role contract is broken — escalate via ` +
    `blocker-escalation-report so the supervising user can decide whether to keep, ` +
    `revert, or re-route the changes.`;
} else if (envSaysChief && !intakeInvoked) {
  // CAKE-5997 primary failure mode: chief was dispatched but skipped Step 0
  // entirely. No orchestrator-intake invocation, no classification popup, no
  // task-data.md.
  reason =
    `chief-orchestrator returned without invoking the orchestrator-intake skill. ` +
    `Step 0 (intake classification + 4-option AskUserQuestion popup + task-data.md) ` +
    `is mandatory — there is no path that lets chief skip it. This is the CAKE-5997 ` +
    `silent-skip-Step-0 failure mode.`;
} else if (popupSkipped) {
  // Step 0 partial-skip: chief invoked orchestrator-intake, wrote task-data.md
  // with a final_path, but never fired the mandatory four-option
  // AskUserQuestion confirm popup. The user got no chance to override the
  // heuristic verdict before the pipeline committed to a path.
  reason =
    `chief-orchestrator invoked orchestrator-intake and recorded a final_path in ` +
    `task-data.md, but never fired the mandatory four-option AskUserQuestion ` +
    `confirm popup (Direct answer / Plan only / Execute (lightweight) / ` +
    `Execute (full pipeline)). The popup is non-negotiable for every production ` +
    `request — see skills/intake/orchestrator-intake/SKILL.md "Confirm-and-Override ` +
    `Protocol". The only legal skip path is the [E2E_AUTO_APPROVE_MODE] marker in ` +
    `the originating task prompt, which was not present in this turn. ` +
    `Re-run Step 0 and present the popup before any further dispatch.`;
} else if (intakeErrored) {
  // Distinct from popupSkipped: chief invoked the intake skill but didn't
  // make it as far as writing task-data.md OR firing the popup. The
  // classification process aborted mid-flight (often a skill load error,
  // an unhandled exception, or chief errored after the Skill returned but
  // before writing anything). Different remediation.
  reason =
    `chief-orchestrator invoked orchestrator-intake but the intake stage did not ` +
    `complete: no four-option AskUserQuestion confirm popup was fired AND no ` +
    `task-data.md was written. The intake classification process aborted mid-flight ` +
    `(likely a skill load error or chief errored after the Skill call returned). ` +
    `Re-run /ai-agents-workflow:task with the same description. If the failure ` +
    `repeats, surface the diagnostic from the Skill invocation directly per the ` +
    `"Abort on missing skill" hard rule rather than continuing silently.`;
} else if (isExecutePath && !dispatchedExecutor) {
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

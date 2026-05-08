#!/usr/bin/env node
/**
 * PreToolUse hook: guard-orchestrator-step0 (blocking)
 *
 * Forces the chief-orchestrator through Step 0 (intake classification +
 * classification popup + task-data.md creation) before it can do any
 * destructive or dispatch work.
 *
 * The original failure mode (CAKE-5997): chief was dispatched via
 * /ai-agents-workflow:task, never invoked orchestrator-intake, never showed
 * the classification popup, never created task-data.md, and instead edited
 * consumer-repo source files directly. None of the existing hooks fired
 * because no Task() was dispatched and the source-write hook scope didn't
 * apply in that consumer install.
 *
 * Gating signal: existence of <artifact-root>/tasks/<task_id>/task-data.md.
 * That file is written at the END of the intake stage by the task-packet
 * skill — its presence is the canonical proxy for "intake stage is complete."
 *
 * Scope:
 *   Only fires when CLAUDE_SUBAGENT_TYPE === "chief-orchestrator". Other
 *   agents and the top-level user session are unaffected.
 *
 * Tool matchers (declared in hooks.json): Edit | Write | Task.
 *   Any matcher not in {Edit, Write, Task} bypasses entirely. The typical
 *   intake-stage tools chief uses during this phase are Skill (for the
 *   classification skills), AskUserQuestion (for the popup), Read/Grep/Glob
 *   (for context-gathering), and Bash (for the CWD validation check) — none
 *   of which match this hook.
 *   - Edit  → block before task-data.md exists.
 *   - Write → allow only when targeting <artifact-root>/tasks/<task_id>/**;
 *             block writes to consumer-repo paths.
 *   - Task  → block before task-data.md exists.
 *
 * Once task-data.md exists, this hook is a no-op and the existing
 * pre-task-guard.js takes over.
 *
 * Env vars read:
 *   CLAUDE_SUBAGENT_TYPE         — calling agent role
 *   CLAUDE_TOOL_MATCHER          — "Edit" | "Write" | "Task"
 *   CLAUDE_TOOL_INPUT_FILE_PATH  — Edit/Write target
 *   CLAUDE_TOOL_INPUT_PROMPT     — Task dispatch prompt (parsed for task_id)
 *
 * Exit semantics:
 *   0 — allow
 *   1 — block (stderr carries the actionable message)
 *
 * Fail-open: missing artifact root, unparseable inputs, unrecognized matcher
 * all exit 0. Layer 2 (guard-chief-orchestrator-stop) provides the
 * SubagentStop backstop so a bypass here is still caught.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveArtifactRoot, canonicalize, posixize } = require('./lib/artifact-root');
const {
  bareRole,
  parseTaskIdFromPrompt,
  mostRecentTaskDir,
} = require('./lib/active-task');

const callingRole = bareRole(process.env.CLAUDE_SUBAGENT_TYPE || '');
if (callingRole !== 'chief-orchestrator') {
  process.exit(0);
}

const matcher = (process.env.CLAUDE_TOOL_MATCHER || '').trim();
if (matcher !== 'Edit' && matcher !== 'Write' && matcher !== 'Task') {
  process.exit(0);
}

const ARTIFACT = resolveArtifactRoot();

// Fail-open on missing artifact root. The pre-task-guard hook already blocks
// non-init dispatches when the artifact root is missing, and the source-write
// guard handles legacy detection. This hook stays narrow.
if (!ARTIFACT.root) {
  process.exit(0);
}

const TASKS_ROOT = path.join(ARTIFACT.root, 'tasks');

// ----- Resolve the active task_id -----
//
// Strategy:
//   1. If matcher is Task, try to parse task_id from the dispatch prompt
//      (chief embeds it in the dispatch bundle).
//   2. Fall back to most-recently-modified task directory under
//      <artifact-root>/tasks/. During intake, chief may have created the
//      directory but not yet written orchestration-state.json — so we walk by
//      directory mtime, not by state-file presence (mode='dir').
//   3. If still nothing, the orchestrator hasn't even started Step 0:
//      block any Task or non-artifact Edit/Write.

let activeTaskId = null;
if (matcher === 'Task') {
  activeTaskId = parseTaskIdFromPrompt(process.env.CLAUDE_TOOL_INPUT_PROMPT || '');
}
if (!activeTaskId) {
  activeTaskId = mostRecentTaskDir(TASKS_ROOT, 'dir');
}

const artifactRootCanon = posixize(canonicalize(ARTIFACT.root));

function isUnderArtifactRoot(p) {
  if (!p) return false;
  const abs = posixize(canonicalize(path.resolve(process.cwd(), p)));
  return abs === artifactRootCanon || abs.startsWith(`${artifactRootCanon}/`);
}

function isUnderTaskDir(p, taskId) {
  if (!p || !taskId) return false;
  const taskDirCanon = posixize(canonicalize(path.join(TASKS_ROOT, taskId)));
  const abs = posixize(canonicalize(path.resolve(process.cwd(), p)));
  return abs === taskDirCanon || abs.startsWith(`${taskDirCanon}/`);
}

// ----- Block-message composition -----
//
// All three deny variants share the same Step-0 sequence and contract pointer.
// `emitBlock` writes the canonical body; `deny*` add per-tool framing and all
// take the offending path as a parameter (Edit/Write) or none (Task).

const REQUIRED_SEQUENCE =
  `Required pre-task sequence (Step 0):\n` +
  `  1. Skill("ai-agents-workflow:orchestrator-intake")  — classify; ask Step 0a clarifying questions if ambiguous\n` +
  `  2. AskUserQuestion(...)                              — present the 4-option classification popup\n` +
  `  3. Skill("ai-agents-workflow:task-packet")           — write task-data.md\n` +
  `  4. Skill("ai-agents-workflow:orchestrator-state")    — write orchestration-state.json\n`;

const CONTRACT_POINTER =
  // Single backslash before $: when stderr renders, the user reads
  // "$CLAUDE_PLUGIN_ROOT/agents/chief-orchestrator.md" — recognizable as a
  // shell variable reference, not JS template syntax.
  `See: $CLAUDE_PLUGIN_ROOT/agents/chief-orchestrator.md (hard rule #2)`;

function activeTaskBlock(extraLines = '') {
  if (activeTaskId) {
    return (
      `Active task:   ${activeTaskId}\n` +
      `Missing file:  ${path.join(TASKS_ROOT, activeTaskId, 'task-data.md')}\n` +
      extraLines
    );
  }
  return `Active task:   <none — chief has not created a task directory yet>\n` + extraLines;
}

function emitBlock(headline, body, footer = '') {
  process.stderr.write(
    `[guard-orchestrator-step0] BLOCKED: ${headline}\n` +
      body +
      `\n` +
      REQUIRED_SEQUENCE +
      (footer ? `\n${footer}\n` : '') +
      `\n${CONTRACT_POINTER}\n`,
  );
  process.exit(1);
}

function denyEdit(targetPath) {
  emitBlock(
    `chief-orchestrator may not Edit before the intake stage is complete.`,
    `Path:          ${targetPath || '<unknown>'}\n` + activeTaskBlock(),
    `Code changes in the consumer repo are reserved for Task(executor); the chief-orchestrator never edits source files itself.`,
  );
}

function denyWrite(targetPath) {
  const allowedScope = activeTaskId
    ? `Allowed scope: ${path.join(TASKS_ROOT, activeTaskId)}/**\n`
    : `Allowed scope: ${TASKS_ROOT}/<task_id>/**\n`;
  emitBlock(
    `chief-orchestrator may not Write outside <artifact-root>/tasks/<task_id>/** before the intake stage is complete.`,
    `Path:          ${targetPath || '<unknown>'}\n` + activeTaskBlock(allowedScope),
  );
}

function denyTask() {
  emitBlock(
    `chief-orchestrator may not dispatch Task() before the intake stage is complete.`,
    activeTaskBlock(),
  );
}

// ----- Apply the gate -----

// Resolve the offending path once. Edit and Write both pass it to their deny
// helpers and to the artifact-root / task-dir allow-list checks; Task ignores
// it (denyTask takes no argument). The previous code rebound this same env
// read inside two adjacent `matcher === 'Write'` blocks; one hoist replaces
// both bindings.
const targetPath = process.env.CLAUDE_TOOL_INPUT_FILE_PATH || '';

// Case A: no active task at all — chief is in pre-intake territory.
if (!activeTaskId) {
  if (matcher === 'Task') denyTask();
  if (matcher === 'Edit') denyEdit(targetPath);
  if (matcher === 'Write') {
    // Allow writes anywhere under the artifact root — chief may be
    // bootstrapping the very first task directory + task-data.md right now.
    // The artifact-root-only constraint already prevents consumer-repo writes.
    if (isUnderArtifactRoot(targetPath)) process.exit(0);
    denyWrite(targetPath);
  }
  // Unreachable: every matcher branch above terminates the process.
  process.exit(0);
}

// Case B: active task exists. Check whether intake stage is complete.
const taskDataPath = path.join(TASKS_ROOT, activeTaskId, 'task-data.md');
if (fs.existsSync(taskDataPath)) {
  // Intake complete; defer to downstream hooks (pre-task-guard, source-writes).
  process.exit(0);
}

// Case C: active task exists but task-data.md is missing → still in intake.
if (matcher === 'Task') denyTask();
if (matcher === 'Edit') denyEdit(targetPath);
if (matcher === 'Write') {
  // Allow writes scoped to the active task directory (so task-packet,
  // orchestrator-state, and any intake-stage scratch artifacts can land).
  if (isUnderTaskDir(targetPath, activeTaskId)) process.exit(0);
  denyWrite(targetPath);
}

// Unreachable: every matcher branch above terminates the process.
process.exit(0);

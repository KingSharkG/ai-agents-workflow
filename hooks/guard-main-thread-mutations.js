#!/usr/bin/env node
/**
 * PreToolUse hook: guard-main-thread-mutations (blocking)
 *
 * Purpose
 * -------
 * The `/ai-agents-workflow:task` slash command is supposed to dispatch the
 * `chief-orchestrator` subagent as the main thread's first and only
 * substantive action. `guard-main-thread-skills` blocks the `Skill` tool
 * before that dispatch, but nothing has been blocking direct `Edit`,
 * `Write`, or `Bash` mutations from the main thread. That gap lets the
 * pipeline silently degrade to "main thread does the work, no artifacts,
 * no Reviewer" — exactly the symptom users have reported.
 *
 * This hook closes that gap with the same ordering rule, applied to
 * mutation tools instead of `Skill`:
 *
 *   While a `/ai-agents-workflow:task` invocation is in flight in the main
 *   thread, no `Edit` / `Write` / `Bash` mutation may run until
 *   `Task(chief-orchestrator)` has been dispatched.
 *
 * Subagents (chief-orchestrator, executor, reviewer, …) run in their own
 * sessions and are unaffected — they have `CLAUDE_SUBAGENT_TYPE` set,
 * which we use to short-circuit and exit 0.
 *
 * Detection
 * ---------
 * Same transcript walk as `guard-main-thread-skills`:
 *   1. Read stdin (best-effort).
 *   2. Walk transcript backwards to most recent user prompt.
 *   3. If it does NOT look like `/ai-agents-workflow:task` → allow.
 *   4. Otherwise scan messages between that prompt and now for an assistant
 *      `Task` tool_use with subagent_type ending in `chief-orchestrator`.
 *   5. If found → allow. Otherwise → block.
 *
 * Allow exception:
 *   - `Edit` / `Write` whose target path is inside the resolved artifact
 *     root pass through (e.g., a future pre-flight artifact write the main
 *     thread might do — currently none, but reserve the carve-out).
 *   - `Bash` is allowed for read-only-looking commands (no `>`, `>>`, no
 *     known mutation verbs). Anything ambiguous is treated as a mutation
 *     and blocked.
 *
 * Failure modes (transcript missing, malformed, unreadable) all fall
 * through to allow — the hook never blocks on uncertainty about its own
 * inputs. Fix A (prompt enforcement in commands/task.md) is the primary
 * protection; this hook adds defense in depth.
 *
 * Exit semantics:
 *   0 — allow
 *   1 — block (stderr carries the actionable message)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveArtifactRoot, canonicalize } = require('./lib/artifact-root');

// -------- Subagent short-circuit --------

const bareRole = (id) => {
  if (!id) return '';
  return id.includes(':') ? id.split(':').pop() : id;
};

const callingRole = bareRole(process.env.CLAUDE_SUBAGENT_TYPE || '');
if (callingRole) {
  // Any subagent — chief-orchestrator, executor, reviewer, etc. — is
  // governed by other hooks. This guard is only for the main thread.
  process.exit(0);
}

const matcher = (process.env.CLAUDE_TOOL_MATCHER || '').trim();
if (!['Edit', 'Write', 'Bash'].includes(matcher)) {
  process.exit(0);
}

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

const transcriptPath =
  payload.transcript_path || process.env.CLAUDE_TRANSCRIPT_PATH || '';

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

const TASK_COMMAND_MARKER = '/ai-agents-workflow:task';
const TASK_COMMAND_BODY_MARKERS = [
  'Dispatch the `chief-orchestrator` subagent with the task description.',
  'subagent_type: ai-agents-workflow:chief-orchestrator',
];

function looksLikeTaskCommand(text) {
  if (!text) return false;
  if (text.includes(TASK_COMMAND_MARKER)) return true;
  return TASK_COMMAND_BODY_MARKERS.some((m) => text.includes(m));
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('\n');
  }
  return '';
}

// Walk backwards to find the most recent user message.
let userIndex = -1;
let userText = '';
for (let i = lines.length - 1; i >= 0; i--) {
  let entry;
  try {
    entry = JSON.parse(lines[i]);
  } catch (_) {
    continue;
  }
  const role =
    (entry.message && entry.message.role) ||
    entry.role ||
    entry.type ||
    null;
  if (role === 'user') {
    const content =
      (entry.message && entry.message.content) || entry.content || '';
    userText = extractText(content);
    userIndex = i;
    break;
  }
}

if (userIndex === -1) {
  process.exit(0);
}

if (!looksLikeTaskCommand(userText)) {
  process.exit(0);
}

// -------- Has chief-orchestrator already been dispatched? --------

function isChiefOrchestratorDispatch(toolUse) {
  if (!toolUse || toolUse.name !== 'Task') return false;
  const input = toolUse.input || {};
  const sub = String(input.subagent_type || '');
  return sub.endsWith('chief-orchestrator');
}

let dispatched = false;
for (let i = userIndex + 1; i < lines.length; i++) {
  let entry;
  try {
    entry = JSON.parse(lines[i]);
  } catch (_) {
    continue;
  }
  const content =
    (entry.message && entry.message.content) || entry.content || null;
  if (!Array.isArray(content)) continue;
  for (const part of content) {
    if (part && part.type === 'tool_use' && isChiefOrchestratorDispatch(part)) {
      dispatched = true;
      break;
    }
  }
  if (dispatched) break;
}

if (dispatched) {
  process.exit(0);
}

// -------- Allow exception: artifact-root-scoped operations --------

const ARTIFACT = resolveArtifactRoot();

function isArtifactPath(p) {
  if (!p) return false;
  if (!ARTIFACT.root) return false;
  const root = ARTIFACT.root.replace(/\\/g, '/');
  const abs = canonicalize(path.resolve(process.cwd(), p)).replace(/\\/g, '/');
  if (abs === root) return true;
  if (abs.startsWith(`${root}/`)) return true;
  return false;
}

if (matcher === 'Edit' || matcher === 'Write') {
  const target =
    (payload.tool_input && payload.tool_input.file_path) ||
    process.env.CLAUDE_TOOL_INPUT_FILE_PATH ||
    '';
  if (isArtifactPath(target)) {
    process.exit(0);
  }
}

if (matcher === 'Bash') {
  const cmd =
    (payload.tool_input && payload.tool_input.command) ||
    process.env.CLAUDE_TOOL_INPUT_COMMAND ||
    '';
  // Read-only allow-list: simple, conservative. Anything else is treated
  // as a potential mutation and blocked. Pre-flight `node` calls used by
  // commands/task.md (artifact-root resolution) are allowed.
  const READ_ONLY_RE =
    /^\s*(ls|cat|head|tail|grep|find|rg|pwd|echo|printf|node|which|stat|file|wc|test|\[)\b/;
  const HAS_REDIRECT_RE = /(^|\s)(>>?|<<?)/;
  const HAS_PIPE_TO_MUTATION_RE = /\|\s*(tee|sed\s+-i|awk\s+>|xargs\s+(rm|mv|cp))/;
  if (
    READ_ONLY_RE.test(cmd) &&
    !HAS_REDIRECT_RE.test(cmd) &&
    !HAS_PIPE_TO_MUTATION_RE.test(cmd)
  ) {
    process.exit(0);
  }
}

// -------- Block --------

const toolLabel =
  matcher === 'Bash'
    ? `Bash (${(
        (payload.tool_input && payload.tool_input.command) ||
        process.env.CLAUDE_TOOL_INPUT_COMMAND ||
        ''
      ).slice(0, 80)})`
    : `${matcher} (${
        (payload.tool_input && payload.tool_input.file_path) ||
        process.env.CLAUDE_TOOL_INPUT_FILE_PATH ||
        '<unknown path>'
      })`;

console.error(
  `[guard-main-thread-mutations] BLOCKED: main thread attempted ${toolLabel} ` +
    `before dispatching chief-orchestrator.\n` +
    `\n` +
    `Per /ai-agents-workflow:task, the main thread MUST hand off to the ` +
    `chief-orchestrator subagent as its first substantive action. Code ` +
    `changes belong inside Executor (dispatched by the orchestrator), not ` +
    `in the main thread. Without this dispatch, no ai-work.md or summary.md ` +
    `is produced and Reviewer never runs.\n` +
    `\n` +
    `Resolution: call Task with subagent_type ` +
    `"ai-agents-workflow:chief-orchestrator" and pass the original task ` +
    `description verbatim. The orchestrator will route through Lead / ` +
    `Executor / Reviewer and produce the artifact chain.\n`,
);
process.exit(1);

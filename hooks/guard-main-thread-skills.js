#!/usr/bin/env node
/**
 * PreToolUse hook: guard-main-thread-skills (blocking)
 *
 * Purpose
 * -------
 * The `/ai-agents-workflow:task` slash command is supposed to dispatch the
 * `chief-orchestrator` subagent as the main thread's first and only
 * substantive action. Without this hook, session-start skill directives
 * (e.g. superpowers' "if there's a 1% chance a skill applies, invoke it")
 * can pull the main thread into running skills inline — which silently
 * bypasses the entire orchestrator pipeline and produces no artifacts.
 *
 * This hook enforces a single ordering rule, generically:
 *
 *   While a `/ai-agents-workflow:task` invocation is in flight in the main
 *   thread, no `Skill` tool may run until `Task(chief-orchestrator)` has
 *   been dispatched, EXCEPT for skills on the narrow pre-flight allowlist
 *   below (see PRE_DISPATCH_SKILL_ALLOWLIST).
 *
 * After dispatch, skills run inside subagents (those run in their own
 * sessions; this hook does not see them), which is exactly the intended
 * outcome.
 *
 * Pre-dispatch allowlist
 * ----------------------
 * commands/task.md and commands/continue.md run a small pre-flight before
 * the chief-orchestrator dispatch — currently a single skill,
 * `ai-agents-workflow:resolve-artifact-root`, which resolves ARTIFACT_ROOT
 * via Bash. Without an allowlist this hook would block its own pre-flight,
 * forcing the commands to fall back to direct Bash invocations of the
 * underlying script. The allowlist is deliberately tiny: any skill on it
 * MUST be safe to run in the main thread (no source mutation, no long-lived
 * state, no orchestrator-pipeline side effects).
 *
 * Detection
 * ---------
 * Claude Code provides the hook with a JSON payload on stdin including
 * `transcript_path` and `tool_input`. We:
 *   1. Read stdin (best-effort, with fallback).
 *   2. Walk the transcript backwards to find the most recent user prompt.
 *   3. If it does NOT look like a `/ai-agents-workflow:task` invocation,
 *      exit 0 (allow — unrelated skill use).
 *   4. Otherwise, scan messages between that prompt and now for an assistant
 *      `Task` tool_use with subagent_type ending in `chief-orchestrator`.
 *   5. If found → allow. Otherwise → block (exit 1) with a clear message.
 *
 * Failure modes (transcript missing, malformed, unreadable) all fall through
 * to allow — the hook never blocks on uncertainty about its own inputs.
 *
 * Exit semantics:
 *   0 — allow
 *   1 — block (stderr carries the actionable message)
 */

'use strict';

const fs = require('fs');

// Skills allowed in the main thread BEFORE chief-orchestrator dispatch.
// Match both bare names and the namespaced `ai-agents-workflow:<name>` form.
// Keep this set as small as possible — every entry is a hole in the
// "dispatch first, then run skills inside subagents" invariant.
const PRE_DISPATCH_SKILL_ALLOWLIST = new Set(['resolve-artifact-root']);

function isAllowlistedSkillName(name) {
  if (!name) return false;
  const bare = String(name).includes(':') ? String(name).split(':').pop() : String(name);
  return PRE_DISPATCH_SKILL_ALLOWLIST.has(bare);
}

// -------- Read stdin payload (best-effort, non-blocking) --------

function readStdinSync() {
  try {
    // Skip read on a TTY (would block forever on a manual run with no input).
    // Anything else — pipe, socket, file redirect — is fair game and we
    // attempt the read. spawnSync({input}) hands us a pipe across platforms,
    // but fstat reports it differently (FIFO on Linux, socket on macOS), so
    // we use a positive TTY check rather than a positive FIFO check.
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

// Pre-flight allowlist short-circuit: when the inbound Skill call names a
// skill on PRE_DISPATCH_SKILL_ALLOWLIST, allow it regardless of dispatch
// state. The commands' pre-flight legitimately needs `resolve-artifact-root`
// before chief-orchestrator runs.
const incomingSkillName =
  (payload.tool_input && (payload.tool_input.skill || payload.tool_input.name)) || '';
if (isAllowlistedSkillName(incomingSkillName)) {
  process.exit(0);
}

const transcriptPath =
  payload.transcript_path ||
  process.env.CLAUDE_TRANSCRIPT_PATH ||
  '';

if (!transcriptPath || !fs.existsSync(transcriptPath)) {
  // No transcript available — fail open.
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

// Distinctive substrings from commands/task.md body — used as a fallback
// when slash-command expansion replaces the literal command text in the
// transcript. Keep these in sync with the command file if it changes.
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
  // Claude Code transcript shape: top-level may be {type: 'user'|'assistant',
  // message: {role, content}} or directly {role, content}. Handle both.
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
  // Skill call is not in the context of a /task invocation — allow.
  process.exit(0);
}

// -------- Has chief-orchestrator already been dispatched? --------

function isChiefOrchestratorDispatch(toolUse) {
  if (!toolUse || toolUse.name !== 'Task') return false;
  const input = toolUse.input || {};
  const sub = String(input.subagent_type || '');
  // Match both bare and namespaced forms.
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

// -------- Block --------

const toolName =
  (payload.tool_input && payload.tool_input.skill) ||
  (payload.tool_name === 'Skill' ? '<unknown skill>' : payload.tool_name) ||
  'Skill';

console.error(
  `[guard-main-thread-skills] BLOCKED: main thread attempted to invoke ` +
    `${toolName} before dispatching chief-orchestrator.\n` +
    `\n` +
    `Per /ai-agents-workflow:task, the main thread MUST hand off to the ` +
    `chief-orchestrator subagent as its first substantive action. Skills ` +
    `are fully available INSIDE dispatched agents (chief-orchestrator, ` +
    `Delivery PM, Lead, Executor, Reviewer, Integration Checker), where ` +
    `their work is captured in ai-work.md and reviewable.\n` +
    `\n` +
    `Resolution: call Task with subagent_type "ai-agents-workflow:chief-orchestrator" ` +
    `and pass the original task description verbatim. Run any helpful ` +
    `skills inside that dispatch turn (or in downstream subagents).\n`,
);
process.exit(1);

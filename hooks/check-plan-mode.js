#!/usr/bin/env node
/**
 * PreToolUse hook: check-plan-mode (blocking)
 *
 * Purpose
 * -------
 * Block dispatch of the chief-orchestrator subagent while Claude Code's
 * native plan mode is active. The orchestrator performs file writes
 * (task-data.md, orchestration-state.json, ai-work.md skeletons), which
 * violate plan mode's read-only contract.
 *
 * This hook replaces the command-level pre-flight check that previously
 * lived in commands/task.md. The hook is the single source of truth.
 *
 * Detection
 * ---------
 * The Claude Code harness injects a system-reminder containing the literal
 * string "Plan mode is active" into every assistant turn while plan mode is
 * on. The banner disappears the moment plan mode is exited (Shift+Tab).
 *
 * Algorithm:
 *   1. If subagent is not chief-orchestrator → exit 0 (this hook only gates
 *      that specific dispatch).
 *   2. Read the transcript JSONL.
 *   3. Locate the most recent assistant turn.
 *   4. Search that turn (and the system-reminder messages immediately
 *      preceding it within the same turn boundary) for the literal banner
 *      string "Plan mode is active".
 *   5. Banner present → block with the canonical message.
 *      Banner absent → exit 0 (allow).
 *
 * Failure modes (transcript missing, malformed, unreadable) all fall through
 * to allow — the hook never blocks on uncertainty about its own inputs.
 *
 * Exit semantics:
 *   0 — allow
 *   1 — block (stderr carries the actionable message from
 *       hooks/lib/plan-mode-message.js)
 *
 * Kill switch
 * -----------
 * Set AIAW_DISABLE_PLAN_MODE_GUARD=1 in the environment to bypass this hook.
 * Intended only for emergency override if the detection misbehaves.
 */

'use strict';

const fs = require('fs');
const { PLAN_MODE_MESSAGE } = require('./lib/plan-mode-message');

// -------- Kill switch --------

if (process.env.AIAW_DISABLE_PLAN_MODE_GUARD === '1') {
  process.exit(0);
}

// -------- Subagent filter --------

const rawSubagent = process.env.CLAUDE_TOOL_INPUT_SUBAGENT_TYPE || '';
// Match both bare ("chief-orchestrator") and namespaced
// ("ai-agents-workflow:chief-orchestrator") forms.
const subagent = rawSubagent.includes(':')
  ? rawSubagent.split(':').pop()
  : rawSubagent;

if (subagent !== 'chief-orchestrator') {
  process.exit(0);
}

// -------- Read stdin payload (best-effort) --------

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
  payload.transcript_path ||
  process.env.CLAUDE_TRANSCRIPT_PATH ||
  '';

if (!transcriptPath || !fs.existsSync(transcriptPath)) {
  // No transcript available — fail open.
  process.exit(0);
}

// -------- Parse transcript --------

let lines;
try {
  lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
} catch (_) {
  process.exit(0);
}

const PLAN_MODE_BANNER = 'Plan mode is active';

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

function entryText(entry) {
  // Top-level transcript shapes vary: {type, message: {role, content}} or
  // {role, content} directly. Handle both.
  const content =
    (entry.message && entry.message.content) || entry.content || '';
  return extractText(content);
}

// Walk backwards. Find the most recent assistant turn. Capture its text and
// any user-typed text from the system-reminder messages that precede it
// within the same turn boundary (i.e., back to the most recent user message).
let lastUserIndex = -1;
let lastAssistantIndex = -1;

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
  if (role === 'assistant' && lastAssistantIndex === -1) {
    lastAssistantIndex = i;
  }
  if (role === 'user') {
    lastUserIndex = i;
    break;
  }
}

// If we have no assistant turn at all, plan mode banner cannot meaningfully
// "be on for the most recent assistant turn" — allow.
if (lastAssistantIndex === -1) {
  process.exit(0);
}

// The banner is injected as part of the user-message system-reminder block
// for the upcoming assistant turn. So the relevant scan window is from
// max(lastUserIndex, 0) inclusive through the end of the transcript: the
// banner is present in the most-recent user/system block iff plan mode is
// currently active.
const scanStart = lastUserIndex === -1 ? 0 : lastUserIndex;
let bannerSeen = false;
for (let i = scanStart; i < lines.length; i++) {
  let entry;
  try {
    entry = JSON.parse(lines[i]);
  } catch (_) {
    continue;
  }
  if (entryText(entry).includes(PLAN_MODE_BANNER)) {
    bannerSeen = true;
    break;
  }
}

if (!bannerSeen) {
  process.exit(0);
}

// -------- Block --------

console.error(`[check-plan-mode] BLOCKED: ${PLAN_MODE_MESSAGE}\n`);
process.exit(1);

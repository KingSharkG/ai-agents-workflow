#!/usr/bin/env node
/**
 * UserPromptSubmit hook: block-aiaw-task-in-plan-mode (blocking)
 *
 * Purpose
 * -------
 * Backstop for the PreToolUse plan-mode guard. Surface the canonical
 * "press Shift+Tab" message BEFORE the model gets a chance to misroute the
 * request into plan-mode planning behavior (write a plan doc / call
 * ExitPlanMode) instead of dispatching `chief-orchestrator`.
 *
 * The PreToolUse `check-plan-mode` hook only fires if the main thread
 * actually attempts `Task(chief-orchestrator)`. In plan mode the model is
 * strongly steered away from that path — it often never tries, and the
 * user sees no error at all, just a plan being written. This hook closes
 * that gap by blocking the prompt itself.
 *
 * Detection
 * ---------
 * Claude Code passes a JSON payload on stdin for UserPromptSubmit:
 *   {
 *     session_id, transcript_path, cwd, hook_event_name, prompt,
 *     permission_mode: "default" | "plan" | "acceptEdits" | ...
 *   }
 *
 * Plan mode is the `permission_mode === "plan"` case — deterministic, no
 * transcript scanning needed.
 *
 * Match scope
 * -----------
 * All AIAW slash commands that dispatch a subagent which writes files are
 * gated here. The full set:
 *
 *   /ai-agents-workflow:task          → chief-orchestrator → writes
 *   /ai-agents-workflow:continue      → resume-orchestrator → chief → writes
 *   /ai-agents-workflow:init          → init agent → writes PROJECT_CONFIG.md
 *   /ai-agents-workflow:add           → init agent → writes PROJECT_CONFIG.md
 *   /ai-agents-workflow:update        → init agent → writes PROJECT_CONFIG.md
 *   /ai-agents-workflow:remove        → init agent → writes PROJECT_CONFIG.md
 *   /ai-agents-workflow:pr-lessons    → pr-lessons-harvester → writes pr-lessons.md
 *   /ai-agents-workflow:review        → can write a review artifact
 *
 * All these commands have the same shape of failure: in plan mode, the
 * model is steered toward writing a plan document instead of dispatching,
 * so the PreToolUse `check-plan-mode` guard never fires and the user sees
 * planning behavior instead of the canonical "press Shift+Tab" message.
 *
 * Exit semantics
 * --------------
 *   0 — allow
 *   2 — block (stderr message surfaced to the USER)
 *
 * Note on exit codes: this hook exits 2, while the companion PreToolUse hook
 * `hooks/check-plan-mode.js` exits 1. The difference is harness-prescribed,
 * not stylistic. For UserPromptSubmit, exit-2 stderr is shown to the **user**
 * before any model turn runs — which is what we want here, since the
 * actionable instruction ("press Shift+Tab") is for the human. For PreToolUse,
 * exit-1 cancels the tool call and surfaces stderr to the **model**; that's
 * the right escalation when the model is mid-loop and the harness needs to
 * tell it to back off. Same UX outcome from the user's perspective, different
 * delivery channel.
 *
 * Kill switch
 * -----------
 *   AIAW_DISABLE_PLAN_MODE_GUARD=1 bypasses (same env as check-plan-mode).
 */

'use strict';

const fs = require('fs');
const { planModeMessageFor } = require('./lib/plan-mode-message');

if (process.env.AIAW_DISABLE_PLAN_MODE_GUARD === '1') {
  process.exit(0);
}

function readStdinSync() {
  try {
    const stat = fs.fstatSync(0);
    if (stat && stat.isCharacterDevice() && process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

const raw = readStdinSync();
if (!raw) {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch (_) {
  process.exit(0);
}

const permissionMode = payload.permission_mode || '';
if (permissionMode !== 'plan') {
  process.exit(0);
}

// Some harness versions may pass `prompt` as an array of content parts
// (`{type: "text", text: "..."}`) rather than a flat string. Coerce both
// shapes; anything else (object, null) falls back to empty → allow.
function coercePrompt(p) {
  if (typeof p === 'string') return p;
  if (Array.isArray(p)) {
    return p
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('\n');
  }
  return '';
}

const prompt = coercePrompt(payload.prompt);

// Match the slash command at the very start of the prompt (after optional
// leading whitespace). The slash-command form is what the harness expands
// to the actual command file — natural-language invocations route
// differently and are out of scope for this hook.
const GATED = /^\s*\/(ai-agents-workflow:(?:task|continue|init|add|update|remove|pr-lessons|review))(?=\s|$)/;
const match = prompt.match(GATED);
if (!match) {
  process.exit(0);
}

const command = match[1];
console.error(`[block-aiaw-task-in-plan-mode] BLOCKED: ${planModeMessageFor(command)}\n`);
process.exit(2);

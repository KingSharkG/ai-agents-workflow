'use strict';

/**
 * Canonical user-facing message surfaced when Claude Code's native plan mode
 * is active and an ai-agents-workflow command would dispatch a subagent that
 * performs file writes.
 *
 * Single source of truth for this string. Imported by:
 *   - hooks/check-plan-mode.js (PreToolUse blocker on Task) — uses
 *     `PLAN_MODE_MESSAGE` directly (only `/task` reaches that hook today).
 *   - hooks/block-aiaw-task-in-plan-mode.js (UserPromptSubmit backstop) —
 *     uses `planModeMessageFor(cmd)` since multiple commands are gated.
 *
 * The `/ai-agents-workflow:task` branch preserves the historical wording
 * verbatim — downstream consumers and tests may grep for it. New commands
 * get a generic command-aware variant.
 */

function planModeMessageFor(command) {
  const cmd = (command || 'ai-agents-workflow:task').replace(/^\//, '');
  if (cmd === 'ai-agents-workflow:task') {
    return (
      "Plan mode is on — `/ai-agents-workflow:task` needs to call the `Task` " +
      'tool, which plan mode blocks. Press `Shift+Tab` to exit plan mode, then ' +
      're-run this command.'
    );
  }
  return (
    `Plan mode is on — \`/${cmd}\` dispatches subagents that write files, ` +
    'which plan mode blocks. Press `Shift+Tab` to exit plan mode, then ' +
    're-run this command.'
  );
}

// Back-compat alias — computed from the function so the two never drift.
const PLAN_MODE_MESSAGE = planModeMessageFor('ai-agents-workflow:task');

module.exports = { PLAN_MODE_MESSAGE, planModeMessageFor };

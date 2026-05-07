'use strict';

/**
 * Canonical user-facing message surfaced when Claude Code's native plan mode
 * is active and the chief-orchestrator subagent is about to be dispatched.
 *
 * Single source of truth for this string. Imported by:
 *   - hooks/check-plan-mode.js (PreToolUse blocker)
 *
 * The message text is verbatim from the original pre-flight check that lived
 * in commands/task.md. Keep the wording stable — users may match against it.
 */

const PLAN_MODE_MESSAGE =
  "Plan mode is on — `/ai-agents-workflow:task` needs to call the `Task` " +
  'tool, which plan mode blocks. Press `Shift+Tab` to exit plan mode, then ' +
  're-run this command.';

module.exports = { PLAN_MODE_MESSAGE };

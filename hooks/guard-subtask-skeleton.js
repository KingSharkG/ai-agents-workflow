#!/usr/bin/env node
/**
 * PreToolUse hook: guard-subtask-skeleton (blocking)
 * Before any agent dispatch (Task tool), verifies that the ai-work.md skeleton
 * exists for the target subtask. Blocks dispatch if missing.
 *
 * Exempt agents: chief-orchestrator, delivery-pm (they may dispatch without a skeleton).
 *
 * Env vars read:
 *   CLAUDE_TOOL_INPUT_SUBAGENT_TYPE — agent role being dispatched
 *   CLAUDE_TOOL_INPUT_PROMPT        — agent prompt (parsed for task_id + subtask_id)
 */

const fs = require('fs');
const path = require('path');

const EXEMPT_AGENTS = ['chief-orchestrator', 'delivery-pm'];

const subagentType = process.env.CLAUDE_TOOL_INPUT_SUBAGENT_TYPE || '';
const prompt = process.env.CLAUDE_TOOL_INPUT_PROMPT || '';

// Skip if exempt
if (!subagentType || EXEMPT_AGENTS.includes(subagentType)) {
  process.exit(0);
}

// Parse task_id: LETTERS-TAG-NNN (e.g. FEAT-V1-042)
const taskIdMatch = prompt.match(/\b([A-Z]{2,}-[A-Z0-9]+-\d+)\b/);
// Parse subtask_id: LETTERS-NNN (e.g. A-003) or LETTERS-LETTER+N (e.g. B-A1)
const subtaskIdMatch = prompt.match(/\b([A-Z]{1,2}-\d{3}|[A-Z]+-[A-Z]\d+)\b/);

if (!taskIdMatch || !subtaskIdMatch) {
  // Cannot determine task/subtask — let dispatch proceed (cannot safely block)
  process.exit(0);
}

const taskId = taskIdMatch[1];
const subtaskId = subtaskIdMatch[1];

// Search for ai-work.md under ai-workflow-data/tasks/<task_id>/**/<subtask_id>/ai-work.md
const taskDir = path.join('ai-workflow-data', 'tasks', taskId);

if (!fs.existsSync(taskDir)) {
  // Task directory doesn't exist — orchestrator hasn't set up the task yet
  console.error(
    `[guard-subtask-skeleton] BLOCKED: task directory not found: ${taskDir}\n` +
    `Chief Orchestrator must create ai-workflow-data/tasks/${taskId}/task-data.md before dispatching any agent.\n`,
  );
  process.exit(1);
}

// Recursively search for <subtask_id>/ai-work.md
const findSkeletonPath = (dir, subtaskId) => {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === subtaskId) {
          const candidate = path.join(dir, entry.name, 'ai-work.md');
          if (fs.existsSync(candidate)) return candidate;
        }
        // Recurse into phase directories
        const nested = findSkeletonPath(path.join(dir, entry.name), subtaskId);
        if (nested) return nested;
      }
    }
  } catch (_) {}
  return null;
};

const skeletonPath = findSkeletonPath(taskDir, subtaskId);

if (!skeletonPath) {
  console.error(
    `[guard-subtask-skeleton] BLOCKED: ai-work.md skeleton not found for ${subtaskId}.\n` +
    `Chief Orchestrator must write ai-workflow-data/tasks/${taskId}/phase-X/${subtaskId}/ai-work.md\n` +
    `using the template from ${process.env.CLAUDE_PLUGIN_ROOT || ''}/ai/governance/ARTIFACT_DISCIPLINE.md → section:ai-work-skeleton\n` +
    `before dispatching ${subagentType}.\n`,
  );
  process.exit(1);
}

process.exit(0);

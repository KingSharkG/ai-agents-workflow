#!/usr/bin/env node
/**
 * PreToolUse hook: guard-subtask-skeleton (blocking)
 * Before any agent dispatch (Task tool), verifies pre-dispatch invariants:
 *
 *   1. Governance files required by the target role exist (Gap 4)
 *   2. ai-work.md skeleton exists for the target subtask (original check)
 *   3. orchestration-state.json is valid if present (Gap 3 read-side)
 *   4. Dispatch bundle (roles/<role>.md) exists (Gap 1)
 *
 * Exemptions (granular):
 *   chief-orchestrator — exempt from ALL checks (no bundle, no skeleton)
 *   delivery-pm        — exempt from skeleton + state checks; needs governance + bundle (task-level)
 *
 * Env vars read:
 *   CLAUDE_TOOL_INPUT_SUBAGENT_TYPE — agent role being dispatched
 *   CLAUDE_TOOL_INPUT_PROMPT        — agent prompt (parsed for task_id + subtask_id)
 *   CLAUDE_PLUGIN_ROOT              — plugin installation root
 */

const fs = require('fs');
const path = require('path');
const { resolvePluginRoot } = require('./_resolve-plugin-root');

const PLUGIN_ROOT = resolvePluginRoot();

// Strip plugin namespace prefix if present (e.g., "ai-agents-workflow:executor" → "executor").
// The Claude Code plugin system provides namespaced types but all role comparisons use bare names.
const rawSubagentType = process.env.CLAUDE_TOOL_INPUT_SUBAGENT_TYPE || '';
const subagentType = rawSubagentType.includes(':')
  ? rawSubagentType.split(':').pop()
  : rawSubagentType;
const prompt = process.env.CLAUDE_TOOL_INPUT_PROMPT || '';

// chief-orchestrator is exempt from all checks
if (!subagentType || subagentType === 'chief-orchestrator') {
  process.exit(0);
}

// --- Gap 4: Governance file existence ---
// Role-to-governance mapping derived from context-minimizer skill.
// Only roles whose bundles include governance excerpts are listed.
// Role-to-governance mapping derived from context-minimizer skill.
// All roles that receive governance excerpts in their dispatch bundles are listed.
const ROLE_GOVERNANCE_FILES = {
  executor: ['ai/core/PROJECT_CONSTITUTION.md'],
  reviewer: ['ai/core/PROJECT_CONSTITUTION.md', 'ai/governance/REVIEW_CHECKLIST.md'],
  'delivery-pm': ['ai/governance/TRIGGER_RULES.md'],
  lead: ['ai/core/PROJECT_CONSTITUTION.md', 'ai/governance/TRIGGER_RULES.md'],
  'design-agent': ['ai/core/PROJECT_CONSTITUTION.md'],
  'integration-checker': ['ai/core/PROJECT_CONSTITUTION.md'],
};

// Validate PLUGIN_ROOT is a real installation before checking governance files.
// If the install is broken/mid-update, warn instead of hard-blocking.
const pluginMarker = path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');
const pluginRootValid = fs.existsSync(pluginMarker);

if (!pluginRootValid) {
  console.error(
    `[guard-subtask-skeleton] WARNING: plugin root appears invalid (no .claude-plugin/plugin.json).\n` +
      `Resolved PLUGIN_ROOT: ${PLUGIN_ROOT}\n` +
      `Skipping governance file checks. If this persists, reinstall:\n` +
      `  /plugin uninstall ai-agents-workflow\n` +
      `  /plugin install ai-agents-workflow@ai-agents-workflow\n`,
  );
} else {
  const governanceFiles = ROLE_GOVERNANCE_FILES[subagentType] || [];
  for (const relPath of governanceFiles) {
    const absPath = path.join(PLUGIN_ROOT, relPath);
    if (!fs.existsSync(absPath)) {
      console.error(
        `[guard-subtask-skeleton] BLOCKED: governance file not found: ${relPath}\n` +
          `Required by ${subagentType} for dispatch bundle assembly.\n` +
          `Expected at: ${absPath}\n`,
      );
      process.exit(1);
    }
  }
}

// Parse task_id: supports both 2-segment (e.g. TP-002) and 3-segment (e.g. FEAT-V1-042) formats.
// Try 3-segment first (more specific), then fall back to 2-segment.
const taskIdMatch =
  prompt.match(/\b([A-Z]{2,}-[A-Z0-9]+-\d+)\b/) ||
  prompt.match(/\b([A-Z]{2,}-\d+)\b/);

if (!taskIdMatch) {
  // Cannot determine task — let dispatch proceed (cannot safely block)
  process.exit(0);
}

const taskId = taskIdMatch[1];
const taskDir = path.join('ai-workflow-data', 'tasks', taskId);

if (!fs.existsSync(taskDir)) {
  console.error(
    `[guard-subtask-skeleton] BLOCKED: task directory not found: ${taskDir}\n` +
      `Chief Orchestrator must create ai-workflow-data/tasks/${taskId}/task-data.md before dispatching any agent.\n`,
  );
  process.exit(1);
}

// delivery-pm operates at task level — skip skeleton, state, and subtask-level bundle checks
if (subagentType === 'delivery-pm') {
  // Check task-level bundle only
  const bundlePath = path.join(taskDir, 'roles', 'delivery-pm.md');
  if (!fs.existsSync(bundlePath)) {
    console.error(
      `[guard-subtask-skeleton] BLOCKED: dispatch bundle not found for delivery-pm.\n` +
        `Chief Orchestrator must write ${bundlePath}\n` +
        `using the context-minimizer skill before dispatching delivery-pm.\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

// --- Subtask-level checks (all agents except chief-orchestrator and delivery-pm) ---

// Parse subtask_id. Subtask directories use the full compound ID: <taskId>-<suffix>.
// Examples: TP-002-A1, FEAT-V1-042-B-A1, TP-001-IC-F4.
// Strategy: find all occurrences of "<taskId>-<suffix>" in the prompt where <suffix>
// is one or more alphanumeric segments separated by hyphens (e.g. A1, B-A1, IC-F4).
// Also support the legacy standalone format: LETTERS-NNN (e.g. A-003) or LETTERS-LETTER+N (e.g. B-A1).
const compoundSubtaskRegex = new RegExp(
  taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-([A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)',
  'g',
);
let subtaskId = null;
let compoundMatch;
while ((compoundMatch = compoundSubtaskRegex.exec(prompt)) !== null) {
  // Use the full compound ID (taskId + suffix) as the subtask directory name
  subtaskId = compoundMatch[0];
}

// Fallback: try legacy standalone format
if (!subtaskId) {
  const promptWithoutTaskId = prompt.replace(taskId, '');
  const legacyMatch = promptWithoutTaskId.match(/\b([A-Z]{1,2}-\d{3}|[A-Z]+-[A-Z]\d+)\b/);
  if (legacyMatch) {
    subtaskId = legacyMatch[1];
  }
}

if (!subtaskId) {
  // Cannot determine subtask — let dispatch proceed (cannot safely block)
  process.exit(0);
}

// --- Original check: ai-work.md skeleton existence ---

const findSkeletonPath = (dir, targetId) => {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === targetId) {
          const candidate = path.join(dir, entry.name, 'ai-work.md');
          if (fs.existsSync(candidate)) return candidate;
        }
        // Recurse into phase directories
        const nested = findSkeletonPath(path.join(dir, entry.name), targetId);
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
      `using the template from ${PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md → section:ai-work-skeleton\n` +
      `before dispatching ${subagentType}.\n`,
  );
  process.exit(1);
}

// --- Gap 3 (read-side): orchestration-state.json validation ---
// If the file exists, validate it is well-formed JSON with required fields.
// If the file does not exist, skip — valid for first subtask dispatch.
const statePath = path.join(taskDir, 'orchestration-state.json');

if (fs.existsSync(statePath)) {
  let stateContent;
  try {
    stateContent = fs.readFileSync(statePath, 'utf8');
  } catch (e) {
    console.error(
      `[guard-subtask-skeleton] BLOCKED: cannot read orchestration-state.json — ${e.message}\n` +
        `File: ${statePath}\n`,
    );
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(stateContent);
  } catch (e) {
    console.error(
      `[guard-subtask-skeleton] BLOCKED: orchestration-state.json is malformed JSON — ${e.message}\n` +
        `File: ${statePath}\n` +
        `Chief Orchestrator must rewrite this file with valid JSON before dispatching ${subagentType}.\n`,
    );
    process.exit(1);
  }

  const requiredFields = ['task_id', 'phase', 'completed_subtasks', 'pending_subtasks'];
  const missingFields = requiredFields.filter((f) => !(f in parsed));
  if (missingFields.length > 0) {
    console.error(
      `[guard-subtask-skeleton] BLOCKED: orchestration-state.json is missing required fields: ${missingFields.join(', ')}\n` +
        `File: ${statePath}\n` +
        `Chief Orchestrator must include all required fields before dispatching ${subagentType}.\n`,
    );
    process.exit(1);
  }
}

// --- Gap 1: Dispatch bundle existence ---
// Bundle lives at <subtask_dir>/roles/<role>.md (derived from skeleton path).
const subtaskDir = path.dirname(skeletonPath);
const bundlePath = path.join(subtaskDir, 'roles', `${subagentType}.md`);

if (!fs.existsSync(bundlePath)) {
  console.error(
    `[guard-subtask-skeleton] BLOCKED: dispatch bundle not found for ${subagentType}.\n` +
      `Expected at: ${bundlePath}\n` +
      `Chief Orchestrator must run context-minimizer skill to write the dispatch bundle\n` +
      `before dispatching ${subagentType} for subtask ${subtaskId}.\n`,
  );
  process.exit(1);
}

process.exit(0);

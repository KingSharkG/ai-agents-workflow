#!/usr/bin/env node
/**
 * PostToolUse hook: validate-artifact-chain
 * After a Write or Edit, checks that the written file has the required fields
 * for its artifact type. Exits non-zero if validation fails.
 *
 * Called with the written file path as argv[2].
 */

const fs = require('fs');
const path = require('path');

const filePath = process.argv[2] || '';

if (!filePath || !fs.existsSync(filePath)) {
  process.exit(0);
}

const content = fs.readFileSync(filePath, 'utf8');
const fileName = path.basename(filePath).toLowerCase();
const lc = content.toLowerCase();

const countMatches = (regex) => (content.match(regex) || []).length;
const hasHeading = (heading) =>
  new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'im').test(content);

const hasVariant = (field, variants) => {
  if (lc.includes(field)) return true;
  return variants.some((variant) => lc.includes(variant));
};

const getSectionCounts = () => {
  const openSections = [...content.matchAll(/<!--\s*section:([a-z0-9-]+)\s*-->/gi)].map(
    (match) => match[1].toLowerCase(),
  );
  const closeSections = [...content.matchAll(/<!--\s*\/section:([a-z0-9-]+)\s*-->/gi)].map(
    (match) => match[1].toLowerCase(),
  );

  const openCounts = new Map();
  const closeCounts = new Map();

  for (const name of openSections) {
    openCounts.set(name, (openCounts.get(name) || 0) + 1);
  }

  for (const name of closeSections) {
    closeCounts.set(name, (closeCounts.get(name) || 0) + 1);
  }

  return { openCounts, closeCounts };
};

const validatePairedSectionMarkers = (artifactName) => {
  const { openCounts, closeCounts } = getSectionCounts();
  const allNames = new Set([...openCounts.keys(), ...closeCounts.keys()]);
  const mismatched = [...allNames].filter(
    (name) => (openCounts.get(name) || 0) !== (closeCounts.get(name) || 0),
  );

  if (mismatched.length > 0) {
    console.error(
      `[validate-artifact-chain] INVALID ${artifactName}: unpaired section markers: ${mismatched.join(', ')}\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
};

const validateOptionalSectionSchema = () => {
  if (!matched.requiredSections) {
    return;
  }

  const hasAnySectionMarkers =
    countMatches(/<!--\s*section:[a-z0-9-]+\s*-->/gi) > 0 ||
    countMatches(/<!--\s*\/section:[a-z0-9-]+\s*-->/gi) > 0;

  if (!hasAnySectionMarkers) {
    return;
  }

  validatePairedSectionMarkers(matched.name);

  const missing = matched.requiredSections.filter(
    (name) => countMatches(new RegExp(`<!--\\s*section:${name}\\s*-->`, 'gi')) === 0,
  );

  if (missing.length > 0) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: missing canonical section markers: ${missing.join(', ')}\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
};

const validateReviewerSummaryExists = () => {
  // When the review section of ai-work.md has content (not an empty skeleton),
  // the Reviewer must also have written a sibling summary.md in the same directory.
  if (matched.name !== 'ai-work.md') {
    return;
  }

  // Detect canonical section:review AND non-canonical variants (section:review-report,
  // section:review-cycle*, etc.) to catch reviewers using wrong section names.
  const hasReviewContent =
    /<!--\s*section:review[\w-]*\s*-->/i.test(content) &&
    /<!--\s*section:review[\w-]*\s*-->\s*\S/i.test(content);

  if (!hasReviewContent) {
    return; // No review content — skip
  }

  const dir = path.dirname(filePath);
  const summaryPath = path.join(dir, 'summary.md');

  if (!fs.existsSync(summaryPath)) {
    console.error(
      `[validate-artifact-chain] INVALID ai-work.md: review section is populated but\n` +
        `${summaryPath} does not exist.\n` +
        `Reviewer must write summary.md on approval before the subtask is considered done.\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
};

// Telemetry and context-manifest diagnostics are now written to summary.md,
// not ai-work.md. No ai-work.md footer validation needed.

const validateAiWorkDiagnosticsLocation = () => {
  if (matched.name !== 'ai-work.md') {
    return;
  }

  const forbiddenSections = ['telemetry', 'context-manifest'];
  const present = forbiddenSections.filter(
    (name) => countMatches(new RegExp(`<!--\\s*section:${name}\\s*-->`, 'gi')) > 0,
  );

  if (present.length > 0) {
    console.error(
      `[validate-artifact-chain] INVALID ai-work.md: diagnostic sections belong in summary.md, not ai-work.md: ${present.join(', ')}\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
};

const validateRequiredHeadings = () => {
  if (!matched.requiredHeadings) {
    return;
  }

  const missing = matched.requiredHeadings.filter((heading) => !hasHeading(heading));
  if (missing.length > 0) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: missing required headings: ${missing.join(', ')}\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
};

const getHeadingBlock = (heading) => {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `^##\\s+${escaped}\\b[\\t ]*\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`,
    'im',
  );
  const match = content.match(regex);
  return match ? match[1] : '';
};

const getStatusFieldValue = (fieldName) => {
  const statusBlock = getHeadingBlock('Status');
  if (!statusBlock) {
    return null;
  }

  const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = statusBlock.match(
    new RegExp(`-\\s*\\*\\*${escapedField}\\*\\*:\\s*([^\\n]+)`, 'i'),
  );
  return match ? match[1].trim().toLowerCase() : null;
};

const validateSummaryPlaceholderDrift = () => {
  if (matched.name !== 'Subtask Summary') {
    return;
  }

  const stalePhrases = [/skeleton summary/i, /reviewer fills/i];
  if (stalePhrases.some((pattern) => pattern.test(content))) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: stale placeholder text remains in summary.md.\n` +
      `File: ${filePath}\n`,
    );
    process.exit(1);
  }

  const workflowState = getStatusFieldValue('workflow_state');
  const reviewVerdict = getStatusFieldValue('review_verdict');

  if (reviewVerdict === 'approved' && workflowState === 'needs-replan') {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: review_verdict=approved conflicts with workflow_state=needs-replan.\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }

  if (reviewVerdict === 'changes_requested' && workflowState === 'approved') {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: review_verdict=changes_requested conflicts with workflow_state=approved.\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
};

const validateAcceptanceSignalsTable = () => {
  if (matched.name !== 'Subtask Summary') {
    return;
  }

  if (!hasHeading('Acceptance Signals')) {
    return;
  }

  const requiredColumns = ['Signal', 'State', 'Evidence', 'Notes'];
  const tableHeaderPresent = requiredColumns.every((column) =>
    new RegExp(`\\|\\s*${column}\\s*`, 'i').test(content),
  );

  if (!tableHeaderPresent) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: ## Acceptance Signals must include Signal, State, Evidence, and Notes columns.\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
};

const validatePendingUserActionsSection = () => {
  if (matched.name !== 'Task Summary') {
    return;
  }

  const taskStatusBlock = getHeadingBlock('Task Status');
  const actionsBlock = getHeadingBlock('Pending User Actions').trim();

  if (!taskStatusBlock || !actionsBlock) {
    return;
  }

  const countMatch = taskStatusBlock.match(/\*\*pending_user_action_count\*\*:\s*(\d+)/i);
  if (!countMatch) {
    return;
  }

  const declaredCount = Number.parseInt(countMatch[1], 10);
  const bulletLines = actionsBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));

  if (bulletLines.length === 0) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: ## Pending User Actions must contain bullet items or "- none".\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }

  const hasNoneOnly = bulletLines.length === 1 && /^-\s+none$/i.test(bulletLines[0]);
  const actualCount = hasNoneOnly ? 0 : bulletLines.length;

  if (actualCount !== declaredCount) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: pending_user_action_count=${declaredCount} does not match ## Pending User Actions entries (${actualCount}).\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
};

const validateICVerdictBeforeApproval = () => {
  // When a subtask summary is approved, verify that any populated
  // integration-check section in the sibling ai-work.md contains verdict: ok.
  // This enforces the mandatory IC gate from TRIGGER_RULES.md.
  if (matched.name !== 'Subtask Summary') {
    return;
  }

  const reviewVerdict = getStatusFieldValue('review_verdict');
  if (reviewVerdict !== 'approved') {
    return;
  }

  const workflowState = getStatusFieldValue('workflow_state');
  if (workflowState === 'pending-integration-check') {
    // Explicitly marked as pending IC — allow the write but the subtask
    // won't advance until IC returns ok and workflow_state changes.
    return;
  }

  const dir = path.dirname(filePath);
  const aiWorkPath = path.join(dir, 'ai-work.md');

  if (!fs.existsSync(aiWorkPath)) {
    return;
  }

  const aiWorkContent = fs.readFileSync(aiWorkPath, 'utf8');

  // Check if integration-check section exists and has content beyond placeholder
  const icSectionMatch = aiWorkContent.match(
    /<!--\s*section:integration-check\s*-->([\s\S]*?)<!--\s*\/section:integration-check\s*-->/i,
  );

  if (!icSectionMatch) {
    return; // No IC section at all — IC was not triggered
  }

  const icContent = icSectionMatch[1].trim();

  // If the section is just a placeholder comment, IC was not triggered
  if (!icContent || /^<!--\s*placeholder/i.test(icContent)) {
    return;
  }

  // IC section has content — verify it contains verdict: ok
  if (!/verdict:\s*ok/i.test(icContent)) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: review_verdict=approved but ` +
        `integration-check section does not contain "verdict: ok".\n` +
        `The IC gate must be satisfied before a subtask can be approved.\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
};

const validateSectionedDeliveryPlan = () => {
  validatePairedSectionMarkers('Delivery Plan');

  const requiredExact = [
    'delivery-metadata',
    'delivery-routing',
    'delivery-context-manifest',
    'delivery-telemetry',
  ];
  const missingExact = requiredExact.filter(
    (name) => countMatches(new RegExp(`<!--\\s*section:${name}\\s*-->`, 'gi')) === 0,
  );
  const hasPhase = countMatches(/<!--\s*section:delivery-phase-[a-z0-9-]+\s*-->/gi) > 0;
  const hasSubtask =
    countMatches(/<!--\s*section:delivery-subtask-[a-z0-9-]+\s*-->/gi) > 0;

  const missing = [...missingExact];
  if (!hasPhase) missing.push('delivery-phase-*');
  if (!hasSubtask) missing.push('delivery-subtask-*');

  if (missing.length > 0) {
    console.error(
      `[validate-artifact-chain] INVALID Delivery Plan: missing sectioned-v1 markers: ${missing.join(', ')}\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
};

// Required fields per artifact type (matched by filename or content header)
// Fields are checked case-insensitively against the full file content,
// so they match both JSON keys ("task_id") and markdown headings ("## Task ID").
const ARTIFACT_RULES = [
  // Section-based model: ai-work.md consolidates all per-subtask artifact sections
  {
    name: 'ai-work.md',
    detect: () => fileName === 'ai-work.md',
    required: [],
    requiredSections: ['spec', 'implementation', 'review'],
  },
  {
    name: 'task-data.md',
    detect: () => fileName === 'task-data.md',
    required: ['task_id'],
    requiredSections: ['task-metadata'],
  },
  // Task-level summary: lives at <artifact-root>/tasks/<task_id>/summary.md
  // Detected by grandparent directory being named "tasks".
  // Written by the orchestrator via telemetry-summary skill — no verdict field.
  {
    name: 'Task Summary',
    detect: () =>
      fileName === 'summary.md' &&
      path.basename(path.dirname(path.dirname(filePath))) === 'tasks',
    required: ['task_id'],
    requiredHeadings: [
      'Metadata',
      'Task Status',
      'Changes by Phase',
      'Open Gates',
      'Pending User Actions',
      'Pipeline',
      'Detail',
      'Totals',
      'Context Breakdown',
    ],
  },
  // Subtask-level summary: lives at tasks/<task_id>/[phase-X/]<subtask_id>/summary.md
  // Grandparent is the task folder, not "tasks". Written by the Reviewer — must have verdict.
  {
    name: 'Subtask Summary',
    detect: () =>
      fileName === 'summary.md' &&
      path.basename(path.dirname(path.dirname(filePath))) !== 'tasks',
    required: ['verdict'],
    requiredHeadings: [
      'Status',
      'Acceptance Signals',
      'Files Changed',
      'Dispatch Bundles',
      'Telemetry',
      'Context Manifest',
      'Notes',
      'Open Gates',
    ],
  },
  // Orchestration state: lives at tasks/<task_id>/orchestration-state.json
  // Written by Chief Orchestrator after each subtask completes.
  // Uses JSON-specific validation instead of markdown field checks.
  {
    name: 'orchestration-state.json',
    detect: () => fileName === 'orchestration-state.json',
    required: [],
    jsonValidation: true,
  },
];

const matched = ARTIFACT_RULES.find((rule) => rule.detect());

if (!matched) {
  // Not a recognized artifact — skip validation
  process.exit(0);
}

// --- JSON-specific validation for orchestration-state.json ---
if (matched.jsonValidation) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: malformed JSON — ${e.message}\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }

  // Hot-state required fields only. After the F2 split, `completed_subtasks`
  // and `trigger_decisions` live in `orchestration-history.json`; the hot
  // file no longer requires them. Legacy state files may still carry
  // `completed_subtasks` — tolerated (extra fields are not an error).
  const requiredFields = [
    'task_id',
    'mode',
    'phase',
    'pending_subtasks',
    'blocked_gates',
    'pending_user_actions',
    'task_summary_path',
  ];
  const missingFields = requiredFields.filter((f) => !(f in parsed));
  if (missingFields.length > 0) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: missing required fields: ${missingFields.join(', ')}\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }

  const validModes = ['normal', 'degraded-inline'];
  if (!validModes.includes(parsed.mode)) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: mode must be one of: ${validModes.join(', ')}; got "${parsed.mode}"\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }

  const validPhases = ['planning', 'planned', 'execution', 'blocked', 'complete'];
  if (!validPhases.includes(parsed.phase)) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: phase must be one of: ${validPhases.join(', ')}; got "${parsed.phase}"\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }

  // `completed_subtasks` moved to orchestration-history.json in the F2 split.
  // If the hot file still carries it (legacy), verify the type; absence is OK.
  if (
    !Array.isArray(parsed.pending_subtasks) ||
    !Array.isArray(parsed.blocked_gates) ||
    !Array.isArray(parsed.pending_user_actions) ||
    ('completed_subtasks' in parsed && !Array.isArray(parsed.completed_subtasks))
  ) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: pending_subtasks, blocked_gates, and pending_user_actions must be arrays (and completed_subtasks when present)\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }

  if (
    parsed.phase === 'complete' &&
    (parsed.pending_subtasks.length > 0 ||
      parsed.blocked_gates.length > 0 ||
      parsed.pending_user_actions.length > 0)
  ) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: phase "complete" requires empty pending_subtasks, blocked_gates, and pending_user_actions.\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }

  // Task-level summary precondition: when state is being written with
  // phase: complete, the sibling <task_id>/summary.md must exist with a
  // populated `## Status` heading. Per-subtask summary.md presence is NOT
  // checked here (acceptable to skip on execution-simple).
  if (parsed.phase === 'complete') {
    const taskDir = path.dirname(filePath);
    const taskSummaryPath = path.join(taskDir, 'summary.md');
    let summaryContent = null;
    try {
      summaryContent = fs.readFileSync(taskSummaryPath, 'utf8');
    } catch (_) {
      // missing or unreadable
    }
    let statusBlock = null;
    if (summaryContent !== null) {
      const m = summaryContent.match(/^##\s+(?:Task\s+)?Status\b[^\n]*\n([\s\S]*?)(?=^##\s+|$(?![\r\n]))/im);
      statusBlock = m ? m[1].trim() : null;
    }
    if (!statusBlock) {
      console.error(
        `[validate-artifact-chain] INVALID ${matched.name}: cannot mark task complete — ` +
          `task-level summary is missing or has empty ## Status section.\n` +
          `Expected: ${taskSummaryPath}\n` +
          `Resolution: invoke the telemetry-summary skill to finalize the task summary ` +
          `(populated ## Status, ## Changes by Phase, per-subtask totals) BEFORE writing ` +
          `phase: "complete" to ${path.basename(filePath)}.\n` +
          `File: ${filePath}\n`,
      );
      process.exit(1);
    }
  }

  if (
    typeof parsed.current_focus === 'string' &&
    /all\s+\d+\s+subtasks\s+pass/i.test(parsed.current_focus) &&
    (parsed.pending_subtasks.length > 0 ||
      parsed.blocked_gates.length > 0 ||
      parsed.pending_user_actions.length > 0)
  ) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: current_focus overstates completion while pending work or gates remain.\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }

  // JSON validation passed — skip markdown-oriented checks
  process.exit(0);
}

const missing = matched.required.filter((field) => {
  // Check the field name and its underscore→space variant against file content
  return !hasVariant(field, [field.replace(/_/g, ' ')]);
});

if (missing.length > 0) {
  console.error(
    `[validate-artifact-chain] INVALID ${matched.name}: missing required fields: ${missing.join(', ')}\n` +
      `File: ${filePath}\n`,
  );
  process.exit(1);
}

validateReviewerSummaryExists();
validateOptionalSectionSchema();
validateAiWorkDiagnosticsLocation();
validateRequiredHeadings();
validateSummaryPlaceholderDrift();
validateAcceptanceSignalsTable();
validatePendingUserActionsSection();
validateICVerdictBeforeApproval();

// Run delivery plan section validation whenever task-data.md contains a
// delivery-plan block. plan_format: sectioned-v1 is mandatory in v1 — if the
// block is present but the marker is missing, fail explicitly.
if (matched.name === 'task-data.md' && lc.includes('<!-- section:delivery-plan -->')) {
  if (!lc.includes('plan_format') || !lc.includes('sectioned-v1')) {
    console.error(
      `[validate-artifact-chain] INVALID task-data.md: delivery-plan block is missing required markers plan_format: sectioned-v1\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
  validateSectionedDeliveryPlan();
}

process.exit(0);

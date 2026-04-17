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

const validateCommonArtifactFooters = () => {
  // Only ai-work.md uses the generic `context-manifest` / `telemetry` section
  // names validated here. task-data.md uses prefixed names (task-context-manifest,
  // delivery-context-manifest, etc.) so it is excluded from this check.
  if (matched.name !== 'ai-work.md') {
    return;
  }

  // Extract section content so we can check format without false-firing on
  // empty skeletons (skeleton sections are valid but contain no payload yet).
  const telemetryContent =
    content.match(/<!--\s*section:telemetry\s*-->([\s\S]*?)<!--\s*\/section:telemetry\s*-->/i)?.[1] || '';
  const contextContent =
    content.match(/<!--\s*section:context-manifest\s*-->([\s\S]*?)<!--\s*\/section:context-manifest\s*-->/i)?.[1] || '';

  // Skip content-format checks when the skeleton is still empty
  if (!telemetryContent.trim() && !contextContent.trim()) {
    return;
  }

  const missing = [];

  // Validate telemetry payload format when telemetry section has content
  if (telemetryContent.trim()) {
    const hasCompactTelemetry =
      /\d+\s*\/\s*\d+\s*turns\s*\|\s*tokens:\s*~?[^\n|]+\s*\/\s*~?[^\n|]+\s*\|\s*skills:\s*(low|medium|high)\s*\|\s*plugins:\s*(low|medium|high)\s*\|\s*(ok|over_budget)/i.test(
        telemetryContent,
      );
    const hasExpandedTelemetry =
      /turns_used/.test(telemetryContent) && /tokens_in_estimate/.test(telemetryContent);

    if (!hasCompactTelemetry && !hasExpandedTelemetry) {
      missing.push('canonical telemetry payload in section:telemetry');
    }
  }

  // Validate context manifest has a totals line when it has content
  if (contextContent.trim()) {
    const lcc = contextContent.toLowerCase();
    const hasManifestTotals =
      lcc.includes('totals:') || lcc.includes('bucket totals:') || lcc.includes('totals line of zeros');

    if (!hasManifestTotals) {
      missing.push('totals line in section:context-manifest');
    }
  }

  if (missing.length > 0) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: missing required content: ${missing.join(', ')}\n` +
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
    requiredSections: ['spec', 'implementation', 'review', 'context-manifest', 'telemetry'],
  },
  {
    name: 'task-data.md',
    detect: () => fileName === 'task-data.md',
    required: ['task_id'],
    requiredSections: ['task-metadata'],
  },
  // Task-level summary: lives at ai-workflow-data/tasks/<task_id>/summary.md
  // Detected by grandparent directory being named "tasks".
  // Written by the orchestrator via telemetry-summary skill — no verdict field.
  {
    name: 'Task Summary',
    detect: () =>
      fileName === 'summary.md' &&
      path.basename(path.dirname(path.dirname(filePath))) === 'tasks',
    required: ['task_id'],
  },
  // Subtask-level summary: lives at tasks/<task_id>/[phase-X/]<subtask_id>/summary.md
  // Grandparent is the task folder, not "tasks". Written by the Reviewer — must have verdict.
  {
    name: 'Subtask Summary',
    detect: () =>
      fileName === 'summary.md' &&
      path.basename(path.dirname(path.dirname(filePath))) !== 'tasks',
    required: ['verdict'],
  },
];

const matched = ARTIFACT_RULES.find((rule) => rule.detect());

if (!matched) {
  // Not a recognized artifact — skip validation
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
validateCommonArtifactFooters();
validateOptionalSectionSchema();

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

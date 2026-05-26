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
const { isTrivialClassification, writeRecentIndex } = require('./lib/active-task');

const filePath = process.argv[2] || '';

if (!filePath || !fs.existsSync(filePath)) {
  process.exit(0);
}

// Path exemption: phase-boundary-check IC reports live at
// `<artifact-root>/tasks/<task_id>/phase-boundary-check/<phase_id>/ai-work.md`
// and intentionally carry ONLY the integration-check section (per
// `ai/governance/TRIGGER_RULES.md` → contract-only IC). They are NOT subtask
// artifacts — no Lead/Executor/Reviewer ever touches them — so the
// ai-work.md schema (`spec`/`implementation`/`review`) does not apply.
// Skip the validator entirely for these files; the IC verdict is enforced at
// the P2 gate, not via the artifact-chain hook.
if (filePath.includes(`${path.sep}phase-boundary-check${path.sep}`)) {
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

// Finding-ID stability validator. The delta-rework protocol relies on
// reviewers reusing the same `F-NNN` ID for the same defect across cycles
// so the orchestrator can compose focused rework bundles. Without this
// check, a silently renumbered ID makes the next Executor receive a delta
// pointing at the wrong defect. Rules (per
// skills/review-report/references/review-cycle-template.md):
//   - Cycle 1: all IDs allowed; status field optional / "new".
//   - Cycle N > 1: every ID must either
//       (a) appear in some prior cycle's findings AND carry
//           status ∈ {persisted, regressed} in this cycle, OR
//       (b) be a fresh ID strictly greater than the max numeric ID seen in
//           any prior cycle (the "next unused ID" rule); fresh IDs may omit
//           status or carry status="new".
// IDs not matching `^F-\d+$` are tolerated (e.g. project-prefixed IDs);
// the validator only enforces ordering on the canonical F-NNN shape so
// projects that adopt a different ID scheme aren't broken.
const validateFindingIdStability = () => {
  if (matched.name !== 'ai-work.md') {
    return;
  }
  const reviewBlockMatch = content.match(
    /<!--\s*section:review\s*-->([\s\S]*?)<!--\s*\/section:review\s*-->/i,
  );
  if (!reviewBlockMatch) return;
  const reviewBlock = reviewBlockMatch[1];

  // Split into cycle blocks. Each block runs from one `### Cycle N` heading
  // to the next (or to the end of the review section). Cycle numbers are
  // captured for error messages.
  const cycleHeader = /^###\s+Cycle\s+(\d+)\b[^\n]*$/gim;
  const cycleStarts = [];
  let cm;
  while ((cm = cycleHeader.exec(reviewBlock)) !== null) {
    cycleStarts.push({ n: parseInt(cm[1], 10), index: cm.index });
  }
  if (cycleStarts.length < 2) return; // Stability rules only apply to N > 1.

  const cycles = cycleStarts.map((cs, i) => {
    const end = i + 1 < cycleStarts.length ? cycleStarts[i + 1].index : reviewBlock.length;
    return { n: cs.n, body: reviewBlock.slice(cs.index, end) };
  });

  // Per cycle, parse the findings section (ignore review-low-confidence —
  // those carry their own ID space, e.g. OBSERVATION-NNN). Findings appear
  // as `##### <ID> — <title>` per the template; capture the ID and the
  // following key-value lines until the next `#####` or section close.
  const parseCycle = (body) => {
    const findingsMatch = body.match(
      /<!--\s*section:review-findings\s*-->([\s\S]*?)<!--\s*\/section:review-findings\s*-->/i,
    );
    if (!findingsMatch) return [];
    const findingsBody = findingsMatch[1];
    const findingHeader = /^#####\s+([A-Za-z0-9_-]+)\b[^\n]*$/gim;
    const headers = [];
    let fm;
    while ((fm = findingHeader.exec(findingsBody)) !== null) {
      headers.push({ id: fm[1], index: fm.index });
    }
    return headers.map((h, i) => {
      const end = i + 1 < headers.length ? headers[i + 1].index : findingsBody.length;
      const block = findingsBody.slice(h.index, end);
      const statusMatch = block.match(/^[ \t]*-\s*\*\*status\*\*:\s*([A-Za-z0-9_-]+)/im);
      return { id: h.id, status: statusMatch ? statusMatch[1].toLowerCase() : null };
    });
  };

  const parsed = cycles.map((c) => ({ n: c.n, findings: parseCycle(c.body) }));
  const numericId = (id) => {
    const m = id.match(/^F-(\d+)$/i);
    return m ? parseInt(m[1], 10) : null;
  };

  const issues = [];
  for (let i = 1; i < parsed.length; i++) {
    const cur = parsed[i];
    const priorIds = new Set();
    let priorMaxNumeric = 0;
    for (let j = 0; j < i; j++) {
      for (const f of parsed[j].findings) {
        priorIds.add(f.id);
        const n = numericId(f.id);
        if (n !== null && n > priorMaxNumeric) priorMaxNumeric = n;
      }
    }
    for (const f of cur.findings) {
      const inPrior = priorIds.has(f.id);
      if (inPrior) {
        // Reused ID — must carry persisted | regressed status in this cycle.
        if (f.status !== 'persisted' && f.status !== 'regressed') {
          issues.push(
            `Cycle ${cur.n} finding ${f.id} reuses an ID from an earlier cycle but has status=${JSON.stringify(f.status)} — reused IDs MUST carry status="persisted" or status="regressed".`,
          );
        }
      } else {
        // Fresh ID — for canonical F-NNN shape, must be strictly greater
        // than max prior numeric ID. Non-canonical IDs are tolerated.
        const n = numericId(f.id);
        if (n !== null && n <= priorMaxNumeric) {
          issues.push(
            `Cycle ${cur.n} finding ${f.id} is a fresh ID (not in any prior cycle) but its number ${n} is not strictly greater than the max prior ID number ${priorMaxNumeric} — fresh IDs MUST extend the sequence (next unused ID is F-${String(priorMaxNumeric + 1).padStart(3, '0')}). A renumbered defect breaks the delta-rework bundle protocol.`,
          );
        }
        if (f.status === 'persisted' || f.status === 'regressed') {
          issues.push(
            `Cycle ${cur.n} finding ${f.id} carries status=${JSON.stringify(f.status)} but the ID does not appear in any prior cycle — status="persisted"/"regressed" requires a matching prior-cycle ID.`,
          );
        }
      }
    }
  }

  if (issues.length > 0) {
    console.error(
      `[validate-artifact-chain] INVALID ai-work.md: finding-ID stability violations (review-report SKILL → "Stable Finding IDs"):\n` +
        issues.map((s, i) => `  ${i + 1}. ${s}`).join('\n') +
        `\nFile: ${filePath}\n`,
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

// Read sibling orchestration-state.json for the active task summary, if any.
// Returns null when the file is missing or malformed. Used to decide whether
// the task is `execution-trivial` (and therefore allowed to ship a minimal
// summary.md instead of the canonical multi-section template).
const readSiblingTaskState = () => {
  const dir = path.dirname(filePath);
  const sibling = path.join(dir, 'orchestration-state.json');
  if (!fs.existsSync(sibling)) return null;
  try {
    return JSON.parse(fs.readFileSync(sibling, 'utf8'));
  } catch (_) {
    return null;
  }
};

const validateRequiredHeadings = () => {
  if (!matched.requiredHeadings) {
    return;
  }

  // Trivial-flow relaxation: when the sibling orchestration-state.json
  // classifies the task as `execution-trivial`, only require `Status`. The
  // compressed flow (skip Delivery PM + P1 + Lead) does not produce the
  // multi-phase pipeline data the canonical Task Summary template expects;
  // forcing those headings would block legitimate trivial closure. Subtask
  // Summary is unaffected (its parent dir is not `tasks/`, so it never reads
  // a state file alongside).
  let requiredHeadings = matched.requiredHeadings;
  if (matched.name === 'Task Summary' && isTrivialClassification(readSiblingTaskState())) {
    requiredHeadings = ['Status'];
  }

  const missing = requiredHeadings.filter((heading) => !hasHeading(heading));
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

  // When Reviewer marks the subtask approved, the summary MUST be populated —
  // not just headed. Telemetry / Dispatch Bundles / Context Manifest are the
  // sections the orchestrator aggregates at closure; if they're empty here,
  // the task-level summary.md (Step 13b) will end up empty too.
  // Telemetry line shape mirrors the regex previously in validate-summary-telemetry.js:
  //   `<agent> | <n>/<n> turns | …`
  if (reviewVerdict === 'approved') {
    const populationIssues = [];
    const telemetryBlock = getHeadingBlock('Telemetry').trim();
    if (!telemetryBlock) {
      populationIssues.push('## Telemetry has no body');
    } else if (!/\S+\s*\|\s*\d+\/\d+\s+turns\s*\|/.test(telemetryBlock)) {
      populationIssues.push('## Telemetry has no telemetry line in the form "agent | N/N turns | …"');
    }
    const dispatchBlock = getHeadingBlock('Dispatch Bundles').trim();
    if (!dispatchBlock) {
      populationIssues.push('## Dispatch Bundles has no audit rows');
    }
    const ctxBlock = getHeadingBlock('Context Manifest').trim();
    if (!ctxBlock) {
      populationIssues.push('## Context Manifest has no subsections');
    } else if (!/^###\s+/m.test(ctxBlock)) {
      populationIssues.push('## Context Manifest is missing per-source `### ` subsections');
    }
    if (populationIssues.length > 0) {
      console.error(
        `[validate-artifact-chain] INVALID ${matched.name}: review_verdict=approved but summary is not populated: ${populationIssues.join('; ')}.\n` +
          `Resolution: Reviewer must finalize summary.md with real telemetry, dispatch-bundle audit rows, and context-manifest subsections — ` +
          `empty headings are not acceptable for an approved subtask.\n` +
          `File: ${filePath}\n`,
      );
      process.exit(1);
    }
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
  //
  // Field-requirement matrix:
  //   - Always required: task_id, phase, pending_subtasks, blocked_gates,
  //     pending_user_actions.
  //   - Required outside intake (i.e. stage absent OR stage in
  //     {planning, execution, closure}): mode, task_summary_path. Intake-stage
  //     state files are written before the orchestrator commits to a mode or
  //     resolves the task summary path.
  //   - Required when schema_version >= 2 AND stage != intake:
  //     last_completed_seq. Mirrors pre-task-guard.js canonical-schema check
  //     so PreToolUse and PostToolUse agree.
  const isIntakeStage = parsed.stage === 'intake';
  const requiredFields = [
    'task_id',
    'phase',
    'pending_subtasks',
    'blocked_gates',
    'pending_user_actions',
  ];
  if (!isIntakeStage) {
    requiredFields.push('mode', 'task_summary_path');
    if (typeof parsed.schema_version === 'number' && parsed.schema_version >= 2) {
      requiredFields.push('last_completed_seq');
    }
  }
  const missingFields = requiredFields.filter((f) => !(f in parsed));
  if (missingFields.length > 0) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: missing required fields: ${missingFields.join(', ')}\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }
  if (
    'last_completed_seq' in parsed &&
    (typeof parsed.last_completed_seq !== 'number' || parsed.last_completed_seq < 0)
  ) {
    console.error(
      `[validate-artifact-chain] INVALID ${matched.name}: last_completed_seq must be a non-negative number; got ${JSON.stringify(parsed.last_completed_seq)}\n` +
        `File: ${filePath}\n`,
    );
    process.exit(1);
  }

  const validModes = ['normal', 'degraded-inline'];
  if ('mode' in parsed && !validModes.includes(parsed.mode)) {
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

  // Task-level summary + stage precondition for completion writes:
  //
  // When state is being written with phase: complete, ALL of these must hold:
  //   - stage === "closure" (Step 12.5 already ran)
  //   - sibling task-level summary.md exists with populated body content under
  //     every required heading (## Status, ## Changes by Phase, ## Telemetry,
  //     ## Dispatch Bundles, ## Context Manifest). "Populated" means non-empty
  //     content between the heading and the next ## heading. Heading-only is
  //     treated as un-populated and rejected.
  //
  // The trivial-flow relaxation in validateRequiredHeadings (which only
  // requires Status for execution-trivial) still applies for HEADING presence
  // — but for trivial classification, we additionally only check Status
  // body population since the other headings legitimately don't exist.
  if (parsed.phase === 'complete') {
    if (parsed.stage !== undefined && parsed.stage !== 'closure') {
      console.error(
        `[validate-artifact-chain] INVALID ${matched.name}: cannot write phase="complete" while stage=${JSON.stringify(parsed.stage)}. ` +
          `Step 12.5 (execution→closure stage transition) MUST run first — write stage="closure" with a closed execution stage_history entry ` +
          `(exit_reason="all-subtasks-approved") and an open closure entry BEFORE setting phase="complete".\n` +
          `File: ${filePath}\n`,
      );
      process.exit(1);
    }
    const taskDir = path.dirname(filePath);
    const taskSummaryPath = path.join(taskDir, 'summary.md');
    let summaryContent = null;
    try {
      summaryContent = fs.readFileSync(taskSummaryPath, 'utf8');
    } catch (_) {
      // missing or unreadable — handled below
    }
    if (summaryContent === null) {
      console.error(
        `[validate-artifact-chain] INVALID ${matched.name}: cannot mark task complete — ` +
          `task-level summary.md is missing.\n` +
          `Expected: ${taskSummaryPath}\n` +
          `Resolution (in order): (1) Step 12.5 — write stage="closure" with a closed execution stage_history entry; (2) invoke telemetry-summary to finalize summary.md with populated body content; (3) THEN write phase="complete".\n` +
          `File: ${filePath}\n`,
      );
      process.exit(1);
    }
    // Heading set mirrors the canonical task-level template emitted by the
    // `telemetry-summary` skill (skills/telemetry-summary/SKILL.md → "Output
    // Template"). Trivial-flow tasks legitimately omit the multi-phase
    // pipeline data, so we only require "Task Status" there — matching the
    // existing trivial relaxation in `validateRequiredHeadings`.
    const isTrivial = isTrivialClassification(parsed);
    const requiredPopulated = isTrivial
      ? ['Task Status']
      : [
          'Task Status',
          'Changes by Phase',
          'Detail',
          'Totals',
          'Dispatch Bundles',
          'Context Breakdown',
        ];
    const headingBlock = (heading) => {
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Tolerate the bare "Status" variant in case a writer (or trivial-flow
      // template) drops the "Task " prefix. The canonical template emits
      // "Task Status".
      const prefixed = heading === 'Task Status' ? `(?:Task\\s+)?Status` : escaped;
      const re = new RegExp(`^##\\s+${prefixed}\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s+|$(?![\\r\\n]))`, 'im');
      const m = summaryContent.match(re);
      return m ? m[1].trim() : null;
    };
    const populationIssues = [];
    for (const heading of requiredPopulated) {
      const body = headingBlock(heading);
      if (body === null) {
        populationIssues.push(`missing heading "## ${heading}"`);
      } else if (body.length === 0) {
        populationIssues.push(`empty body under "## ${heading}"`);
      }
    }
    if (populationIssues.length > 0) {
      console.error(
        `[validate-artifact-chain] INVALID ${matched.name}: cannot mark task complete — ` +
          `task-level summary.md fails the populated-content check: ${populationIssues.join('; ')}.\n` +
          `Expected: ${taskSummaryPath}\n` +
          `Resolution (in order): (1) confirm Step 12.5 already ran (stage="closure"); (2) invoke telemetry-summary to refresh the task-level summary with populated bodies under Task Status, Changes by Phase, Detail, Totals, Dispatch Bundles, and Context Breakdown; (3) THEN write phase="complete". ` +
          `Empty headings (heading present but body whitespace-only) fail this check by design.\n` +
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

  // Refresh the recent-task index so subsequent `mostRecentTaskDir` calls in
  // hooks skip the readdir+stat walk. Best-effort — failures are swallowed.
  // Detect the tasks-root by walking up: state file lives at
  // <artifact-root>/tasks/<task_id>/orchestration-state.json, so the parent
  // of the file's directory is `tasks/`. We only update the index when that
  // grandparent is literally named "tasks" — guards against test fixtures
  // and unrelated layouts.
  try {
    const taskDir = path.dirname(filePath);
    const tasksRoot = path.dirname(taskDir);
    if (path.basename(tasksRoot) === 'tasks') {
      writeRecentIndex(tasksRoot, path.basename(taskDir));
    }
  } catch (_) {}

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
validateFindingIdStability();
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

#!/usr/bin/env node
/**
 * PostToolUse hook: validate-summary-telemetry (non-blocking, informational)
 * After Write|Edit on a subtask summary.md, warns if the Reviewer has set a
 * verdict but telemetry or context manifest data is missing.
 */

const fs = require('fs');
const path = require('path');
const { resolveArtifactRoot, canonicalize } = require('./lib/artifact-root');

const filePath = process.argv[2] || '';

if (!filePath || !fs.existsSync(filePath)) {
  process.exit(0);
}

const fileName = path.basename(filePath).toLowerCase();

// Only target summary.md files
if (fileName !== 'summary.md') {
  process.exit(0);
}

// Must be under <resolved-artifact-root>/tasks/. The check is rooted in the
// resolver instead of a literal `aiaw-data-` prefix so a future override
// mechanism (e.g. AIAW_DATA_ROOT env var) does not silently bypass telemetry
// validation.
const ARTIFACT = resolveArtifactRoot();
if (!ARTIFACT.root) {
  process.exit(0);
}
const tasksRoot = canonicalize(path.join(ARTIFACT.root, 'tasks'));
const canonicalTarget = canonicalize(path.resolve(filePath));
if (canonicalTarget !== tasksRoot && !canonicalTarget.startsWith(tasksRoot + path.sep)) {
  process.exit(0);
}

const relativePath = canonicalTarget.slice(tasksRoot.length + 1);

// relativePath examples:
//   "TP-001/summary.md"                        — task-level (skip)
//   "TP-001/TP-001-A1/summary.md"              — subtask-level (target)
//   "TP-001/phase-1/TP-001-A1/summary.md"      — subtask-level with phase (target)
//
// Task-level summaries have exactly one path segment before "summary.md" (i.e., <task_id>/summary.md).
// Subtask-level summaries have two or more segments before "summary.md".
const segments = relativePath.split('/');
if (segments.length < 3) {
  // Task-level summary (e.g., "TP-001/summary.md") — different format, skip
  process.exit(0);
}

const content = fs.readFileSync(filePath, 'utf8');

// Check for a verdict line
// Match both plain `review_verdict: approved` and markdown bold `**review_verdict**: approved`
const verdictMatch = content.match(
  /\*{0,2}review_verdict\*{0,2}\s*:\s*(approved|changes_requested|needs-replan)\b/i,
);

if (!verdictMatch) {
  // No verdict set — nothing to validate
  process.exit(0);
}

const verdict = verdictMatch[1];
const warnings = [];

// Check ## Telemetry section exists and has at least one telemetry line
const hasTelemetryHeading = /^##\s+Telemetry\b/im.test(content);
if (!hasTelemetryHeading) {
  warnings.push('## Telemetry section is missing');
} else {
  // Extract the Telemetry section content (up to next ## heading or end of file)
  const telemetryMatch = content.match(
    /^##\s+Telemetry\b[^\n]*\n([\s\S]*?)(?=\n##\s|$)/m,
  );
  const telemetryBody = telemetryMatch ? telemetryMatch[1] : '';

  // Check for at least one telemetry line matching: <word> | <digits>/<digits> turns |
  const telemetryLinePattern = /\S+\s*\|\s*\d+\/\d+\s+turns\s*\|/;
  if (!telemetryLinePattern.test(telemetryBody)) {
    warnings.push(
      '## Telemetry section exists but contains no telemetry lines (expected pattern: "<role> | <n>/<n> turns |")',
    );
  }
}

// Check ## Context Manifest section exists and has at least one ### subsection
const hasContextManifestHeading = /^##\s+Context Manifest\b/im.test(content);
if (!hasContextManifestHeading) {
  warnings.push('## Context Manifest section is missing');
} else {
  // Extract the Context Manifest section content
  const cmMatch = content.match(
    /^##\s+Context Manifest\b[^\n]*\n([\s\S]*?)(?=\n##\s|$)/m,
  );
  const cmBody = cmMatch ? cmMatch[1] : '';

  // Check for at least one ### subsection
  const hasSubsection = /^###\s+\S+/m.test(cmBody);
  if (!hasSubsection) {
    warnings.push(
      '## Context Manifest section exists but contains no ### subsections',
    );
  }
}

if (warnings.length > 0) {
  console.error(
    `[validate-summary-telemetry] WARNING: summary.md has review_verdict=${verdict} but diagnostics are incomplete:\n` +
      warnings.map((w) => `  - ${w}`).join('\n') +
      `\nFile: ${filePath}\n`,
  );
}

process.exit(0);

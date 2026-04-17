#!/usr/bin/env node
/**
 * PostToolUse hook: validate-dispatch-bundle (non-blocking / warning mode)
 * After a Write or Edit to a dispatch bundle file (roles/<role>.md), checks
 * that the bundle contains non-trivial Project Context content.
 *
 * If the Project Context section is empty or missing, this usually means the
 * domain section (<!-- section:<domain> -->) is absent from PROJECT_CONFIG.md.
 * The agent will work without baseline context.
 *
 * This hook is non-blocking — it always exits 0. Warnings go to stdout
 * so the orchestrator sees them as injected context.
 *
 * Called with the written file path as argv[2].
 */

const fs = require('fs');
const path = require('path');

const filePath = process.argv[2] || '';

if (!filePath) {
  process.exit(0);
}

// Only validate dispatch bundle files: ai-workflow-data/tasks/**/roles/*.md
const normalizedPath = filePath.replace(/\\/g, '/');
const bundlePattern = /ai-workflow-data\/tasks\/.*\/roles\/[^/]+\.md$/;

if (!bundlePattern.test(normalizedPath)) {
  process.exit(0);
}

if (!fs.existsSync(filePath)) {
  process.exit(0);
}

const content = fs.readFileSync(filePath, 'utf8');
const role = path.basename(filePath, '.md');
const taskRootMatch = normalizedPath.match(/(.*ai-workflow-data\/tasks\/[^/]+)\//);
const taskRoot = taskRootMatch ? taskRootMatch[1] : null;

if (taskRoot) {
  const statePath = path.join(taskRoot, 'orchestration-state.json');
  if (fs.existsSync(statePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (parsed.mode === 'degraded-inline') {
        console.log(
          `\n[validate-dispatch-bundle] WARNING: Bundle for ${role} was written while orchestration-state.json says mode=degraded-inline.\n` +
            `Degraded mode must not fabricate role dispatches or bundle files.\n` +
            `State: ${statePath}\n` +
            `Bundle: ${filePath}\n`,
        );
      }
    } catch (_error) {
      // Best-effort warning only; malformed state is handled by validate-artifact-chain.
    }
  }
}

// Roles that require domain context in their bundles.
// lead, executor, reviewer need domain sections + baselines.
// design-agent needs FE baseline.
// delivery-pm, integration-checker get different sections (not domain-keyed).
const ROLES_NEEDING_DOMAIN_CONTEXT = ['lead', 'executor', 'reviewer', 'design-agent'];

if (!ROLES_NEEDING_DOMAIN_CONTEXT.includes(role)) {
  process.exit(0);
}

// Check for ## Project Context section with non-trivial content.
// The bundle format (per context-minimizer skill) uses this header for
// domain sections and baselines extracted from PROJECT_CONFIG.md.
// Split by markdown headings to extract the section body reliably.
const sections = content.split(/^(?=## )/m);
const projectContextSection = sections.find((s) => s.startsWith('## Project Context'));
const projectContextBody = projectContextSection
  ? projectContextSection.replace(/^## Project Context\s*\n?/, '').trim()
  : null;

if (projectContextBody === null) {
  console.log(
    `\n[validate-dispatch-bundle] WARNING: Bundle for ${role} is missing the "## Project Context" section.\n` +
      `This usually means the domain section (<!-- section:<domain> -->) was not found in PROJECT_CONFIG.md.\n` +
      `The dispatched agent will work without baseline context.\n` +
      `Consider running /ai-agents-workflow:update to refresh PROJECT_CONFIG.md.\n` +
      `Bundle: ${filePath}\n`,
  );
  process.exit(0);
}

// Check for non-trivial content (more than just whitespace or a placeholder comment)
if (projectContextBody.length < 50) {
  console.log(
    `\n[validate-dispatch-bundle] WARNING: Bundle for ${role} has near-empty "## Project Context" section (${projectContextBody.length} chars).\n` +
      `This usually means the domain section (<!-- section:<domain> -->) was not found in PROJECT_CONFIG.md.\n` +
      `The dispatched agent will work without baseline context.\n` +
      `Consider running /ai-agents-workflow:update to refresh PROJECT_CONFIG.md.\n` +
      `Bundle: ${filePath}\n`,
  );
  process.exit(0);
}

// Check that at least one section marker was extracted from PROJECT_CONFIG.md
// into the Project Context area — confirms domain content was actually included.
const hasSectionMarker = /<!--\s*section:[a-z0-9-]+\s*-->/.test(projectContextBody);

if (!hasSectionMarker) {
  console.log(
    `\n[validate-dispatch-bundle] WARNING: Bundle for ${role} has a "## Project Context" section but no <!-- section:* --> markers.\n` +
      `Domain-specific baselines and validation rules may not have been extracted from PROJECT_CONFIG.md.\n` +
      `The dispatched agent may work without complete baseline context.\n` +
      `Bundle: ${filePath}\n`,
  );
}

const hasArtifactInputSection = /^## Artifact Input\b/m.test(content);
if (!hasArtifactInputSection) {
  console.log(
    `\n[validate-dispatch-bundle] WARNING: Bundle for ${role} is missing the "## Artifact Input" section.\n` +
      `The dispatched agent may not have the exact artifact slice required for the turn.\n` +
      `Bundle: ${filePath}\n`,
  );
}

process.exit(0);

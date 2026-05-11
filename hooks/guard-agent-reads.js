#!/usr/bin/env node
/**
 * PreToolUse hook: guard-agent-reads (non-blocking / warning mode)
 * Emits a warning when a Read targets governance files, canonical agent
 * contracts, or PROJECT_CONFIG.md — files that agents should receive
 * pre-curated in their dispatch bundle, not read independently.
 *
 * The Chief Orchestrator legitimately reads these files during bundle
 * assembly (via context-minimizer). Because we cannot distinguish
 * orchestrator reads from subagent reads at hook time, this hook warns
 * rather than blocks. Subagents see the warning as injected context and
 * should stop and use their dispatch bundle instead.
 *
 * Always exits 0 — never blocks.
 *
 * Env vars read:
 *   CLAUDE_TOOL_INPUT_FILE_PATH — file being read
 *   CLAUDE_PLUGIN_ROOT          — plugin installation root
 */

const fs = require('fs');
const path = require('path');
const { resolvePluginRoot } = require('./lib/plugin-root');
const { resolveArtifactRoot, canonicalize } = require('./lib/artifact-root');

const filePath = process.env.CLAUDE_TOOL_INPUT_FILE_PATH || '';
const PLUGIN_ROOT = resolvePluginRoot();

if (!filePath) {
  process.exit(0);
}

// Canonicalize via realpath (matching guard-orchestrator-source-writes) so a
// symlinked artifact root produces the same comparison form across hooks.
const resolved = canonicalize(filePath);
const pluginResolved = canonicalize(PLUGIN_ROOT);
const ARTIFACT = resolveArtifactRoot();
const artifactRootAbs = ARTIFACT.root ? canonicalize(ARTIFACT.root) : null;

// --- Restricted paths ---
// 1. Governance files:    ${PLUGIN_ROOT}/ai/governance/*.md
// 2. Core files:          ${PLUGIN_ROOT}/ai/core/*.md
// 3. Playbooks:           ${PLUGIN_ROOT}/ai/playbooks/*.md
// 4. Procedural agent docs: ${PLUGIN_ROOT}/ai/agents/*.md (chief-orchestrator, init, resume-orchestrator only — role contracts for the 6 dispatched agents live in ${PLUGIN_ROOT}/agents/<role>.md)
// 5. PROJECT_CONFIG.md:   <artifact-root>/config/PROJECT_CONFIG.md
// 6. Derived config cache: <artifact-root>/config/domain-contexts.cache.md
//                          <artifact-root>/config/domain-contexts.cache.manifest.json
//                          <artifact-root>/config/domain-contexts/*  (legacy fan-out, still warned)

const restrictedPluginDirs = [
  path.join(pluginResolved, 'ai', 'governance'),
  path.join(pluginResolved, 'ai', 'core'),
  path.join(pluginResolved, 'ai', 'playbooks'),
  path.join(pluginResolved, 'ai', 'agents'),
];

const isRestrictedPluginFile = restrictedPluginDirs.some(
  (dir) => resolved.startsWith(dir + path.sep) && resolved.endsWith('.md'),
);

const projectConfigAbs = artifactRootAbs
  ? path.join(artifactRootAbs, 'config', 'PROJECT_CONFIG.md')
  : null;
const cacheFileAbs = artifactRootAbs
  ? path.join(artifactRootAbs, 'config', 'domain-contexts.cache.md')
  : null;
const cacheManifestAbs = artifactRootAbs
  ? path.join(artifactRootAbs, 'config', 'domain-contexts.cache.manifest.json')
  : null;
const legacyDomainContextsDirAbs = artifactRootAbs
  ? path.join(artifactRootAbs, 'config', 'domain-contexts')
  : null;

const isProjectConfig = projectConfigAbs ? resolved === projectConfigAbs : false;

const isDerivedContextCache =
  (cacheFileAbs && resolved === cacheFileAbs) ||
  (cacheManifestAbs && resolved === cacheManifestAbs) ||
  (legacyDomainContextsDirAbs && resolved.startsWith(legacyDomainContextsDirAbs + path.sep));

if (!isRestrictedPluginFile && !isProjectConfig && !isDerivedContextCache) {
  process.exit(0);
}

// Determine what category was hit for a specific warning message
let category;
if (isProjectConfig) {
  category = 'PROJECT_CONFIG.md';
} else if (isDerivedContextCache) {
  category = 'derived config cache (domain-contexts.cache.md)';
} else if (resolved.startsWith(path.join(pluginResolved, 'ai', 'governance') + path.sep)) {
  category = 'governance file';
} else if (resolved.startsWith(path.join(pluginResolved, 'ai', 'core') + path.sep)) {
  category = 'core file';
} else if (resolved.startsWith(path.join(pluginResolved, 'ai', 'playbooks') + path.sep)) {
  category = 'playbook';
} else if (resolved.startsWith(path.join(pluginResolved, 'ai', 'agents') + path.sep)) {
  category = 'canonical agent contract';
}

const fileName = path.basename(resolved);

console.log(
  `\n[guard-agent-reads] WARNING: Reading ${category}: ${fileName}\n` +
    `Agents must NOT independently read governance files, canonical contracts, or PROJECT_CONFIG.md.\n` +
    `All necessary context should be pre-curated in the dispatch bundle by the orchestrator.\n` +
    `If you are a dispatched agent, STOP — use your dispatch bundle at roles/<your-role>.md instead.\n` +
    `If you are the Chief Orchestrator assembling a bundle, this warning is expected and safe to ignore.\n`,
);

// Persist a one-line audit entry so non-blocking warnings actually leave a
// trail. Best-effort: any failure here (no artifact root, no resolvable
// task, disk error) is silently dropped — auditing must never block reads.
try {
  if (artifactRootAbs) {
    const tasksRoot = path.join(artifactRootAbs, 'tasks');
    let auditDir = artifactRootAbs;
    if (fs.existsSync(tasksRoot)) {
      const candidates = fs
        .readdirSync(tasksRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => {
          const sp = path.join(tasksRoot, e.name, 'orchestration-state.json');
          let mtime = -Infinity;
          try { mtime = fs.statSync(sp).mtimeMs; } catch (_) {}
          return { name: e.name, mtime };
        })
        .filter((c) => c.mtime !== -Infinity)
        .sort((a, b) => b.mtime - a.mtime || (b.name > a.name ? 1 : -1));
      if (candidates.length) {
        auditDir = path.join(tasksRoot, candidates[0].name);
      }
    }
    const auditPath = path.join(auditDir, 'audit.log');
    const role = process.env.CLAUDE_SUBAGENT_TYPE || 'unknown';
    const line =
      `${new Date().toISOString()}\tguard-agent-reads\trole=${role}\t` +
      `category=${category}\tfile=${resolved}\n`;
    // Snapshot the parent dir's mtime/atime BEFORE the append, then restore
    // them after. Without this restore, appending the audit line bumps the
    // task dir's mtime, which silently poisons `mostRecentTaskDir(_, 'dir')`
    // callers (notably `guard-orchestrator-step0.js`) into picking the
    // most-audit-active task instead of the most-recently-worked one.
    let snap = null;
    try { snap = fs.statSync(auditDir); } catch (_) {}
    fs.appendFileSync(auditPath, line, 'utf8');
    if (snap) {
      try { fs.utimesSync(auditDir, snap.atime, snap.mtime); } catch (_) {}
    }
  }
} catch (_) {}

process.exit(0);

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

const path = require('path');
const { resolvePluginRoot } = require('./_resolve-plugin-root');

const filePath = process.env.CLAUDE_TOOL_INPUT_FILE_PATH || '';
const PLUGIN_ROOT = resolvePluginRoot();

if (!filePath) {
  process.exit(0);
}

const resolved = path.resolve(filePath);
const pluginResolved = path.resolve(PLUGIN_ROOT);

// --- Restricted paths ---
// 1. Governance files:    ${PLUGIN_ROOT}/ai/governance/*.md
// 2. Core files:          ${PLUGIN_ROOT}/ai/core/*.md
// 3. Playbooks:           ${PLUGIN_ROOT}/ai/playbooks/*.md
// 4. Canonical contracts:  ${PLUGIN_ROOT}/ai/agents/*.md
// 5. PROJECT_CONFIG.md:   ai-workflow-data/config/PROJECT_CONFIG.md
// 6. Derived config cache: ai-workflow-data/config/domain-contexts.cache.md
//                          ai-workflow-data/config/domain-contexts.cache.manifest.json
//                          ai-workflow-data/config/domain-contexts/*  (legacy fan-out, still warned)

const restrictedPluginDirs = [
  path.join(pluginResolved, 'ai', 'governance'),
  path.join(pluginResolved, 'ai', 'core'),
  path.join(pluginResolved, 'ai', 'playbooks'),
  path.join(pluginResolved, 'ai', 'agents'),
];

const isRestrictedPluginFile = restrictedPluginDirs.some(
  (dir) => resolved.startsWith(dir + path.sep) && resolved.endsWith('.md'),
);

const isProjectConfig =
  resolved.endsWith(path.join('ai-workflow-data', 'config', 'PROJECT_CONFIG.md'));

const cacheFile = path.join('ai-workflow-data', 'config', 'domain-contexts.cache.md');
const cacheManifest = path.join('ai-workflow-data', 'config', 'domain-contexts.cache.manifest.json');
const legacyDomainContextsDir = path.join('ai-workflow-data', 'config', 'domain-contexts');
const isDerivedContextCache =
  resolved.endsWith(cacheFile) ||
  resolved.endsWith(cacheManifest) ||
  resolved.includes(legacyDomainContextsDir + path.sep);

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

process.exit(0);

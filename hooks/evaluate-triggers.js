#!/usr/bin/env node
/**
 * PreToolUse hook: evaluate-triggers (non-blocking / observation mode)
 * Scans the current artifact context for keywords matching TRIGGER_RULES
 * and emits a compact trigger assessment to stdout.
 *
 * Claude Code injects this output as context before the Agent dispatch.
 * This is non-blocking — it never exits non-zero.
 *
 * Called with the target agent name as argv[2].
 *
 * Path resolution (plugin install):
 *   PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT (set by harness when the
 *                 plugin is loaded); falls back to __dirname/.. for dev runs
 *                 inside the plugin repo itself.
 *   CWD         = process.cwd(); this is the consumer repo where
 *                 ai-workflow-data/config/PROJECT_CONFIG.md and .claude/plans live.
 *
 * Keyword sources (unioned per agent):
 *   1. ${PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md → <!-- section:trigger-keywords --> (base; stack-agnostic)
 *   2. ${CWD}/ai-workflow-data/config/PROJECT_CONFIG.md → <!-- section:extra-trigger-keywords --> (optional project overlay)
 * If the governance base is missing or malformed, the hook exits 0 with no hint.
 */

const fs = require('fs');
const path = require('path');

const targetAgent = process.argv[2] || '';

const PLUGIN_ROOT =
  process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const CWD = process.cwd();

const GOVERNANCE_PATH = path.join(PLUGIN_ROOT, 'ai', 'governance', 'TRIGGER_RULES.md');
const PROJECT_CONFIG_PATH = path.join(CWD, 'ai-workflow-data', 'config', 'PROJECT_CONFIG.md');
const PLANS_DIR = path.join(CWD, '.claude', 'plans');

// --- YAML-ish parser: reads a single fenced ```yaml block inside a given section marker. ---

function parseKeywordSection(filePath, sectionName) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }

  const sectionRegex = new RegExp(
    `<!--\\s*section:${sectionName}\\s*-->([\\s\\S]*?)<!--\\s*/section:${sectionName}\\s*-->`
  );
  const sectionMatch = raw.match(sectionRegex);
  if (!sectionMatch) return null;

  const yamlMatch = sectionMatch[1].match(/```yaml([\s\S]*?)```/);
  if (!yamlMatch) return null;

  const rules = {};
  let currentAgent = null;
  for (const line of yamlMatch[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const agentMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(\[\s*\])?\s*$/);
    if (agentMatch) {
      currentAgent = agentMatch[1];
      if (!rules[currentAgent]) rules[currentAgent] = [];
      continue;
    }

    const itemMatch = line.match(/^\s*-\s+(.+?)\s*$/);
    if (itemMatch && currentAgent) {
      rules[currentAgent].push(itemMatch[1].toLowerCase());
    }
  }

  return rules;
}

// --- Union base (governance) + optional overlay (project config) per agent. ---

const baseRules = parseKeywordSection(GOVERNANCE_PATH, 'trigger-keywords');
if (!baseRules || Object.keys(baseRules).length === 0) process.exit(0);

const extraRules = parseKeywordSection(PROJECT_CONFIG_PATH, 'extra-trigger-keywords') || {};

const TRIGGER_RULES = {};
const allAgents = new Set([...Object.keys(baseRules), ...Object.keys(extraRules)]);
for (const agent of allAgents) {
  const merged = new Set([
    ...(baseRules[agent] || []),
    ...(extraRules[agent] || []),
  ]);
  if (merged.size > 0) TRIGGER_RULES[agent] = [...merged];
}

if (Object.keys(TRIGGER_RULES).length === 0) process.exit(0);

// --- Read current plan/artifact context (from consumer repo's .claude/plans) ---

let artifactText = '';
try {
  const files = fs
    .readdirSync(PLANS_DIR)
    .filter(f => f.endsWith('.md') || f.endsWith('.json'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(PLANS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length > 0) {
    artifactText = fs.readFileSync(path.join(PLANS_DIR, files[0].name), 'utf8').toLowerCase();
  }
} catch (_) {}

// --- Skip assessment if dispatching to a non-conditional agent ---

const CONDITIONAL_AGENTS = Object.keys(TRIGGER_RULES);
if (!CONDITIONAL_AGENTS.includes(targetAgent) && targetAgent !== '') {
  process.exit(0);
}

// --- Evaluate triggers for all conditional agents ---

const triggered = [];
const notTriggered = [];

for (const [agent, keywords] of Object.entries(TRIGGER_RULES)) {
  const hits = keywords.filter(kw => artifactText.includes(kw));
  if (hits.length > 0) {
    triggered.push({ agent, hits });
  } else {
    notTriggered.push(agent);
  }
}

if (triggered.length === 0 && notTriggered.length === 0) {
  process.exit(0);
}

// --- Emit compact assessment ---

console.log('\n[evaluate-triggers] TRIGGER ASSESSMENT:');

if (triggered.length > 0) {
  console.log('  RECOMMENDED to run:');
  for (const { agent, hits } of triggered) {
    console.log(`    ✓ ${agent} (matched: ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? '...' : ''})`);
  }
}

if (notTriggered.length > 0) {
  console.log(`  No trigger detected for: ${notTriggered.join(', ')}`);
}

if (targetAgent && CONDITIONAL_AGENTS.includes(targetAgent)) {
  const isTriggered = triggered.some(t => t.agent === targetAgent);
  if (!isTriggered) {
    console.log(`\n  WARNING: Dispatching ${targetAgent} but no trigger keywords detected in current artifact.`);
    console.log('  Verify this dispatch is intentional per TRIGGER_RULES.md.');
  }
}

console.log('');
process.exit(0);

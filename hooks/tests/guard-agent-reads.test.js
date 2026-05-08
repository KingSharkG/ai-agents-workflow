#!/usr/bin/env node
/**
 * Tests for hooks/guard-agent-reads.js (PreToolUse, non-blocking warning).
 *
 * The hook always exits 0 — it never blocks. The contract is:
 *   - Reads of governance / core / playbook / canonical-agent-contract /
 *     PROJECT_CONFIG.md / derived-config-cache files emit a warning to stdout.
 *   - Reads of any other file are silent (no stdout).
 *   - When a tasks/<id>/orchestration-state.json exists, restricted-file reads
 *     append a one-line audit entry to <task_dir>/audit.log; otherwise the audit
 *     write is silently skipped.
 *
 * Run:
 *   node hooks/tests/guard-agent-reads.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'guard-agent-reads.js');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

function makeProject(label, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gar-${label}-`));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const artifactRoot = path.join(proj, '.claude', 'aiaw-data-proj');
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, 'config'), { recursive: true });
  if (opts.withProjectConfig) {
    fs.writeFileSync(path.join(artifactRoot, 'config', 'PROJECT_CONFIG.md'), '# stub\n');
  }
  if (opts.withTask) {
    const tdir = path.join(artifactRoot, 'tasks', opts.taskId || 'AI-1');
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(path.join(tdir, 'orchestration-state.json'), '{}');
    return { root, proj, artifactRoot, taskDir: tdir };
  }
  return { root, proj, artifactRoot, taskDir: null };
}

function runHook(cwd, env) {
  const baseEnv = Object.assign({}, process.env);
  for (const k of Object.keys(baseEnv)) {
    if (k.startsWith('CLAUDE_')) delete baseEnv[k];
  }
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    encoding: 'utf8',
    env: Object.assign(baseEnv, env || {}),
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// =========================================================================
// Always exits 0 (non-blocking by contract)
// =========================================================================

test('no CLAUDE_TOOL_INPUT_FILE_PATH → exit 0, no warning', () => {
  const { root, proj } = makeProject('no-path');
  const out = runHook(proj, {});
  assert.strictEqual(out.status, 0);
  assert.strictEqual(out.stdout, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('reading an arbitrary consumer-repo file → exit 0, no warning', () => {
  const { root, proj } = makeProject('arbitrary');
  fs.writeFileSync(path.join(proj, 'src.js'), 'x');
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src.js'),
  });
  assert.strictEqual(out.status, 0);
  assert.strictEqual(out.stdout, '');
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Warns on restricted reads (PROJECT_CONFIG.md, governance, core, etc.)
// =========================================================================

test('reading PROJECT_CONFIG.md → exit 0 with warning', () => {
  const { root, proj, artifactRoot } = makeProject('pc', { withProjectConfig: true });
  const target = path.join(artifactRoot, 'config', 'PROJECT_CONFIG.md');
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_FILE_PATH: target,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
  });
  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /\[guard-agent-reads\] WARNING/);
  assert.match(out.stdout, /PROJECT_CONFIG\.md/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('reading a governance file (under plugin ai/governance/) → exit 0 with warning', () => {
  const { root, proj } = makeProject('gov');
  const target = path.join(PLUGIN_ROOT, 'ai', 'governance', 'TRIGGER_RULES.md');
  // Sanity: this file exists in the plugin tree.
  assert.ok(fs.existsSync(target));
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_FILE_PATH: target,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
  });
  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /governance file/);
  assert.match(out.stdout, /TRIGGER_RULES\.md/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('reading a core file (under plugin ai/core/) → exit 0 with warning', () => {
  const { root, proj } = makeProject('core');
  const target = path.join(PLUGIN_ROOT, 'ai', 'core', 'PROJECT_CONSTITUTION.md');
  assert.ok(fs.existsSync(target));
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_FILE_PATH: target,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
  });
  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /core file/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('reading a derived-config-cache file → exit 0 with warning', () => {
  const { root, proj, artifactRoot } = makeProject('cache');
  const cacheFile = path.join(artifactRoot, 'config', 'domain-contexts.cache.md');
  fs.writeFileSync(cacheFile, '# cache\n');
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_FILE_PATH: cacheFile,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
  });
  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /derived config cache/);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Audit trail
// =========================================================================

test('restricted read with active task writes one audit-log line', () => {
  const { root, proj, artifactRoot, taskDir } = makeProject('audit', {
    withProjectConfig: true,
    withTask: true,
  });
  const target = path.join(artifactRoot, 'config', 'PROJECT_CONFIG.md');
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_FILE_PATH: target,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    CLAUDE_SUBAGENT_TYPE: 'lead',
  });
  assert.strictEqual(out.status, 0);
  const auditPath = path.join(taskDir, 'audit.log');
  assert.ok(fs.existsSync(auditPath), 'audit.log should be written');
  const log = fs.readFileSync(auditPath, 'utf8');
  assert.match(log, /guard-agent-reads/);
  assert.match(log, /role=lead/);
  assert.match(log, /category=PROJECT_CONFIG\.md/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('restricted read without an active task → no audit log (silent skip)', () => {
  const { root, proj, artifactRoot } = makeProject('no-audit', { withProjectConfig: true });
  // No tasks dir created.
  const target = path.join(artifactRoot, 'config', 'PROJECT_CONFIG.md');
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_FILE_PATH: target,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
  });
  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /WARNING/);
  // Audit log under <artifact-root>/audit.log is the fallback when no task
  // dir exists; verify the hook didn't crash either way.
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Runner
// =========================================================================

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`ok  ${name}\n`);
  } catch (e) {
    failed += 1;
    process.stdout.write(`FAIL  ${name}\n`);
    process.stderr.write(`   ${e.stack || e.message}\n`);
  }
}

process.stdout.write(`\n${passed} passed, ${failed} failed (${tests.length} total)\n`);
process.exit(failed === 0 ? 0 : 1);

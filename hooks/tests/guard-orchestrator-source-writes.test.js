#!/usr/bin/env node
/**
 * Tests for hooks/guard-orchestrator-source-writes.js.
 *
 * Run:
 *   node hooks/tests/guard-orchestrator-source-writes.test.js
 *
 * Strategy: each test sets up an isolated tmp project (with or without an
 * artifact root), spawns the hook with the right CLAUDE_* env vars, and
 * asserts on exit code (0 = allow, 1 = block) and stderr content.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'guard-orchestrator-source-writes.js');

function makeProject(label, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gosw-${label}-`));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  if (opts.layout === 'local') {
    fs.mkdirSync(path.join(proj, '.claude', 'aiaw-data-proj'), { recursive: true });
  } else if (opts.layout === 'sibling') {
    fs.mkdirSync(path.join(root, 'aiaw-data-proj'), { recursive: true });
  } else if (opts.layout === 'legacy') {
    fs.mkdirSync(path.join(proj, 'ai-workflow-data'));
  }
  return { root, proj };
}

function runHook(cwd, env) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env),
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// =========================================================================
// Caller exemption
// =========================================================================

test('non-orchestrator caller is exempt (always exits 0)', () => {
  const { root, proj } = makeProject('non-orch', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'index.js'),
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('top-level caller (no CLAUDE_SUBAGENT_TYPE) is exempt', () => {
  const { root, proj } = makeProject('toplevel', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'index.js'),
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Edit / Write paths
// =========================================================================

test('Write to absolute path inside in-project artifact root → allow', () => {
  const { root, proj } = makeProject('write-local-abs', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, '.claude', 'aiaw-data-proj', 'tasks', 'AI-001', 'ai-work.md'),
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Write to relative path inside artifact root → allow', () => {
  const { root, proj } = makeProject('write-local-rel', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: '.claude/aiaw-data-proj/tasks/AI-001/ai-work.md',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Write to consumer source file → block', () => {
  const { root, proj } = makeProject('write-source', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'index.js'),
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /may not Write files outside the artifact root/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Write to .claude/settings.json (NOT under artifact root) → block', () => {
  // .claude/ itself is inside CWD but only .claude/aiaw-data-proj/ is the root.
  // Writing to .claude/settings.json is a settings write, not an artifact
  // write — must be blocked for chief-orchestrator.
  const { root, proj } = makeProject('write-settings', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, '.claude', 'settings.json'),
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /outside the artifact root/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Write inside sibling-layout artifact root (outside CWD) → allow', () => {
  const { root, proj } = makeProject('write-sibling', { layout: 'sibling' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(root, 'aiaw-data-proj', 'tasks', 'AI-001', 'ai-work.md'),
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Edit on a file inside artifact root → allow', () => {
  const { root, proj } = makeProject('edit-allow', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Edit',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, '.claude', 'aiaw-data-proj', 'config', 'PROJECT_CONFIG.md'),
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Edit/Write with empty file path → fail-open (allow)', () => {
  const { root, proj } = makeProject('empty-path', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: '',
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Bash: redirection
// =========================================================================

test('Bash: stdout redirect to file inside artifact root → allow', () => {
  const { root, proj } = makeProject('bash-redir-ok', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: `echo hi > ${path.join(proj, '.claude', 'aiaw-data-proj', 'foo.txt')}`,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Bash: stdout redirect to file outside artifact root → block', () => {
  const { root, proj } = makeProject('bash-redir-bad', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: `echo hi > ${path.join(proj, 'src', 'foo.txt')}`,
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /redirection.*writes outside the artifact root/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Bash: append redirect (>>) outside artifact root → block', () => {
  const { root, proj } = makeProject('bash-append-bad', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: `echo hi >> ${path.join(proj, 'README.md')}`,
  });
  assert.strictEqual(out.status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Bash: mutators (rm/mv/cp/sed -i/touch)
// =========================================================================

test('Bash: rm of file inside artifact root → allow', () => {
  const { root, proj } = makeProject('rm-ok', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: `rm ${path.join(proj, '.claude', 'aiaw-data-proj', 'foo.txt')}`,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Bash: rm of file outside artifact root → block', () => {
  const { root, proj } = makeProject('rm-bad', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: `rm ${path.join(proj, 'src', 'index.js')}`,
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /"rm".*outside the artifact root/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Bash: mv with destination outside artifact root → block', () => {
  const { root, proj } = makeProject('mv-bad', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: `mv ${path.join(proj, '.claude', 'aiaw-data-proj', 'a')} ${path.join(proj, 'src', 'a')}`,
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /"mv".*outside the artifact root/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Bash: cp with destination inside artifact root → allow', () => {
  const { root, proj } = makeProject('cp-ok', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: `cp ${path.join(proj, 'README.md')} ${path.join(proj, '.claude', 'aiaw-data-proj', 'r.md')}`,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Bash: sed -i targeting consumer source → block', () => {
  const { root, proj } = makeProject('sed-bad', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: `sed -i 's/foo/bar/' ${path.join(proj, 'src', 'index.js')}`,
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /"sed -i".*outside the artifact root/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Bash: sed without -i (read-only) → allow even on source', () => {
  const { root, proj } = makeProject('sed-readonly', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: `sed -n '1,5p' ${path.join(proj, 'README.md')}`,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Bash: forbidden command prefixes
// =========================================================================

test('Bash: git commit is always blocked', () => {
  const { root, proj } = makeProject('git-commit', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: 'git commit -m "x"',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /"git commit".*mutates consumer-repo state/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Bash: npm install is always blocked', () => {
  const { root, proj } = makeProject('npm', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: 'npm install foo',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /"npm install".*mutates consumer-repo state/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Bash: read-only git status is allowed', () => {
  const { root, proj } = makeProject('git-status', { layout: 'local' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
    CLAUDE_TOOL_INPUT_COMMAND: 'git status',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Legacy folder hard-stop
// =========================================================================

test('Legacy ./ai-workflow-data/ folder + chief-orchestrator any write → block with migration hint', () => {
  const { root, proj } = makeProject('legacy', { layout: 'legacy' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'whatever.md'),
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /Legacy artifact folder/);
  assert.match(out.stderr, /Migration from ai-workflow-data/);
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

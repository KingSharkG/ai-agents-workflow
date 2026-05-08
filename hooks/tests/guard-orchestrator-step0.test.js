#!/usr/bin/env node
/**
 * Tests for hooks/guard-orchestrator-step0.js.
 *
 * Run:
 *   node hooks/tests/guard-orchestrator-step0.test.js
 *
 * Strategy: each test scaffolds an isolated tmp project (with or without a
 * task directory and task-data.md), spawns the hook with the right CLAUDE_*
 * env vars, and asserts on exit code (0 = allow, 1 = block) plus stderr
 * content.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'guard-orchestrator-step0.js');

function makeProject(label, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gos0-${label}-`));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const artifactRoot = path.join(proj, '.claude', 'aiaw-data-proj');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const tasksRoot = path.join(artifactRoot, 'tasks');
  fs.mkdirSync(tasksRoot, { recursive: true });
  let taskDir = null;
  if (opts.taskId) {
    taskDir = path.join(tasksRoot, opts.taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    if (opts.withTaskData) {
      fs.writeFileSync(
        path.join(taskDir, 'task-data.md'),
        '<!-- section:intake-classification -->\n' +
          '- final_path: execution-trivial\n' +
          '<!-- /section:intake-classification -->\n',
      );
    }
  }
  return { root, proj, artifactRoot, tasksRoot, taskDir };
}

function runHook(cwd, env) {
  // Strip developer-shell pollution before applying per-test env. Some tests
  // intentionally omit CLAUDE_* env vars to verify the hook's exemption
  // branches, and a developer with any of these exported in their shell would
  // silently flip those tests' expected behavior. Wildcard the strip so new
  // CLAUDE_* env contracts don't drift past this guard.
  //
  // The wildcard is intentionally broad: tests must be hermetic, so even
  // unrelated CLAUDE_* vars (e.g. CLAUDE_HOME, CLAUDE_VERSION) are stripped.
  // If a test needs a specific CLAUDE_* var set, it MUST opt in via opts.env.
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
// Caller exemption — non-chief is always allowed
// =========================================================================

test('non-orchestrator caller (executor) is exempt', () => {
  const { root, proj } = makeProject('non-chief');
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_MATCHER: 'Edit',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'index.js'),
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('top-level caller (no CLAUDE_SUBAGENT_TYPE) is exempt', () => {
  const { root, proj } = makeProject('toplevel');
  const out = runHook(proj, {
    CLAUDE_TOOL_MATCHER: 'Edit',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'index.js'),
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('namespaced subagent type is normalized via bareRole()', () => {
  const { root, proj } = makeProject('namespaced');
  // ai-agents-workflow:executor → executor → exempt
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'ai-agents-workflow:executor',
    CLAUDE_TOOL_MATCHER: 'Edit',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'index.js'),
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Matcher scope — Skill / Read / Bash bypass entirely
// =========================================================================

test('Skill matcher → ALLOW (intake/task-packet/state are needed during intake)', () => {
  const { root, proj } = makeProject('skill-bypass');
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Skill',
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Read matcher → ALLOW (chief reads context during intake)', () => {
  const { root, proj } = makeProject('read-bypass');
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Read',
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Bash matcher → ALLOW (CWD-check etc. bypass)', () => {
  const { root, proj } = makeProject('bash-bypass');
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Bash',
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Pre-intake (no task directory at all)
// =========================================================================

test('Edit before any task dir exists → BLOCK', () => {
  const { root, proj } = makeProject('pre-intake-edit');
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Edit',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'Color.kt'),
  });
  assert.strictEqual(out.status, 1, `expected block, got ${out.status}: ${out.stderr}`);
  assert.match(out.stderr, /BLOCKED/);
  assert.match(out.stderr, /Step 0/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Task dispatch before any task dir exists → BLOCK', () => {
  const { root, proj } = makeProject('pre-intake-task');
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Task',
    CLAUDE_TOOL_INPUT_PROMPT: 'do something',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED/);
  assert.match(out.stderr, /dispatch Task/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Write to consumer-repo path before any task dir → BLOCK', () => {
  const { root, proj } = makeProject('pre-intake-write-consumer');
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'README.md'),
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Write under artifact root before any task dir → ALLOW (bootstrapping)', () => {
  // Chief may need to create the very first task directory + task-data.md.
  const { root, proj, artifactRoot } = makeProject('pre-intake-write-bootstrap');
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(artifactRoot, 'tasks', 'AI-1', 'task-data.md'),
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Active task exists, task-data.md missing (intake stage in progress)
// =========================================================================

test('Edit when task-data.md missing → BLOCK', () => {
  const { root, proj } = makeProject('intake-edit', { taskId: 'AI-1' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Edit',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'Color.kt'),
  });
  assert.strictEqual(out.status, 1, out.stderr);
  assert.match(out.stderr, /Active task:\s+AI-1/);
  assert.match(out.stderr, /task-data\.md/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Task dispatch when task-data.md missing → BLOCK', () => {
  const { root, proj } = makeProject('intake-task', { taskId: 'AI-1' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Task',
    CLAUDE_TOOL_INPUT_PROMPT: 'AI-1: dispatch executor',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /Active task:\s+AI-1/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Write to consumer-repo path when task-data.md missing → BLOCK', () => {
  const { root, proj } = makeProject('intake-write-consumer', { taskId: 'AI-1' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'newfile.kt'),
  });
  assert.strictEqual(out.status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Write to <task_dir>/task-data.md when missing → ALLOW (task-packet skill)', () => {
  const { root, proj, taskDir } = makeProject('intake-write-tdmd', { taskId: 'AI-1' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(taskDir, 'task-data.md'),
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Write to <task_dir>/orchestration-state.json when task-data.md missing → ALLOW', () => {
  // Some orchestrators may write state file before task-data; both are
  // intake-stage artifacts under the task dir.
  const { root, proj, taskDir } = makeProject('intake-write-state', { taskId: 'AI-1' });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Write',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(taskDir, 'orchestration-state.json'),
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Intake complete (task-data.md exists) — hook is a no-op
// =========================================================================

test('Edit on consumer-repo path AFTER task-data.md exists → ALLOW (defer to other hooks)', () => {
  // This hook becomes a no-op; guard-orchestrator-source-writes is the next
  // line of defense. We don't want this hook to double-block.
  const { root, proj } = makeProject('post-intake-edit', {
    taskId: 'AI-1',
    withTaskData: true,
  });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Edit',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'Color.kt'),
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Task dispatch AFTER task-data.md exists → ALLOW (defer to pre-task-guard)', () => {
  const { root, proj } = makeProject('post-intake-task', {
    taskId: 'AI-1',
    withTaskData: true,
  });
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Task',
    CLAUDE_TOOL_INPUT_PROMPT: 'AI-1: dispatch executor',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Multi-task picking — most-recent dir by mtime
// =========================================================================

test('with two task dirs, picks most-recent for gating', () => {
  // Note on portability: this test backdates a directory via fs.utimesSync to
  // drive `mostRecentTaskDir(tasksRoot, 'dir')` selection. macOS and Linux
  // update directory mtime atomically; on Windows, directory mtime semantics
  // are looser and this test may flake on a Windows runner. If/when CI gains
  // a Windows leg, switch to ranking by a sentinel file's mtime instead.
  const { root, proj, tasksRoot } = makeProject('multi-task');
  const oldDir = path.join(tasksRoot, 'AI-OLD');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(
    path.join(oldDir, 'task-data.md'),
    'final_path: execution-trivial\n',
  );
  // Backdate old dir so it's clearly older.
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(oldDir, past, past);

  // New dir without task-data.md → still in intake.
  const newDir = path.join(tasksRoot, 'AI-NEW');
  fs.mkdirSync(newDir, { recursive: true });
  // touch newDir to ensure it's newer than oldDir
  const now = new Date();
  fs.utimesSync(newDir, now, now);

  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Edit',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'foo.ts'),
  });
  assert.strictEqual(out.status, 1, out.stderr);
  assert.match(out.stderr, /AI-NEW/);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Fail-open paths
// =========================================================================

test('no artifact root resolvable → ALLOW (fail-open)', () => {
  // Don't use makeProject — make a bare dir with no artifact folder.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gos0-noroot-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'Edit',
    CLAUDE_TOOL_INPUT_FILE_PATH: path.join(proj, 'src', 'foo.ts'),
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('unknown matcher → ALLOW (fail-open)', () => {
  const { root, proj } = makeProject('unknown-matcher');
  const out = runHook(proj, {
    CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_MATCHER: 'NotARealTool',
  });
  assert.strictEqual(out.status, 0);
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

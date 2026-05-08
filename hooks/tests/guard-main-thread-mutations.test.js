#!/usr/bin/env node
/**
 * Tests for hooks/guard-main-thread-mutations.js (PreToolUse, blocking).
 *
 * Contract:
 *   - Subagents (CLAUDE_SUBAGENT_TYPE set) are exempt — exit 0.
 *   - Non-Edit/Write/Bash matchers are exempt — exit 0.
 *   - When the most recent user prompt is NOT a /ai-agents-workflow:task
 *     invocation, exit 0.
 *   - When chief-orchestrator has already been dispatched in the current
 *     turn, exit 0.
 *   - When the target Edit/Write is inside the artifact root, exit 0.
 *   - Bash commands matching the read-only allow-list exit 0.
 *   - Otherwise: exit 1 with a [guard-main-thread-mutations] BLOCKED stderr.
 *
 * Run:
 *   node hooks/tests/guard-main-thread-mutations.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'guard-main-thread-mutations.js');

function makeProject(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gmtm-${label}-`));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const artifactRoot = path.join(proj, '.claude', 'aiaw-data-proj');
  fs.mkdirSync(artifactRoot, { recursive: true });
  return { root, proj, artifactRoot };
}

function writeTranscript(label, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gmtm-t-${label}-`));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return { dir, file };
}

function userLine(text) {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
  });
}

function assistantToolUse(parts) {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: parts },
  });
}

function chiefDispatch(subagent = 'ai-agents-workflow:chief-orchestrator') {
  return {
    type: 'tool_use',
    name: 'Task',
    input: { subagent_type: subagent, prompt: 'go' },
  };
}

function runHook(opts = {}) {
  const baseEnv = Object.assign({}, process.env);
  for (const k of Object.keys(baseEnv)) {
    if (k.startsWith('CLAUDE_')) delete baseEnv[k];
  }
  const payload = Object.assign(
    { transcript_path: opts.transcriptPath || '', tool_input: opts.toolInput || {} },
    opts.payloadOverrides || {},
  );
  return spawnSync(process.execPath, [HOOK], {
    cwd: opts.cwd || undefined,
    encoding: 'utf8',
    input: JSON.stringify(payload),
    env: Object.assign(baseEnv, opts.env || {}),
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// =========================================================================
// Caller exemption
// =========================================================================

test('subagent caller (CLAUDE_SUBAGENT_TYPE=executor) is exempt', () => {
  const out = runHook({
    env: { CLAUDE_SUBAGENT_TYPE: 'executor', CLAUDE_TOOL_MATCHER: 'Edit' },
  });
  assert.strictEqual(out.status, 0);
});

test('namespaced subagent type (ai-agents-workflow:lead) is exempt', () => {
  const out = runHook({
    env: { CLAUDE_SUBAGENT_TYPE: 'ai-agents-workflow:lead', CLAUDE_TOOL_MATCHER: 'Write' },
  });
  assert.strictEqual(out.status, 0);
});

// =========================================================================
// Matcher scope
// =========================================================================

test('non-Edit/Write/Bash matcher (Read) → exit 0', () => {
  const out = runHook({ env: { CLAUDE_TOOL_MATCHER: 'Read' } });
  assert.strictEqual(out.status, 0);
});

test('empty matcher → exit 0', () => {
  const out = runHook({ env: {} });
  assert.strictEqual(out.status, 0);
});

// =========================================================================
// Transcript / user-prompt gating
// =========================================================================

test('no transcript path → exit 0 (fail-open)', () => {
  const out = runHook({
    env: { CLAUDE_TOOL_MATCHER: 'Edit' },
    toolInput: { file_path: '/tmp/file.js' },
  });
  assert.strictEqual(out.status, 0);
});

test('user prompt is not /task → exit 0', () => {
  const { dir, file } = writeTranscript('not-task', [
    userLine('please review my code'),
  ]);
  const out = runHook({
    env: { CLAUDE_TOOL_MATCHER: 'Edit' },
    transcriptPath: file,
    toolInput: { file_path: '/tmp/file.js' },
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// /task command + chief dispatched → ALLOW
// =========================================================================

test('/task + chief dispatched + Edit → exit 0', () => {
  const { dir, file } = writeTranscript('dispatched', [
    userLine('/ai-agents-workflow:task add a feature'),
    assistantToolUse([chiefDispatch()]),
  ]);
  const out = runHook({
    env: { CLAUDE_TOOL_MATCHER: 'Edit' },
    transcriptPath: file,
    toolInput: { file_path: '/tmp/file.js' },
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('/task + bare chief-orchestrator subagent name (no namespace) → exit 0', () => {
  const { dir, file } = writeTranscript('dispatched-bare', [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([chiefDispatch('chief-orchestrator')]),
  ]);
  const out = runHook({
    env: { CLAUDE_TOOL_MATCHER: 'Write' },
    transcriptPath: file,
    toolInput: { file_path: '/tmp/file.js' },
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// /task command + no dispatch → BLOCK (with carve-outs)
// =========================================================================

test('/task + no dispatch + Edit on consumer-repo path → BLOCK', () => {
  const { dir, file } = writeTranscript('block-edit', [
    userLine('/ai-agents-workflow:task add code'),
  ]);
  const { root, proj } = makeProject('block-edit');
  const out = runHook({
    env: { CLAUDE_TOOL_MATCHER: 'Edit' },
    transcriptPath: file,
    toolInput: { file_path: path.join(proj, 'src', 'index.js') },
    cwd: proj,
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED/);
  assert.match(out.stderr, /chief-orchestrator/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('/task + no dispatch + Edit on artifact-root path → exit 0 (carve-out)', () => {
  const { dir, file } = writeTranscript('allow-art-edit', [
    userLine('/ai-agents-workflow:task'),
  ]);
  const { root, proj, artifactRoot } = makeProject('allow-art-edit');
  const out = runHook({
    env: { CLAUDE_TOOL_MATCHER: 'Write' },
    transcriptPath: file,
    toolInput: { file_path: path.join(artifactRoot, 'tasks', 'AI-1', 'task-data.md') },
    cwd: proj,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('/task + no dispatch + Bash read-only command (ls) → exit 0', () => {
  const { dir, file } = writeTranscript('bash-read', [
    userLine('/ai-agents-workflow:task'),
  ]);
  const { root, proj } = makeProject('bash-read');
  const out = runHook({
    env: { CLAUDE_TOOL_MATCHER: 'Bash' },
    transcriptPath: file,
    toolInput: { command: 'ls -la' },
    cwd: proj,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('/task + no dispatch + Bash with redirect → BLOCK', () => {
  const { dir, file } = writeTranscript('bash-redirect', [
    userLine('/ai-agents-workflow:task'),
  ]);
  const { root, proj } = makeProject('bash-redirect');
  const out = runHook({
    env: { CLAUDE_TOOL_MATCHER: 'Bash' },
    transcriptPath: file,
    toolInput: { command: 'echo hi > out.txt' },
    cwd: proj,
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('/task + no dispatch + Bash mutation verb (rm) → BLOCK', () => {
  const { dir, file } = writeTranscript('bash-rm', [
    userLine('/ai-agents-workflow:task'),
  ]);
  const { root, proj } = makeProject('bash-rm');
  const out = runHook({
    env: { CLAUDE_TOOL_MATCHER: 'Bash' },
    transcriptPath: file,
    toolInput: { command: 'rm -rf foo' },
    cwd: proj,
  });
  assert.strictEqual(out.status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
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

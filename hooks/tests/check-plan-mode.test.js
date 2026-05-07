#!/usr/bin/env node
/**
 * Tests for hooks/check-plan-mode.js.
 *
 * Run:
 *   node hooks/tests/check-plan-mode.test.js
 *
 * Strategy: build a synthetic JSONL transcript in a tmpdir, point the hook
 * at it via CLAUDE_TRANSCRIPT_PATH, and assert exit code + stderr.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'check-plan-mode.js');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const { PLAN_MODE_MESSAGE } = require('../lib/plan-mode-message');

function tmpTranscript(label, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cpm-${label}-`));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, file };
}

function runHook(env) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }, env),
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// Banner text the harness injects when plan mode is on.
const BANNER = 'Plan mode is active';

// =========================================================================
// Subagent filter
// =========================================================================

test('non-chief-orchestrator subagent → exit 0 regardless of transcript', () => {
  const { dir, file } = tmpTranscript('non-chief', [
    {
      type: 'user',
      message: { role: 'user', content: BANNER + ' some text' },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TRANSCRIPT_PATH: file,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('namespaced non-chief subagent → exit 0', () => {
  const { dir, file } = tmpTranscript('non-chief-ns', [
    {
      type: 'user',
      message: { role: 'user', content: BANNER },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'ai-agents-workflow:reviewer',
    CLAUDE_TRANSCRIPT_PATH: file,
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Transcript availability
// =========================================================================

test('missing CLAUDE_TRANSCRIPT_PATH → exit 0', () => {
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: '',
  });
  assert.strictEqual(out.status, 0, out.stderr);
});

test('non-existent transcript path → exit 0', () => {
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: '/nonexistent/path/transcript.jsonl',
  });
  assert.strictEqual(out.status, 0);
});

// =========================================================================
// Banner detection
// =========================================================================

test('banner in most recent user turn + chief-orchestrator → block', () => {
  const { dir, file } = tmpTranscript('banner-on', [
    {
      type: 'user',
      message: { role: 'user', content: 'do the thing' },
    },
    {
      type: 'assistant',
      message: { role: 'assistant', content: 'ok' },
    },
    {
      type: 'user',
      message: {
        role: 'user',
        content: `<system-reminder>${BANNER}. The user indicated...</system-reminder>\nrun /ai-agents-workflow:task`,
      },
    },
    {
      type: 'assistant',
      message: { role: 'assistant', content: 'dispatching' },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: file,
  });
  assert.strictEqual(out.status, 1);
  assert.ok(
    out.stderr.includes(PLAN_MODE_MESSAGE),
    `expected stderr to carry the canonical message; got: ${out.stderr}`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('namespaced chief-orchestrator + banner → block', () => {
  const { dir, file } = tmpTranscript('banner-on-ns', [
    {
      type: 'user',
      message: { role: 'user', content: BANNER },
    },
    {
      type: 'assistant',
      message: { role: 'assistant', content: 'ok' },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'ai-agents-workflow:chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: file,
  });
  assert.strictEqual(out.status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('banner in older turn but absent from latest → allow', () => {
  // Older user turn carried the banner (plan mode was on then), but the user
  // has since exited plan mode and sent a fresh message without the banner.
  const { dir, file } = tmpTranscript('banner-old', [
    {
      type: 'user',
      message: {
        role: 'user',
        content: `<system-reminder>${BANNER}</system-reminder>\nstart planning something`,
      },
    },
    {
      type: 'assistant',
      message: { role: 'assistant', content: 'ok, here is the plan' },
    },
    {
      type: 'user',
      message: { role: 'user', content: 'great, now run /ai-agents-workflow:task' },
    },
    {
      type: 'assistant',
      message: { role: 'assistant', content: 'dispatching' },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: file,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('transcript with no banner anywhere → allow', () => {
  const { dir, file } = tmpTranscript('no-banner', [
    {
      type: 'user',
      message: { role: 'user', content: 'run /ai-agents-workflow:task' },
    },
    {
      type: 'assistant',
      message: { role: 'assistant', content: 'dispatching' },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: file,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('transcript with no assistant turn yet → allow', () => {
  // First user message before the assistant has done anything; the banner
  // detection requires an assistant turn to anchor the "current turn"
  // window. With none, fail open.
  const { dir, file } = tmpTranscript('no-assistant', [
    {
      type: 'user',
      message: { role: 'user', content: BANNER + '\nrun /ai-agents-workflow:task' },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: file,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Kill switch
// =========================================================================

test('AIAW_DISABLE_PLAN_MODE_GUARD=1 with banner present → allow', () => {
  const { dir, file } = tmpTranscript('killsw', [
    {
      type: 'user',
      message: { role: 'user', content: BANNER },
    },
    {
      type: 'assistant',
      message: { role: 'assistant', content: 'ok' },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: file,
    AIAW_DISABLE_PLAN_MODE_GUARD: '1',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Run
// =========================================================================

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    process.stdout.write(`ok  ${t.name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`FAIL  ${t.name}\n`);
    process.stdout.write(`     ${err.message}\n`);
    if (err.stack) process.stdout.write(`     ${err.stack}\n`);
    failed++;
  }
}

process.stdout.write(
  `\n${passed} passed, ${failed} failed (${tests.length} total)\n`,
);
process.exit(failed === 0 ? 0 : 1);

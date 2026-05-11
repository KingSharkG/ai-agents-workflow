#!/usr/bin/env node
/**
 * Tests for the Phase 0 plan-mode block in hooks/pre-task-guard.js (folded
 * in from the standalone hooks/check-plan-mode.js in Phase 2.1).
 *
 * Phase 0 fires only when the dispatched subagent is `chief-orchestrator`.
 * It reads the JSONL transcript at `payload.transcript_path` (or
 * `CLAUDE_TRANSCRIPT_PATH`) and blocks dispatch when the literal banner
 * "Plan mode is active" appears in the most-recent user/system block.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'pre-task-guard.js');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const { PLAN_MODE_MESSAGE } = require('../lib/plan-mode-message');

function tmpTranscript(label, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ptg-pm-${label}-`));
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

const BANNER = 'Plan mode is active';

test('chief + banner in current user/system block → BLOCK', () => {
  const { dir, file } = tmpTranscript('chief-blocked', [
    { type: 'user', message: { role: 'user', content: 'hi' } },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    },
    { type: 'user', message: { role: 'user', content: BANNER + ' …' } },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'about to dispatch' }] },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: file,
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED/);
  assert.ok(
    out.stderr.includes(PLAN_MODE_MESSAGE),
    `stderr should include the canonical message: ${out.stderr}`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('chief + namespaced subagent type + banner → BLOCK', () => {
  const { dir, file } = tmpTranscript('chief-ns-blocked', [
    { type: 'user', message: { role: 'user', content: BANNER } },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'go' }] },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'ai-agents-workflow:chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: file,
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('chief + no banner → ALLOW', () => {
  const { dir, file } = tmpTranscript('chief-clean', [
    { type: 'user', message: { role: 'user', content: 'kick off task' } },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'starting' }] },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: file,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('chief + stale banner from earlier turn (before last user msg) → ALLOW', () => {
  const { dir, file } = tmpTranscript('chief-stale', [
    { type: 'user', message: { role: 'user', content: BANNER + ' from old turn' } },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'first reply' }] },
    },
    { type: 'user', message: { role: 'user', content: 'now actually run /task' } },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'on it' }] },
    },
  ]);
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: file,
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('chief + missing transcript path → ALLOW (fail-open)', () => {
  const out = runHook({
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TRANSCRIPT_PATH: '/this/transcript/does/not/exist.jsonl',
  });
  assert.strictEqual(out.status, 0, out.stderr);
});

test('AIAW_DISABLE_PLAN_MODE_GUARD=1 bypasses Phase 0 even with banner present', () => {
  const { dir, file } = tmpTranscript('chief-killswitch', [
    { type: 'user', message: { role: 'user', content: BANNER } },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'go' }] },
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

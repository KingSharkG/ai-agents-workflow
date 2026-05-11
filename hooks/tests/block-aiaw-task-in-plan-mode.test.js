#!/usr/bin/env node
/**
 * Tests for hooks/block-aiaw-task-in-plan-mode.js.
 *
 * Strategy: feed synthetic UserPromptSubmit payloads on stdin, assert exit
 * code + stderr.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'block-aiaw-task-in-plan-mode.js');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

function runHook(payload, extraEnv) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: Object.assign(
      {},
      process.env,
      { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      extraEnv || {},
    ),
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// =========================================================================
// Block paths
// =========================================================================

test('plan mode + /ai-agents-workflow:task with args → block', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: '/ai-agents-workflow:task fix the thing',
  });
  assert.strictEqual(out.status, 2, `stderr: ${out.stderr}`);
  assert.ok(/Plan mode is on/.test(out.stderr), `stderr: ${out.stderr}`);
  assert.ok(/Shift\+Tab/.test(out.stderr));
  assert.ok(/ai-agents-workflow:task/.test(out.stderr));
});

test('plan mode + /ai-agents-workflow:task with no args → block', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: '/ai-agents-workflow:task',
  });
  assert.strictEqual(out.status, 2);
});

test('plan mode + /ai-agents-workflow:continue → block (with command name in message)', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: '/ai-agents-workflow:continue',
  });
  assert.strictEqual(out.status, 2);
  assert.ok(
    /ai-agents-workflow:continue/.test(out.stderr),
    `expected stderr to mention the specific command; got: ${out.stderr}`,
  );
});

test('plan mode + leading whitespace before slash command → block', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: '   /ai-agents-workflow:task hi',
  });
  assert.strictEqual(out.status, 2);
});

// =========================================================================
// Allow paths (not plan mode)
// =========================================================================

test('default permission_mode + slash command → allow', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'default',
    prompt: '/ai-agents-workflow:task fix the thing',
  });
  assert.strictEqual(out.status, 0, `stderr: ${out.stderr}`);
});

test('acceptEdits + slash command → allow', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'acceptEdits',
    prompt: '/ai-agents-workflow:task fix the thing',
  });
  assert.strictEqual(out.status, 0);
});

test('missing permission_mode → allow', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    prompt: '/ai-agents-workflow:task hi',
  });
  assert.strictEqual(out.status, 0);
});

// =========================================================================
// Allow paths (plan mode but non-gated content)
// =========================================================================

test('plan mode + unrelated slash command → allow', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: '/help',
  });
  assert.strictEqual(out.status, 0);
});

for (const cmd of ['init', 'add', 'update', 'remove', 'pr-lessons', 'review']) {
  test(`plan mode + /ai-agents-workflow:${cmd} → block`, () => {
    const out = runHook({
      hook_event_name: 'UserPromptSubmit',
      permission_mode: 'plan',
      prompt: `/ai-agents-workflow:${cmd}`,
    });
    assert.strictEqual(out.status, 2, `cmd=${cmd}, stderr: ${out.stderr}`);
    assert.ok(
      new RegExp(`ai-agents-workflow:${cmd.replace(/-/g, '\\-')}`).test(out.stderr),
      `expected stderr to mention /${cmd}; got: ${out.stderr}`,
    );
  });
}

test('plan mode + non-aiaw slash command → allow', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: '/some-other-plugin:command',
  });
  assert.strictEqual(out.status, 0);
});

test('plan mode + plain text mentioning slash command in middle → allow', () => {
  // Match is anchored to start-of-prompt — embedded references should NOT
  // trigger the block.
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: "tell me about /ai-agents-workflow:task",
  });
  assert.strictEqual(out.status, 0);
});

test('plan mode + similar-prefix command → allow (word boundary)', () => {
  // Guards against accidental match of e.g. /ai-agents-workflow:taskz
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: '/ai-agents-workflow:taskz arg',
  });
  assert.strictEqual(out.status, 0);
});

// =========================================================================
// Kill switch + malformed input
// =========================================================================

test('kill switch AIAW_DISABLE_PLAN_MODE_GUARD=1 → allow even when would block', () => {
  const out = runHook(
    {
      hook_event_name: 'UserPromptSubmit',
      permission_mode: 'plan',
      prompt: '/ai-agents-workflow:task hi',
    },
    { AIAW_DISABLE_PLAN_MODE_GUARD: '1' },
  );
  assert.strictEqual(out.status, 0, `stderr: ${out.stderr}`);
});

test('malformed JSON on stdin → allow (fail-open)', () => {
  const out = runHook('this is not json {{{');
  assert.strictEqual(out.status, 0);
});

test('empty stdin → allow', () => {
  const out = runHook('');
  assert.strictEqual(out.status, 0);
});

test('non-string non-array prompt field → allow (defensive)', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: { not: 'a string' },
  });
  assert.strictEqual(out.status, 0);
});

test('array prompt with text part containing slash command → block', () => {
  // Some harness versions may pass `prompt` as an array of content parts.
  // The hook should coerce and still match the slash command at the start.
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: [
      { type: 'text', text: '/ai-agents-workflow:task fix the thing' },
    ],
  });
  assert.strictEqual(out.status, 2, `stderr: ${out.stderr}`);
  assert.match(out.stderr, /Shift\+Tab/);
});

test('array prompt with mixed parts including slash command at start → block', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: [
      { type: 'text', text: '/ai-agents-workflow:init' },
      { type: 'text', text: 'second part' },
    ],
  });
  assert.strictEqual(out.status, 2);
});

test('array prompt with bare-string parts → block', () => {
  // Defensive: array of strings (some hypothetical shape) should also coerce.
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: ['/ai-agents-workflow:task hi', 'more text'],
  });
  assert.strictEqual(out.status, 2);
});

test('array prompt with no text part → allow', () => {
  const out = runHook({
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'plan',
    prompt: [{ type: 'image', source: {} }],
  });
  assert.strictEqual(out.status, 0);
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

#!/usr/bin/env node
/**
 * Tests for hooks/guard-main-thread-skills.js.
 *
 * Run:
 *   node hooks/tests/guard-main-thread-skills.test.js
 *
 * Strategy: write a temp transcript JSONL file, spawn the hook with a stdin
 * payload pointing at it, and assert exit code + stderr.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'guard-main-thread-skills.js');

function makeTranscript(label, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gmts-${label}-`));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { dir, file };
}

function userMsg(text) {
  return { type: 'user', message: { role: 'user', content: text } };
}

function assistantText(text) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function assistantTaskDispatch(subagentType) {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          name: 'Task',
          input: { subagent_type: subagentType, prompt: 'go' },
        },
      ],
    },
  };
}

function runHook(transcriptPath, toolInput) {
  const stdin = JSON.stringify({
    transcript_path: transcriptPath,
    tool_name: 'Skill',
    tool_input: toolInput || { skill: 'superpowers:receiving-code-review' },
  });
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: stdin,
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// =========================================================================
// Allow paths
// =========================================================================

test('non-/task user prompt → allow', () => {
  const { dir, file } = makeTranscript('non-task', [
    userMsg('please refactor the auth module'),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('/task prompt + chief-orchestrator already dispatched → allow', () => {
  const { dir, file } = makeTranscript('post-dispatch', [
    userMsg('/ai-agents-workflow:task review feedback to my PR'),
    assistantTaskDispatch('ai-agents-workflow:chief-orchestrator'),
    assistantText('orchestrator running'),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bare chief-orchestrator subagent name (no namespace) → allow', () => {
  const { dir, file } = makeTranscript('bare-name', [
    userMsg('/ai-agents-workflow:task fix bug'),
    assistantTaskDispatch('chief-orchestrator'),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing transcript path → fail open (allow)', () => {
  const out = runHook('/nonexistent/transcript.jsonl');
  assert.strictEqual(out.status, 0, out.stderr);
});

test('empty stdin → fail open (allow)', () => {
  const proc = spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: '',
  });
  assert.strictEqual(proc.status, 0, proc.stderr);
});

test('command-body marker matches when slash text is expanded away', () => {
  const { dir, file } = makeTranscript('body-marker', [
    userMsg(
      'Some preamble.\n\nDispatch the `chief-orchestrator` subagent with the task description.\n\nMore prose.',
    ),
    assistantTaskDispatch('ai-agents-workflow:chief-orchestrator'),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Block paths
// =========================================================================

test('/task prompt + no chief-orchestrator dispatched → block', () => {
  const { dir, file } = makeTranscript('block-no-dispatch', [
    userMsg('/ai-agents-workflow:task review feedback to my PR'),
    assistantText('thinking about which skill to use'),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED/);
  assert.match(out.stderr, /chief-orchestrator/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('/task prompt + non-chief Task dispatch → still block', () => {
  // A Task() to some other subagent should NOT count as the dispatch we want.
  const { dir, file } = makeTranscript('block-wrong-dispatch', [
    userMsg('/ai-agents-workflow:task review feedback to my PR'),
    assistantTaskDispatch('ai-agents-workflow:executor'),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('command-body marker present + no dispatch → block', () => {
  const { dir, file } = makeTranscript('body-marker-block', [
    userMsg(
      'Dispatch the `chief-orchestrator` subagent with the task description.',
    ),
    assistantText('proceeding to invoke skill instead'),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
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
    process.stdout.write(`  ok   ${t.name}\n`);
    passed++;
  } catch (e) {
    process.stdout.write(`  FAIL ${t.name}\n    ${e.message}\n`);
    failed++;
  }
}
process.stdout.write(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);
process.exit(failed === 0 ? 0 : 1);

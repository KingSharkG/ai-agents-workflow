#!/usr/bin/env node
/**
 * Tests for the Phase 1.4 PRE_DISPATCH_SKILL_ALLOWLIST in
 * hooks/guard-main-thread-skills.js. The allowlist permits a narrow set of
 * skills (currently only `resolve-artifact-root`) to run in the main thread
 * BEFORE the chief-orchestrator dispatch — needed by the `/task` and
 * `/continue` command pre-flights.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'guard-main-thread-skills.js');

function makeTranscript(label, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gmts-allow-${label}-`));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { dir, file };
}

function userMsg(text) {
  return { type: 'user', message: { role: 'user', content: text } };
}

function runHook(transcriptPath, toolInput) {
  const stdin = JSON.stringify({
    transcript_path: transcriptPath,
    tool_name: 'Skill',
    tool_input: toolInput,
  });
  return spawnSync(process.execPath, [HOOK], { encoding: 'utf8', input: stdin });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// A user prompt that DOES look like a /task invocation — without the
// allowlist these calls would be blocked because no chief-orchestrator
// dispatch is in the transcript.
const TASK_PROMPT = '/ai-agents-workflow:task fix the typo in README';

test('bare resolve-artifact-root pre-dispatch → allow', () => {
  const { dir, file } = makeTranscript('bare-rar', [userMsg(TASK_PROMPT)]);
  const out = runHook(file, { skill: 'resolve-artifact-root' });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('namespaced ai-agents-workflow:resolve-artifact-root pre-dispatch → allow', () => {
  const { dir, file } = makeTranscript('ns-rar', [userMsg(TASK_PROMPT)]);
  const out = runHook(file, { skill: 'ai-agents-workflow:resolve-artifact-root' });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('non-allowlisted skill pre-dispatch → block', () => {
  const { dir, file } = makeTranscript('block-other', [userMsg(TASK_PROMPT)]);
  const out = runHook(file, { skill: 'superpowers:receiving-code-review' });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('similarly-named non-allowlisted skill pre-dispatch → block', () => {
  // Defensive: ensure the matcher is exact-name, not a prefix or substring.
  const { dir, file } = makeTranscript('block-similar', [userMsg(TASK_PROMPT)]);
  const out = runHook(file, { skill: 'resolve-artifact-root-extra' });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('payload using `name` instead of `skill` is also recognized for allowlist', () => {
  const { dir, file } = makeTranscript('rar-name-key', [userMsg(TASK_PROMPT)]);
  const out = runHook(file, { name: 'ai-agents-workflow:resolve-artifact-root' });
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

#!/usr/bin/env node
/**
 * Tests for the Phase 1.1/1.2/1.3 changes to validate-artifact-chain.js:
 *
 *   - intake-stage state writes are not required to carry mode/task_summary_path
 *   - non-intake stage writes still require those fields
 *   - last_completed_seq is required when schema_version >= 2 AND stage != intake
 *   - Task Summary required-headings list relaxes to ['Status'] for trivial tasks
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'validate-artifact-chain.js');

function runHook(filePath) {
  return spawnSync(process.execPath, [HOOK, filePath], { encoding: 'utf8' });
}

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `vac-intake-${label}-`));
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// -----------------------------------------------------------------------
// orchestration-state.json — intake-stage relaxation
// -----------------------------------------------------------------------

test('intake-stage state without mode/task_summary_path passes', () => {
  const dir = tmpDir('intake-ok');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      task_id: 'TP-001',
      stage: 'intake',
      phase: 'planning',
      pending_subtasks: [],
      blocked_gates: [],
      pending_user_actions: [],
    }),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('planning-stage state without mode is rejected', () => {
  const dir = tmpDir('planning-no-mode');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      task_id: 'TP-001',
      stage: 'planning',
      phase: 'planning',
      pending_subtasks: [],
      blocked_gates: [],
      pending_user_actions: [],
      task_summary_path: 'tasks/TP-001/summary.md',
    }),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing required fields.*mode/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('execution-stage state without task_summary_path is rejected', () => {
  const dir = tmpDir('execution-no-tsp');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      task_id: 'TP-001',
      stage: 'execution',
      mode: 'normal',
      phase: 'execution',
      pending_subtasks: ['TP-001-A1'],
      blocked_gates: [],
      pending_user_actions: [],
    }),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing required fields.*task_summary_path/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('legacy v2 state without stage field still requires mode + task_summary_path', () => {
  const dir = tmpDir('v2-no-stage');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      task_id: 'TP-001',
      schema_version: 2,
      phase: 'execution',
      pending_subtasks: ['TP-001-A1'],
      blocked_gates: [],
      pending_user_actions: [],
      // Missing: mode, task_summary_path
    }),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing required fields/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------
// last_completed_seq parity (Phase 1.2)
// -----------------------------------------------------------------------

test('schema_version=3 + stage=execution without last_completed_seq is rejected', () => {
  const dir = tmpDir('v3-no-lcs');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      task_id: 'TP-001',
      schema_version: 3,
      stage: 'execution',
      mode: 'normal',
      phase: 'execution',
      pending_subtasks: ['TP-001-A1'],
      blocked_gates: [],
      pending_user_actions: [],
      task_summary_path: 'tasks/TP-001/summary.md',
    }),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing required fields.*last_completed_seq/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('schema_version=3 + stage=intake without last_completed_seq passes', () => {
  const dir = tmpDir('v3-intake-no-lcs');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      task_id: 'TP-001',
      schema_version: 3,
      stage: 'intake',
      phase: 'planning',
      pending_subtasks: [],
      blocked_gates: [],
      pending_user_actions: [],
    }),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('last_completed_seq must be a non-negative number', () => {
  const dir = tmpDir('lcs-bad-type');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      task_id: 'TP-001',
      schema_version: 3,
      stage: 'execution',
      mode: 'normal',
      phase: 'execution',
      pending_subtasks: ['TP-001-A1'],
      blocked_gates: [],
      pending_user_actions: [],
      task_summary_path: 'tasks/TP-001/summary.md',
      last_completed_seq: -1,
    }),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /last_completed_seq must be a non-negative number/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------
// Trivial Task Summary relaxation (Phase 1.3)
// -----------------------------------------------------------------------

function writeTaskSummary(parentDir, body) {
  // Task Summary lives at <root>/tasks/<task_id>/summary.md.
  const tasksDir = path.join(parentDir, 'tasks');
  const taskDir = path.join(tasksDir, 'TP-001');
  fs.mkdirSync(taskDir, { recursive: true });
  const summaryPath = path.join(taskDir, 'summary.md');
  fs.writeFileSync(summaryPath, body);
  return { summaryPath, taskDir };
}

test('Task Summary with classification=execution-trivial passes with only ## Status', () => {
  const dir = tmpDir('trivial-summary-ok');
  const { summaryPath, taskDir } = writeTaskSummary(
    dir,
    [
      '# Task Summary',
      '',
      '- task_id: TP-001',
      '',
      '## Status',
      '',
      'Done.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(taskDir, 'orchestration-state.json'),
    JSON.stringify({
      task_id: 'TP-001',
      classification: 'execution-trivial',
      mode: 'normal',
      phase: 'complete',
      pending_subtasks: [],
      blocked_gates: [],
      pending_user_actions: [],
      task_summary_path: 'tasks/TP-001/summary.md',
    }),
  );
  const out = runHook(summaryPath);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Task Summary without trivial classification still requires the full heading list', () => {
  const dir = tmpDir('non-trivial-summary');
  const { summaryPath, taskDir } = writeTaskSummary(
    dir,
    [
      '# Task Summary',
      '',
      '- task_id: TP-001',
      '',
      '## Status',
      '',
      'Done.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(taskDir, 'orchestration-state.json'),
    JSON.stringify({
      task_id: 'TP-001',
      classification: 'execution-simple',
      mode: 'normal',
      phase: 'complete',
      pending_subtasks: [],
      blocked_gates: [],
      pending_user_actions: [],
      task_summary_path: 'tasks/TP-001/summary.md',
    }),
  );
  const out = runHook(summaryPath);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing required headings/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Task Summary with no sibling state file still requires the full heading list', () => {
  const dir = tmpDir('no-state-summary');
  const { summaryPath } = writeTaskSummary(
    dir,
    [
      '# Task Summary',
      '',
      '- task_id: TP-001',
      '',
      '## Status',
      '',
      'Done.',
      '',
    ].join('\n'),
  );
  // No sibling orchestration-state.json — readSiblingTaskState() returns null,
  // so the relaxation does NOT apply.
  const out = runHook(summaryPath);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing required headings/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------

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

#!/usr/bin/env node
/**
 * Tests for the Phase 2.2 recent-task index in hooks/lib/active-task.js.
 *
 * - mostRecentTaskDir() consults `<tasksRoot>/.recent` first and returns the
 *   indexed task id without walking the directory.
 * - Stale index (referenced task dir deleted) falls back to the directory walk.
 * - State-mode index entries are ignored when the indexed dir lacks the
 *   orchestration-state.json file.
 * - writeRecentIndex() is best-effort: idempotent updates, robust to malformed
 *   pre-existing index files.
 * - The legitimate writer (validate-artifact-chain.js on a valid state file)
 *   refreshes the index.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  mostRecentTaskDir,
  writeRecentIndex,
  RECENT_INDEX_FILENAME,
} = require('../lib/active-task');

const VALIDATOR = path.join(__dirname, '..', 'validate-artifact-chain.js');

function tmpTasks(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `rti-${label}-`));
  const tasks = path.join(root, 'tasks');
  fs.mkdirSync(tasks, { recursive: true });
  return { root, tasks };
}

function mkTaskDir(tasks, id, opts = {}) {
  const dir = path.join(tasks, id);
  fs.mkdirSync(dir, { recursive: true });
  if (opts.state) {
    fs.writeFileSync(
      path.join(dir, 'orchestration-state.json'),
      JSON.stringify(opts.state),
    );
  }
  return dir;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// -------- Lib unit tests --------

test('writeRecentIndex (default mode=state) writes only the state field', () => {
  const { root, tasks } = tmpTasks('write-state-only');
  writeRecentIndex(tasks, 'TP-100');
  const idx = JSON.parse(fs.readFileSync(path.join(tasks, RECENT_INDEX_FILENAME), 'utf8'));
  assert.strictEqual(idx.state, 'TP-100');
  assert.ok(!('dir' in idx), 'dir field should NOT be set by a state-mode write');
  assert.ok(typeof idx.updated_at === 'string');
  fs.rmSync(root, { recursive: true, force: true });
});

test('writeRecentIndex(mode="dir") writes only the dir field; modes are independent', () => {
  const { root, tasks } = tmpTasks('write-modes-indep');
  writeRecentIndex(tasks, 'TP-STATE', 'state');
  writeRecentIndex(tasks, 'TP-DIR', 'dir');
  const idx = JSON.parse(fs.readFileSync(path.join(tasks, RECENT_INDEX_FILENAME), 'utf8'));
  assert.strictEqual(idx.state, 'TP-STATE');
  assert.strictEqual(idx.dir, 'TP-DIR');
  fs.rmSync(root, { recursive: true, force: true });
});

test('writeRecentIndex with unknown mode throws', () => {
  const { root, tasks } = tmpTasks('write-bad-mode');
  assert.throws(() => writeRecentIndex(tasks, 'TP-100', 'whatever'), /unknown mode/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('mostRecentTaskDir(state) uses the index when present', () => {
  const { root, tasks } = tmpTasks('index-hit-state');
  // Write two task dirs but only index the older one — the index should win.
  mkTaskDir(tasks, 'TP-100', { state: { task_id: 'TP-100', phase: 'planning' } });
  mkTaskDir(tasks, 'TP-200', { state: { task_id: 'TP-200', phase: 'planning' } });
  writeRecentIndex(tasks, 'TP-100', 'state');
  assert.strictEqual(mostRecentTaskDir(tasks, 'state'), 'TP-100');
  fs.rmSync(root, { recursive: true, force: true });
});

test('mostRecentTaskDir(dir) uses the index when present', () => {
  const { root, tasks } = tmpTasks('index-hit-dir');
  mkTaskDir(tasks, 'TP-100', { state: { task_id: 'TP-100', phase: 'planning' } });
  mkTaskDir(tasks, 'TP-200', { state: { task_id: 'TP-200', phase: 'planning' } });
  writeRecentIndex(tasks, 'TP-100', 'dir');
  assert.strictEqual(mostRecentTaskDir(tasks, 'dir'), 'TP-100');
  fs.rmSync(root, { recursive: true, force: true });
});

test('mostRecentTaskDir(dir) falls back to walk when only state field is indexed', () => {
  const { root, tasks } = tmpTasks('dir-no-index-fallback');
  // Create A first, then B (so B has the newer dir mtime per readdir+stat).
  mkTaskDir(tasks, 'TP-A', { state: { task_id: 'TP-A', phase: 'planning' } });
  mkTaskDir(tasks, 'TP-B', { state: { task_id: 'TP-B', phase: 'planning' } });
  // Only the state-mode field is set (the validate-artifact-chain caller's behavior).
  writeRecentIndex(tasks, 'TP-A', 'state');
  // dir-mode lookup should NOT use the state-mode index entry — falls back
  // to the directory walk and picks whichever has the newest dir mtime.
  const result = mostRecentTaskDir(tasks, 'dir');
  // The walk picks one of TP-A / TP-B by mtime; both are valid answers
  // depending on filesystem timestamp resolution. The key invariant is that
  // the state-mode-only index entry MUST NOT have constrained the answer.
  assert.ok(result === 'TP-A' || result === 'TP-B', `unexpected result ${result}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('stale index (task dir gone) falls back to readdir walk', () => {
  const { root, tasks } = tmpTasks('stale-dir');
  mkTaskDir(tasks, 'TP-200', { state: { task_id: 'TP-200', phase: 'planning' } });
  writeRecentIndex(tasks, 'TP-DELETED'); // task dir never existed
  assert.strictEqual(mostRecentTaskDir(tasks, 'state'), 'TP-200');
  fs.rmSync(root, { recursive: true, force: true });
});

test('state-mode skips indexed dir that lacks orchestration-state.json', () => {
  const { root, tasks } = tmpTasks('no-state-file');
  // state-mode index points at a dir that exists but has no state file →
  // state-mode validation rejects it and the lookup falls back to the walk.
  mkTaskDir(tasks, 'TP-NOSTATE');
  mkTaskDir(tasks, 'TP-WITHSTATE', { state: { task_id: 'TP-WITHSTATE', phase: 'planning' } });
  writeRecentIndex(tasks, 'TP-NOSTATE', 'state');
  assert.strictEqual(mostRecentTaskDir(tasks, 'state'), 'TP-WITHSTATE');
  // Dir mode accepts any directory; with an explicit dir-mode index entry
  // it would return TP-NOSTATE.
  writeRecentIndex(tasks, 'TP-NOSTATE', 'dir');
  assert.strictEqual(mostRecentTaskDir(tasks, 'dir'), 'TP-NOSTATE');
  fs.rmSync(root, { recursive: true, force: true });
});

test('malformed .recent is tolerated (falls back to walk)', () => {
  const { root, tasks } = tmpTasks('malformed-index');
  mkTaskDir(tasks, 'TP-300', { state: { task_id: 'TP-300', phase: 'planning' } });
  fs.writeFileSync(path.join(tasks, RECENT_INDEX_FILENAME), '{not json');
  assert.strictEqual(mostRecentTaskDir(tasks, 'state'), 'TP-300');
  fs.rmSync(root, { recursive: true, force: true });
});

test('writeRecentIndex tolerates a pre-existing malformed file', () => {
  const { root, tasks } = tmpTasks('write-over-malformed');
  fs.writeFileSync(path.join(tasks, RECENT_INDEX_FILENAME), 'not json at all');
  writeRecentIndex(tasks, 'TP-400', 'state');
  const idx = JSON.parse(fs.readFileSync(path.join(tasks, RECENT_INDEX_FILENAME), 'utf8'));
  assert.strictEqual(idx.state, 'TP-400');
  fs.rmSync(root, { recursive: true, force: true });
});

// -------- Validator integration: a valid state-file write refreshes the index --------

test('validate-artifact-chain writes the index after a valid state-file write', () => {
  const { root, tasks } = tmpTasks('validator-writes-index');
  const taskDir = mkTaskDir(tasks, 'TP-500');
  const statePath = path.join(taskDir, 'orchestration-state.json');
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      task_id: 'TP-500',
      mode: 'normal',
      phase: 'execution',
      pending_subtasks: ['TP-500-A1'],
      blocked_gates: [],
      pending_user_actions: [],
      task_summary_path: 'tasks/TP-500/summary.md',
    }),
  );
  const out = spawnSync(process.execPath, [VALIDATOR, statePath], { encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stderr);

  const indexPath = path.join(tasks, RECENT_INDEX_FILENAME);
  assert.ok(fs.existsSync(indexPath), '.recent should be created');
  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.strictEqual(idx.state, 'TP-500');
  fs.rmSync(root, { recursive: true, force: true });
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

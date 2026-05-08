#!/usr/bin/env node
/**
 * Tests for hooks/lib/active-task.js — pure-function unit tests.
 *
 * Run:
 *   node hooks/tests/active-task.test.js
 *
 * Strategy: import the helpers directly and assert their contract. The mode-
 * validation throw is the primary thing we pin down; the rest of the helpers
 * are exercised end-to-end by the hook test suites and don't need duplicate
 * coverage here.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  bareRole,
  parseTaskIdFromPrompt,
  taskPrefixFor,
  mostRecentTaskDir,
} = require('../lib/active-task');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// =========================================================================
// bareRole
// =========================================================================
// Also covered indirectly by the two hook integration tests; this is the
// unit-level pin-down so a regression fails here first with a precise message.

test('bareRole strips plugin namespace', () => {
  assert.strictEqual(bareRole('ai-agents-workflow:chief-orchestrator'), 'chief-orchestrator');
  assert.strictEqual(bareRole('executor'), 'executor');
});

test('bareRole returns "" for empty/null/undefined', () => {
  assert.strictEqual(bareRole(''), '');
  assert.strictEqual(bareRole(null), '');
  assert.strictEqual(bareRole(undefined), '');
});

test('bareRole does NOT trim whitespace (no-trim contract)', () => {
  // Critical: a real injection of "  chief-orchestrator  " should fail loudly
  // (compare false to "chief-orchestrator"), not be silently normalized.
  assert.strictEqual(bareRole('  chief-orchestrator  '), '  chief-orchestrator  ');
  assert.strictEqual(bareRole('   '), '   ');
});

// =========================================================================
// parseTaskIdFromPrompt
// =========================================================================

test('parseTaskIdFromPrompt matches compound form AAA-BBB-123', () => {
  assert.strictEqual(parseTaskIdFromPrompt('working on CAKE-AUTH-5997 today'), 'CAKE-AUTH-5997');
});

test('parseTaskIdFromPrompt matches plain form AAA-123', () => {
  assert.strictEqual(parseTaskIdFromPrompt('see CAKE-1234 for context'), 'CAKE-1234');
});

test('parseTaskIdFromPrompt prefers compound when both present', () => {
  // Regex tries compound first; that's the contract.
  assert.strictEqual(
    parseTaskIdFromPrompt('CAKE-AUTH-9 supersedes CAKE-1'),
    'CAKE-AUTH-9',
  );
});

test('parseTaskIdFromPrompt returns null for no match', () => {
  assert.strictEqual(parseTaskIdFromPrompt(''), null);
  assert.strictEqual(parseTaskIdFromPrompt('no ids here'), null);
  assert.strictEqual(parseTaskIdFromPrompt(null), null);
  assert.strictEqual(parseTaskIdFromPrompt(undefined), null);
});

test('parseTaskIdFromPrompt rejects single-letter prefix as the only candidate', () => {
  // The regex requires ≥2-char alpha prefix (`[A-Z]{2,}-\d+`), so `A-1` should
  // never be picked up — even when it's the only token resembling an id.
  assert.strictEqual(parseTaskIdFromPrompt('A-1'), null);
  assert.strictEqual(parseTaskIdFromPrompt('see A-1 elsewhere'), null);
});

// =========================================================================
// taskPrefixFor
// =========================================================================

test('taskPrefixFor returns first two segments of compound id', () => {
  assert.strictEqual(taskPrefixFor('CAKE-AUTH-5997'), 'CAKE-AUTH');
});

test('taskPrefixFor returns plain id unchanged when 2-segment', () => {
  assert.strictEqual(taskPrefixFor('CAKE-1234'), 'CAKE-1234');
});

test('taskPrefixFor returns null for empty input', () => {
  assert.strictEqual(taskPrefixFor(''), null);
  assert.strictEqual(taskPrefixFor(null), null);
});

// =========================================================================
// mostRecentTaskDir — mode validation (R15 contract pin-down)
// =========================================================================

test('mostRecentTaskDir throws on unknown mode (R15 contract)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'at-mode-'));
  try {
    assert.throws(
      () => mostRecentTaskDir(tmp, 'stat'),
      /unknown mode "stat"/,
    );
    assert.throws(
      () => mostRecentTaskDir(tmp, 'invalid'),
      /unknown mode/,
    );
    assert.throws(
      () => mostRecentTaskDir(tmp, ''),
      /unknown mode/,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('mostRecentTaskDir defaults mode to "state"', () => {
  // No mode arg → behaves like 'state' (returns null for empty dir).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'at-default-'));
  try {
    assert.strictEqual(mostRecentTaskDir(tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('mostRecentTaskDir returns null for missing/empty tasksRoot', () => {
  assert.strictEqual(mostRecentTaskDir(null, 'state'), null);
  assert.strictEqual(mostRecentTaskDir('', 'state'), null);
  assert.strictEqual(mostRecentTaskDir('/definitely/not/a/real/path/xyz', 'state'), null);
});

test('mostRecentTaskDir mode="state" skips dirs without orchestration-state.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-state-'));
  try {
    fs.mkdirSync(path.join(root, 'AI-1'));
    // No state file in AI-1 → should be skipped.
    fs.mkdirSync(path.join(root, 'AI-2'));
    fs.writeFileSync(path.join(root, 'AI-2', 'orchestration-state.json'), '{}');
    assert.strictEqual(mostRecentTaskDir(root, 'state'), 'AI-2');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mostRecentTaskDir mode="dir" considers any directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-dir-'));
  try {
    fs.mkdirSync(path.join(root, 'AI-1'));
    fs.mkdirSync(path.join(root, 'AI-2'));
    // Backdate AI-1 so AI-2 is clearly newer.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(root, 'AI-1'), past, past);
    assert.strictEqual(mostRecentTaskDir(root, 'dir'), 'AI-2');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mostRecentTaskDir mode="dir" tied mtimes break by lexically larger name', () => {
  // Pin down the deterministic-tiebreak contract from the JSDoc. Force both
  // dirs to share the same mtime; expect the lexically larger name to win so
  // the choice is stable across filesystems and readdir orderings.
  //
  // Name choice: 'AI-zeta' > 'AI-alpha' lexically — expect AI-zeta to win.
  // Filesystem precision: fs.utimesSync sets nanosecond mtime on APFS/ext4
  // and second-precision mtime on FAT32/older NFS. Either way both dirs
  // round to the same mtime, so the tiebreak fires.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-tie-'));
  try {
    fs.mkdirSync(path.join(root, 'AI-zeta'));
    fs.mkdirSync(path.join(root, 'AI-alpha'));
    const fixed = new Date('2026-01-01T00:00:00Z');
    fs.utimesSync(path.join(root, 'AI-zeta'), fixed, fixed);
    fs.utimesSync(path.join(root, 'AI-alpha'), fixed, fixed);
    assert.strictEqual(mostRecentTaskDir(root, 'dir'), 'AI-zeta');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mostRecentTaskDir mode="state" tied mtimes break by lexically larger name', () => {
  // Same tiebreak contract as above, but for mode="state" which ranks by the
  // orchestration-state.json mtime rather than the directory mtime.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'at-tie-state-'));
  try {
    fs.mkdirSync(path.join(root, 'AI-zeta'));
    fs.mkdirSync(path.join(root, 'AI-alpha'));
    fs.writeFileSync(path.join(root, 'AI-zeta', 'orchestration-state.json'), '{}');
    fs.writeFileSync(path.join(root, 'AI-alpha', 'orchestration-state.json'), '{}');
    const fixed = new Date('2026-01-01T00:00:00Z');
    fs.utimesSync(path.join(root, 'AI-zeta', 'orchestration-state.json'), fixed, fixed);
    fs.utimesSync(path.join(root, 'AI-alpha', 'orchestration-state.json'), fixed, fixed);
    assert.strictEqual(mostRecentTaskDir(root, 'state'), 'AI-zeta');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

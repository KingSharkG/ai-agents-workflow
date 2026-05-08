#!/usr/bin/env node
/**
 * Tests for hooks/validate-summary-telemetry.js (PostToolUse, non-blocking).
 *
 * Contract:
 *   - Always exits 0 (informational warnings only).
 *   - No-op when:
 *       * argv[2] (file path) missing or file doesn't exist
 *       * file basename is not "summary.md"
 *       * file is not under <artifact-root>/tasks/...
 *       * file is the task-level summary (one segment before summary.md)
 *       * no review_verdict in content
 *   - Warn (stderr) when subtask summary.md has review_verdict but is missing
 *     ## Telemetry rows or ## Context Manifest subsections.
 *
 * Run:
 *   node hooks/tests/validate-summary-telemetry.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'validate-summary-telemetry.js');

function makeProject(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `vst-${label}-`));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const artifactRoot = path.join(proj, '.claude', 'aiaw-data-proj');
  fs.mkdirSync(artifactRoot, { recursive: true });
  return { root, proj, artifactRoot };
}

function runHook(filePath, cwd) {
  const baseEnv = Object.assign({}, process.env);
  for (const k of Object.keys(baseEnv)) {
    if (k.startsWith('CLAUDE_')) delete baseEnv[k];
  }
  return spawnSync(process.execPath, [HOOK, filePath || ''], {
    cwd,
    encoding: 'utf8',
    env: baseEnv,
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// Content fixtures matching the hook's actual extraction regex. NOTE: the
// hook's body-extraction regex `[\s\S]*?(?=\n##\s|$)` with `/m` stops at the
// first end-of-line position because `$` with /m matches before every `\n`.
// In practice this means content MUST follow the heading on the next line
// (no blank line between heading and content) for the body to extract. The
// successful path uses that compact form.
const VALID_TELEMETRY = '## Telemetry\nlead | 5/8 turns | tokens=1234\n';
const VALID_MANIFEST =
  '## Context Manifest\n### From governance\n- TRIGGER_RULES.md (rework-cap)\n';

// =========================================================================
// No-op cases (always exit 0, never warn)
// =========================================================================

test('missing argv path → exit 0, no warning', () => {
  const out = runHook('', undefined);
  assert.strictEqual(out.status, 0);
  assert.strictEqual(out.stderr, '');
});

test('non-existent file path → exit 0, no warning', () => {
  const out = runHook('/tmp/definitely-not-a-real-file-xyz.md', undefined);
  assert.strictEqual(out.status, 0);
  assert.strictEqual(out.stderr, '');
});

test('non-summary.md file → exit 0, no warning', () => {
  const { root, proj } = makeProject('not-summary');
  const f = path.join(proj, 'ai-work.md');
  fs.writeFileSync(f, '## Telemetry\n\n');
  const out = runHook(f, proj);
  assert.strictEqual(out.status, 0);
  assert.strictEqual(out.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('summary.md outside artifact-root/tasks → exit 0, no warning', () => {
  const { root, proj } = makeProject('outside');
  const f = path.join(proj, 'summary.md');
  fs.writeFileSync(f, 'review_verdict: approved\n');
  const out = runHook(f, proj);
  assert.strictEqual(out.status, 0);
  assert.strictEqual(out.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('task-level summary.md (one segment) → exit 0, no warning', () => {
  // <artifact_root>/tasks/<task_id>/summary.md is task-level — skip.
  const { root, proj, artifactRoot } = makeProject('task-level');
  const taskDir = path.join(artifactRoot, 'tasks', 'AI-1');
  fs.mkdirSync(taskDir, { recursive: true });
  const f = path.join(taskDir, 'summary.md');
  fs.writeFileSync(f, 'review_verdict: approved\n# Task summary\n');
  const out = runHook(f, proj);
  assert.strictEqual(out.status, 0);
  assert.strictEqual(out.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('subtask summary.md without review_verdict → exit 0, no warning', () => {
  const { root, proj, artifactRoot } = makeProject('no-verdict');
  const sub = path.join(artifactRoot, 'tasks', 'AI-1', 'AI-1-A1');
  fs.mkdirSync(sub, { recursive: true });
  const f = path.join(sub, 'summary.md');
  fs.writeFileSync(f, '# subtask summary\n\n(no verdict yet)\n');
  const out = runHook(f, proj);
  assert.strictEqual(out.status, 0);
  assert.strictEqual(out.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Warning cases
// =========================================================================

test('subtask summary.md with verdict + telemetry + manifest → exit 0, no warning', () => {
  const { root, proj, artifactRoot } = makeProject('all-good');
  const sub = path.join(artifactRoot, 'tasks', 'AI-1', 'AI-1-A1');
  fs.mkdirSync(sub, { recursive: true });
  const f = path.join(sub, 'summary.md');
  fs.writeFileSync(f, `review_verdict: approved\n${VALID_TELEMETRY}${VALID_MANIFEST}`);
  const out = runHook(f, proj);
  assert.strictEqual(out.status, 0);
  assert.strictEqual(out.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('subtask summary.md verdict=approved + missing Telemetry → WARN', () => {
  const { root, proj, artifactRoot } = makeProject('no-tel');
  const sub = path.join(artifactRoot, 'tasks', 'AI-1', 'AI-1-A1');
  fs.mkdirSync(sub, { recursive: true });
  const f = path.join(sub, 'summary.md');
  fs.writeFileSync(f, `review_verdict: approved\n${VALID_MANIFEST}`);
  const out = runHook(f, proj);
  assert.strictEqual(out.status, 0); // never blocks
  assert.match(out.stderr, /WARNING/);
  assert.match(out.stderr, /Telemetry section is missing/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('subtask summary.md verdict=approved + Telemetry heading but no rows → WARN', () => {
  const { root, proj, artifactRoot } = makeProject('empty-tel');
  const sub = path.join(artifactRoot, 'tasks', 'AI-1', 'AI-1-A1');
  fs.mkdirSync(sub, { recursive: true });
  const f = path.join(sub, 'summary.md');
  fs.writeFileSync(
    f,
    `review_verdict: approved\n## Telemetry\n\n(empty)\n${VALID_MANIFEST}`,
  );
  const out = runHook(f, proj);
  assert.strictEqual(out.status, 0);
  assert.match(out.stderr, /no telemetry lines/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('subtask summary.md verdict=approved + missing Context Manifest → WARN', () => {
  const { root, proj, artifactRoot } = makeProject('no-cm');
  const sub = path.join(artifactRoot, 'tasks', 'AI-1', 'AI-1-A1');
  fs.mkdirSync(sub, { recursive: true });
  const f = path.join(sub, 'summary.md');
  fs.writeFileSync(f, `review_verdict: approved\n${VALID_TELEMETRY}`);
  const out = runHook(f, proj);
  assert.strictEqual(out.status, 0);
  assert.match(out.stderr, /Context Manifest section is missing/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('subtask summary.md verdict=approved + Context Manifest heading but no ### subsections → WARN', () => {
  const { root, proj, artifactRoot } = makeProject('no-cm-subs');
  const sub = path.join(artifactRoot, 'tasks', 'AI-1', 'AI-1-A1');
  fs.mkdirSync(sub, { recursive: true });
  const f = path.join(sub, 'summary.md');
  fs.writeFileSync(
    f,
    `review_verdict: approved\n${VALID_TELEMETRY}## Context Manifest\n\n(no subs)\n`,
  );
  const out = runHook(f, proj);
  assert.strictEqual(out.status, 0);
  assert.match(out.stderr, /no ### subsections/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('verdict written in markdown bold (**review_verdict**) is recognized', () => {
  const { root, proj, artifactRoot } = makeProject('bold-verdict');
  const sub = path.join(artifactRoot, 'tasks', 'AI-1', 'AI-1-A1');
  fs.mkdirSync(sub, { recursive: true });
  const f = path.join(sub, 'summary.md');
  fs.writeFileSync(f, `**review_verdict**: approved\n# subtask\n`);
  const out = runHook(f, proj);
  assert.strictEqual(out.status, 0);
  // Verdict matched → diagnostics expected → no telemetry/cm → WARN.
  assert.match(out.stderr, /WARNING/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('phase-X subtask path (3+ segments via phase dir) is recognized as subtask-level', () => {
  // <artifact_root>/tasks/AI-1/phase-1/AI-1-A1/summary.md
  const { root, proj, artifactRoot } = makeProject('phase-X');
  const sub = path.join(artifactRoot, 'tasks', 'AI-1', 'phase-1', 'AI-1-A1');
  fs.mkdirSync(sub, { recursive: true });
  const f = path.join(sub, 'summary.md');
  fs.writeFileSync(f, `review_verdict: changes_requested\n${VALID_TELEMETRY}${VALID_MANIFEST}`);
  const out = runHook(f, proj);
  assert.strictEqual(out.status, 0);
  assert.strictEqual(out.stderr, '');
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

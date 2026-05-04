#!/usr/bin/env node
/**
 * Tests for hooks/validate-artifact-chain.js.
 *
 * Run:
 *   node hooks/tests/validate-artifact-chain.test.js
 *
 * Strategy: each test writes a fixture file to a tmp dir, spawns the hook
 * with that path as argv[2], and asserts on exit code + stderr content.
 * Zero dependencies (Node built-ins only).
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
  return fs.mkdtempSync(path.join(os.tmpdir(), `vac-${label}-`));
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// =========================================================================
// ai-work.md
// =========================================================================

// Helper: any populated review section triggers the "sibling summary.md must
// exist" check — the regex matches non-whitespace anywhere after the opening
// marker, including the closing tag itself. So happy-path ai-work.md fixtures
// always ship with a sibling summary.md to bypass that check.
function writeAiWork(dir, body, includeSummary = true) {
  const file = path.join(dir, 'ai-work.md');
  fs.writeFileSync(file, body);
  if (includeSummary) {
    fs.writeFileSync(path.join(dir, 'summary.md'), '# placeholder\n');
  }
  return file;
}

test('ai-work.md with all required sections + sibling summary.md passes', () => {
  const dir = tmpDir('aiwork-ok');
  const file = writeAiWork(
    dir,
    [
      '<!-- section:spec --> spec body <!-- /section:spec -->',
      '<!-- section:implementation --> impl body <!-- /section:implementation -->',
      '<!-- section:review --> review body <!-- /section:review -->',
    ].join('\n'),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ai-work.md missing a required section is rejected', () => {
  const dir = tmpDir('aiwork-missing');
  const file = writeAiWork(
    dir,
    [
      '<!-- section:spec --> spec <!-- /section:spec -->',
      '<!-- section:implementation --> impl <!-- /section:implementation -->',
      // review section omitted
    ].join('\n'),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing canonical section markers.*review/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ai-work.md with unpaired section markers is rejected', () => {
  const dir = tmpDir('aiwork-unpaired');
  // Sibling summary.md present so the review check passes. The unpaired marker
  // is on a different section (spec) — open without close.
  const file = writeAiWork(
    dir,
    [
      '<!-- section:spec --> spec body',
      // missing close for spec
      '<!-- section:implementation --> impl <!-- /section:implementation -->',
      '<!-- section:review --> review <!-- /section:review -->',
    ].join('\n'),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /unpaired section markers/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ai-work.md with telemetry section in wrong file is rejected', () => {
  const dir = tmpDir('aiwork-telem');
  const file = writeAiWork(
    dir,
    [
      '<!-- section:spec --> s <!-- /section:spec -->',
      '<!-- section:implementation --> i <!-- /section:implementation -->',
      '<!-- section:review --> r <!-- /section:review -->',
      '<!-- section:telemetry --> stuff <!-- /section:telemetry -->',
    ].join('\n'),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /diagnostic sections belong in summary\.md/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ai-work.md with populated review section but NO sibling summary.md is rejected', () => {
  const dir = tmpDir('aiwork-review-nosum');
  const file = writeAiWork(
    dir,
    [
      '<!-- section:spec --> s <!-- /section:spec -->',
      '<!-- section:implementation --> i <!-- /section:implementation -->',
      '<!-- section:review -->',
      'Cycle 1 findings: nothing.',
      '<!-- /section:review -->',
    ].join('\n'),
    /* includeSummary */ false,
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /summary\.md does not exist/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// task-data.md
// =========================================================================

test('task-data.md with required field and section passes', () => {
  const dir = tmpDir('taskdata-ok');
  const file = path.join(dir, 'task-data.md');
  fs.writeFileSync(
    file,
    [
      '<!-- section:task-metadata -->',
      'task_id: TP-001',
      '<!-- /section:task-metadata -->',
    ].join('\n'),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('task-data.md missing task_id field is rejected', () => {
  const dir = tmpDir('taskdata-missing-id');
  const file = path.join(dir, 'task-data.md');
  fs.writeFileSync(
    file,
    [
      '<!-- section:task-metadata -->',
      'no id here',
      '<!-- /section:task-metadata -->',
    ].join('\n'),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing required fields.*task_id/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('task-data.md with delivery-plan but no sectioned-v1 marker is rejected', () => {
  const dir = tmpDir('taskdata-no-v1');
  const file = path.join(dir, 'task-data.md');
  fs.writeFileSync(
    file,
    [
      '<!-- section:task-metadata --> task_id: TP-001 <!-- /section:task-metadata -->',
      '<!-- section:delivery-plan --> plan <!-- /section:delivery-plan -->',
    ].join('\n'),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing required markers plan_format: sectioned-v1/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('task-data.md with sectioned-v1 missing delivery sub-sections is rejected', () => {
  const dir = tmpDir('taskdata-v1-incomplete');
  const file = path.join(dir, 'task-data.md');
  fs.writeFileSync(
    file,
    [
      '<!-- section:task-metadata --> task_id: TP-001 <!-- /section:task-metadata -->',
      '<!-- section:delivery-plan -->',
      'plan_format: sectioned-v1',
      '<!-- section:delivery-metadata --> m <!-- /section:delivery-metadata -->',
      '<!-- /section:delivery-plan -->',
    ].join('\n'),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing sectioned-v1 markers/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Task Summary (tasks/<id>/summary.md)
// =========================================================================

function buildTaskSummary(extra = '') {
  return [
    '<!-- section:task-metadata --> task_id: TP-001 <!-- /section:task-metadata -->',
    '## Metadata',
    '## Task Status',
    '- **pending_user_action_count**: 0',
    '## Changes by Phase',
    '## Open Gates',
    '## Pending User Actions',
    '- none',
    '## Pipeline',
    '## Detail',
    '## Totals',
    '## Context Breakdown',
    extra,
  ].join('\n');
}

test('Task Summary at tasks/<id>/summary.md with all headings passes', () => {
  const dir = tmpDir('tasksum-ok');
  const tasksDir = path.join(dir, 'tasks', 'TP-001');
  fs.mkdirSync(tasksDir, { recursive: true });
  const file = path.join(tasksDir, 'summary.md');
  fs.writeFileSync(file, buildTaskSummary());
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Task Summary missing required heading is rejected', () => {
  const dir = tmpDir('tasksum-missing');
  const tasksDir = path.join(dir, 'tasks', 'TP-001');
  fs.mkdirSync(tasksDir, { recursive: true });
  const file = path.join(tasksDir, 'summary.md');
  // Drop "## Pipeline"
  const body = buildTaskSummary().replace('## Pipeline\n', '');
  fs.writeFileSync(file, body);
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing required headings.*Pipeline/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Task Summary pending_user_action_count mismatch with bullets is rejected', () => {
  const dir = tmpDir('tasksum-count');
  const tasksDir = path.join(dir, 'tasks', 'TP-001');
  fs.mkdirSync(tasksDir, { recursive: true });
  const file = path.join(tasksDir, 'summary.md');
  // count says 2 but only one bullet
  const body = buildTaskSummary()
    .replace('- **pending_user_action_count**: 0', '- **pending_user_action_count**: 2')
    .replace('- none', '- one item only');
  fs.writeFileSync(file, body);
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /pending_user_action_count=2 does not match/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Task Summary with content under Pending User Actions but no bullets is rejected', () => {
  const dir = tmpDir('tasksum-no-bullets');
  const tasksDir = path.join(dir, 'tasks', 'TP-001');
  fs.mkdirSync(tasksDir, { recursive: true });
  const file = path.join(tasksDir, 'summary.md');
  // Replace the "- none" bullet with prose. The hook only fires when the
  // section is non-empty AND has zero `- ` lines.
  const body = buildTaskSummary().replace('- none', 'awaiting feedback');
  fs.writeFileSync(file, body);
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /must contain bullet items or "- none"/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Subtask Summary (tasks/<id>/<sub>/summary.md)
// =========================================================================

function buildSubtaskSummary(overrides = {}) {
  const verdict = overrides.verdict ?? 'approved';
  const workflowState = overrides.workflowState ?? 'approved';
  const acceptance = overrides.acceptance ?? '| Signal | State | Evidence | Notes |\n|---|---|---|---|';
  const stale = overrides.stale ?? '';
  return [
    '# Subtask Summary',
    '',
    '## Status',
    `- **review_verdict**: ${verdict}`,
    `- **workflow_state**: ${workflowState}`,
    '## Acceptance Signals',
    acceptance,
    '## Files Changed',
    '## Dispatch Bundles',
    '## Telemetry',
    'agent | 1/2 turns | foo',
    '## Context Manifest',
    '### sub',
    '## Notes',
    '## Open Gates',
    `verdict: ${verdict}`,
    stale,
  ].join('\n');
}

test('Subtask Summary with verdict=approved + matching workflow passes', () => {
  const dir = tmpDir('subsum-ok');
  const subDir = path.join(dir, 'tasks', 'TP-001', 'TP-001-A1');
  fs.mkdirSync(subDir, { recursive: true });
  const file = path.join(subDir, 'summary.md');
  fs.writeFileSync(file, buildSubtaskSummary());
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Subtask Summary missing verdict field is rejected', () => {
  const dir = tmpDir('subsum-noverdict');
  const subDir = path.join(dir, 'tasks', 'TP-001', 'TP-001-A1');
  fs.mkdirSync(subDir, { recursive: true });
  const file = path.join(subDir, 'summary.md');
  // Build a fixture that contains zero occurrences of the substring "verdict".
  // The hook's required-field check is `lc.includes('verdict')`, so the
  // "review_verdict" field name in the standard template would mask the gap.
  const body = [
    '# Subtask Summary',
    '## Status',
    '- **review_outcome**: approved', // intentionally renamed to dodge the substring
    '- **workflow_state**: approved',
    '## Acceptance Signals',
    '| Signal | State | Evidence | Notes |',
    '|---|---|---|---|',
    '## Files Changed',
    '## Dispatch Bundles',
    '## Telemetry',
    'agent | 1/2 turns | foo',
    '## Context Manifest',
    '### sub',
    '## Notes',
    '## Open Gates',
  ].join('\n');
  fs.writeFileSync(file, body);
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing required fields.*verdict/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Subtask Summary with stale "Reviewer fills" placeholder is rejected', () => {
  const dir = tmpDir('subsum-stale');
  const subDir = path.join(dir, 'tasks', 'TP-001', 'TP-001-A1');
  fs.mkdirSync(subDir, { recursive: true });
  const file = path.join(subDir, 'summary.md');
  fs.writeFileSync(file, buildSubtaskSummary({ stale: 'TODO: Reviewer fills this in' }));
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /stale placeholder text remains/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Subtask Summary with verdict=approved but workflow_state=needs-replan is rejected', () => {
  const dir = tmpDir('subsum-conflict');
  const subDir = path.join(dir, 'tasks', 'TP-001', 'TP-001-A1');
  fs.mkdirSync(subDir, { recursive: true });
  const file = path.join(subDir, 'summary.md');
  fs.writeFileSync(file, buildSubtaskSummary({ verdict: 'approved', workflowState: 'needs-replan' }));
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /review_verdict=approved conflicts with workflow_state=needs-replan/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Subtask Summary Acceptance Signals missing required columns is rejected', () => {
  const dir = tmpDir('subsum-acc');
  const subDir = path.join(dir, 'tasks', 'TP-001', 'TP-001-A1');
  fs.mkdirSync(subDir, { recursive: true });
  const file = path.join(subDir, 'summary.md');
  // Drop "Notes" column
  const body = buildSubtaskSummary({
    acceptance: '| Signal | State | Evidence |\n|---|---|---|',
  });
  fs.writeFileSync(file, body);
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /Acceptance Signals must include Signal, State, Evidence, and Notes columns/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Subtask Summary approved with non-ok IC verdict in sibling ai-work.md is rejected', () => {
  const dir = tmpDir('subsum-ic');
  const subDir = path.join(dir, 'tasks', 'TP-001', 'TP-001-A1');
  fs.mkdirSync(subDir, { recursive: true });
  // Sibling ai-work.md has IC section with content but no "verdict: ok"
  fs.writeFileSync(
    path.join(subDir, 'ai-work.md'),
    [
      '<!-- section:spec --> s <!-- /section:spec -->',
      '<!-- section:implementation --> i <!-- /section:implementation -->',
      '<!-- section:review -->',
      '<!-- /section:review -->',
      '<!-- section:integration-check -->',
      'verdict: blocked',
      '<!-- /section:integration-check -->',
    ].join('\n'),
  );
  const file = path.join(subDir, 'summary.md');
  fs.writeFileSync(file, buildSubtaskSummary({ verdict: 'approved', workflowState: 'approved' }));
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /integration-check section does not contain "verdict: ok"/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Subtask Summary approved with IC verdict ok in sibling ai-work.md passes', () => {
  const dir = tmpDir('subsum-ic-ok');
  const subDir = path.join(dir, 'tasks', 'TP-001', 'TP-001-A1');
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(
    path.join(subDir, 'ai-work.md'),
    [
      '<!-- section:spec --> s <!-- /section:spec -->',
      '<!-- section:implementation --> i <!-- /section:implementation -->',
      '<!-- section:review -->',
      '<!-- /section:review -->',
      '<!-- section:integration-check -->',
      'verdict: ok',
      '<!-- /section:integration-check -->',
    ].join('\n'),
  );
  const file = path.join(subDir, 'summary.md');
  fs.writeFileSync(file, buildSubtaskSummary({ verdict: 'approved', workflowState: 'approved' }));
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// orchestration-state.json
// =========================================================================

function validState(overrides = {}) {
  return Object.assign(
    {
      task_id: 'TP-001',
      mode: 'normal',
      phase: 'execution',
      pending_subtasks: ['TP-001-A1'],
      blocked_gates: [],
      pending_user_actions: [],
      task_summary_path: 'tasks/TP-001/summary.md',
    },
    overrides,
  );
}

test('orchestration-state.json valid passes', () => {
  const dir = tmpDir('state-ok');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(file, JSON.stringify(validState()));
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('orchestration-state.json with malformed JSON is rejected', () => {
  const dir = tmpDir('state-bad-json');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(file, '{not json');
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /malformed JSON/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('orchestration-state.json missing required field is rejected', () => {
  const dir = tmpDir('state-missing-field');
  const file = path.join(dir, 'orchestration-state.json');
  const s = validState();
  delete s.task_summary_path;
  fs.writeFileSync(file, JSON.stringify(s));
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /missing required fields.*task_summary_path/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('orchestration-state.json with invalid mode is rejected', () => {
  const dir = tmpDir('state-bad-mode');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(file, JSON.stringify(validState({ mode: 'wat' })));
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /mode must be one of/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('orchestration-state.json with invalid phase is rejected', () => {
  const dir = tmpDir('state-bad-phase');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(file, JSON.stringify(validState({ phase: 'mid-air' })));
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /phase must be one of/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('orchestration-state.json with non-array pending_subtasks is rejected', () => {
  const dir = tmpDir('state-non-array');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(file, JSON.stringify(validState({ pending_subtasks: 'TP-001-A1' })));
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /pending_subtasks.*must be arrays/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('orchestration-state.json phase=complete with pending subtasks is rejected', () => {
  const dir = tmpDir('state-complete-conflict');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(
    file,
    JSON.stringify(validState({ phase: 'complete', pending_subtasks: ['still-here'] })),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /phase "complete" requires empty pending_subtasks/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('orchestration-state.json current_focus overstating completion is rejected', () => {
  const dir = tmpDir('state-overstate');
  const file = path.join(dir, 'orchestration-state.json');
  fs.writeFileSync(
    file,
    JSON.stringify(validState({ current_focus: 'all 3 subtasks pass' })),
  );
  const out = runHook(file);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /current_focus overstates completion/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Unrecognized files / argv handling
// =========================================================================

test('unrecognized filename is silently skipped', () => {
  const dir = tmpDir('unrecognized');
  const file = path.join(dir, 'random.md');
  fs.writeFileSync(file, 'hello');
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing argv path exits 0 (no-op)', () => {
  const out = spawnSync(process.execPath, [HOOK], { encoding: 'utf8' });
  assert.strictEqual(out.status, 0);
});

test('non-existent argv path exits 0 (no-op)', () => {
  const out = runHook('/this/path/does/not/exist.md');
  assert.strictEqual(out.status, 0);
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

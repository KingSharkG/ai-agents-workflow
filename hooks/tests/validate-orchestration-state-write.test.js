#!/usr/bin/env node
/**
 * Tests for hooks/validate-orchestration-state-write.js (PostToolUse, non-blocking).
 *
 * Contract:
 *   - Always exits 0 (informational warnings only).
 *   - No-op when:
 *       * argv[2] missing or file doesn't exist
 *       * file basename is not "orchestration-state.json"
 *       * file is not under <artifact-root>/tasks/
 *   - Warn (stderr) on schema violations: bad JSON, missing required fields,
 *     bad enum values, malformed stage_history entries.
 *
 * Run:
 *   node hooks/tests/validate-orchestration-state-write.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'validate-orchestration-state-write.js');

function makeProject(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `vos-${label}-`));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const artifactRoot = path.join(proj, '.claude', 'aiaw-data-proj');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const tasksDir = path.join(artifactRoot, 'tasks', 'TP-001');
  fs.mkdirSync(tasksDir, { recursive: true });
  return { root, proj, artifactRoot, tasksDir };
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

function validV3State(overrides) {
  return Object.assign(
    {
      task_id: 'TP-001',
      schema_version: 3,
      phase: 'execution',
      stage: 'execution',
      previous_stage: 'planning',
      stage_history: [
        {
          stage: 'intake',
          entered_at: '2026-05-11T10:00:00Z',
          exited_at: '2026-05-11T10:05:00Z',
          exit_reason: 'classified',
        },
        {
          stage: 'planning',
          entered_at: '2026-05-11T10:05:00Z',
          exited_at: '2026-05-11T10:10:00Z',
          exit_reason: 'p1-approved-execute',
        },
        {
          stage: 'execution',
          entered_at: '2026-05-11T10:10:00Z',
          exited_at: null,
          exit_reason: null,
        },
      ],
      stage_reopen_count: 0,
      pending_subtasks_needing_rereview: [],
      gates: {
        p1_approved: true,
        p1_approved_signature: 'abc123',
        p1_revise_count: 0,
      },
    },
    overrides || {},
  );
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('missing argv path → exit 0, no warning', () => {
  const r = runHook('', process.cwd());
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, '');
});

test('non-existent file path → exit 0, no warning', () => {
  const r = runHook('/nonexistent/path/orchestration-state.json', process.cwd());
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, '');
});

test('non-state-file basename → exit 0, no warning', () => {
  const { proj, tasksDir, root } = makeProject('skip-name');
  const f = path.join(tasksDir, 'summary.md');
  fs.writeFileSync(f, '# whatever');
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0, `stderr=${r.stderr}`);
  assert.strictEqual(r.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('file outside artifact-root → exit 0, no warning', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vos-outside-'));
  const f = path.join(tmp, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State()));
  const r = runHook(f, process.cwd());
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, '');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('valid v3 state → exit 0, no warning', () => {
  const { proj, tasksDir, root } = makeProject('valid-v3');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State()));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0, `stderr=${r.stderr}`);
  assert.strictEqual(r.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('malformed JSON → exit 0 with WARN', () => {
  const { proj, tasksDir, root } = makeProject('bad-json');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, '{not-valid-json');
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /not valid JSON/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('top-level array → WARN', () => {
  const { proj, tasksDir, root } = makeProject('array-top');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, '[]');
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /must be an object/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('missing task_id → WARN', () => {
  const { proj, tasksDir, root } = makeProject('no-taskid');
  const f = path.join(tasksDir, 'orchestration-state.json');
  const s = validV3State();
  delete s.task_id;
  fs.writeFileSync(f, JSON.stringify(s));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /task_id/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('unknown schema_version → WARN', () => {
  const { proj, tasksDir, root } = makeProject('bad-sv');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State({ schema_version: 99 })));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /schema_version/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bad phase enum → WARN', () => {
  const { proj, tasksDir, root } = makeProject('bad-phase');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State({ phase: 'on-fire' })));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /phase/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bad stage enum (v3) → WARN', () => {
  const { proj, tasksDir, root } = makeProject('bad-stage');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State({ stage: 'lunchtime' })));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /stage/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('half-open stage_history entry → WARN', () => {
  const { proj, tasksDir, root } = makeProject('half-open');
  const f = path.join(tasksDir, 'orchestration-state.json');
  const s = validV3State();
  s.stage_history[0].exited_at = '2026-05-11T10:05:00Z';
  s.stage_history[0].exit_reason = null;
  fs.writeFileSync(f, JSON.stringify(s));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /half-open/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('non-array stage_history → WARN', () => {
  const { proj, tasksDir, root } = makeProject('sh-not-array');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State({ stage_history: 'oops' })));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /stage_history.*array/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('negative stage_reopen_count → WARN', () => {
  const { proj, tasksDir, root } = makeProject('neg-reopen');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State({ stage_reopen_count: -1 })));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /stage_reopen_count/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('gates.p1_approved non-boolean → WARN', () => {
  const { proj, tasksDir, root } = makeProject('bad-p1');
  const f = path.join(tasksDir, 'orchestration-state.json');
  const s = validV3State();
  s.gates.p1_approved = 'yes';
  fs.writeFileSync(f, JSON.stringify(s));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /p1_approved.*boolean/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('invalid stage transition (execution → planned via stage_history) → WARN', () => {
  // stage_history with two consecutive entries forming a forbidden transition.
  const { proj, tasksDir, root } = makeProject('bad-transition');
  const f = path.join(tasksDir, 'orchestration-state.json');
  const s = validV3State({
    stage_history: [
      {
        stage: 'execution',
        entered_at: '2026-05-11T10:00:00Z',
        exited_at: '2026-05-11T10:05:00Z',
        exit_reason: 'all-subtasks-approved',
      },
      {
        // execution → closure is valid; we want INVALID.
        // closure → planning is explicitly listed as invalid in stage-discipline.md.
        stage: 'closure',
        entered_at: '2026-05-11T10:05:00Z',
        exited_at: '2026-05-11T10:10:00Z',
        exit_reason: 'reversal',
      },
      {
        stage: 'planning',
        entered_at: '2026-05-11T10:10:00Z',
        exited_at: null,
        exit_reason: null,
      },
    ],
    stage: 'planning',
    previous_stage: 'closure',
  });
  fs.writeFileSync(f, JSON.stringify(s));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /invalid stage transition/);
  assert.match(r.stderr, /closure → planning/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('valid reopen transition (execution → planning) → no transition warning', () => {
  const { proj, tasksDir, root } = makeProject('valid-reopen');
  const f = path.join(tasksDir, 'orchestration-state.json');
  const s = validV3State({
    stage_history: [
      {
        stage: 'intake',
        entered_at: '2026-05-11T10:00:00Z',
        exited_at: '2026-05-11T10:01:00Z',
        exit_reason: 'classified',
      },
      {
        stage: 'planning',
        entered_at: '2026-05-11T10:01:00Z',
        exited_at: '2026-05-11T10:02:00Z',
        exit_reason: 'p1-approved-execute',
      },
      {
        stage: 'execution',
        entered_at: '2026-05-11T10:02:00Z',
        exited_at: '2026-05-11T10:05:00Z',
        exit_reason: 'needs-replan',
      },
      {
        // Soft reopen: execution → planning is valid.
        stage: 'planning',
        entered_at: '2026-05-11T10:05:00Z',
        exited_at: null,
        exit_reason: null,
      },
    ],
    stage: 'planning',
    previous_stage: 'execution',
    stage_reopen_count: 1,
  });
  fs.writeFileSync(f, JSON.stringify(s));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0, `stderr=${r.stderr}`);
  assert.strictEqual(r.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('hooks.log line is appended on WARN', () => {
  const { proj, tasksDir, root } = makeProject('log-on-warn');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State({ phase: 'broken-phase' })));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  const logPath = path.join(tasksDir, 'hooks.log');
  assert.ok(fs.existsSync(logPath), 'hooks.log should exist after a WARN');
  const log = fs.readFileSync(logPath, 'utf8');
  assert.match(log, /validate-orchestration-state-write \| warn \| /);
  assert.match(log, /broken-phase/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('hooks.log NOT appended on valid state', () => {
  const { proj, tasksDir, root } = makeProject('no-log-clean');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State()));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  const logPath = path.join(tasksDir, 'hooks.log');
  assert.ok(!fs.existsSync(logPath), 'hooks.log should NOT exist when no WARN fires');
  fs.rmSync(root, { recursive: true, force: true });
});

test('task_id parity mismatch with sibling history file → WARN', () => {
  const { proj, tasksDir, root } = makeProject('parity-mismatch');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State({ task_id: 'TP-001' })));
  // Sibling history file with a DIFFERENT task_id — simulates copy-from-other-task corruption.
  fs.writeFileSync(
    path.join(tasksDir, 'orchestration-history.json'),
    JSON.stringify({ task_id: 'TP-999', completed_subtasks: [] }),
  );
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /task_id parity mismatch/);
  assert.match(r.stderr, /TP-001/);
  assert.match(r.stderr, /TP-999/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('task_id parity match with sibling history file → no warning', () => {
  const { proj, tasksDir, root } = makeProject('parity-match');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State({ task_id: 'TP-001' })));
  fs.writeFileSync(
    path.join(tasksDir, 'orchestration-history.json'),
    JSON.stringify({ task_id: 'TP-001', completed_subtasks: [] }),
  );
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0, `stderr=${r.stderr}`);
  assert.strictEqual(r.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('absent sibling history file → no parity warning', () => {
  const { proj, tasksDir, root } = makeProject('no-history');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State()));
  // No history file written — should not WARN on parity.
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('malformed history file → no parity warning (graceful)', () => {
  const { proj, tasksDir, root } = makeProject('bad-history');
  const f = path.join(tasksDir, 'orchestration-state.json');
  fs.writeFileSync(f, JSON.stringify(validV3State()));
  fs.writeFileSync(path.join(tasksDir, 'orchestration-history.json'), '{garbage');
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0);
  // Should not WARN on the parity branch — malformed history is silently skipped.
  // (Other validation may still WARN if state itself is malformed; here it isn't.)
  assert.doesNotMatch(r.stderr, /task_id parity/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('v2 state (no stage fields required) → no warning', () => {
  const { proj, tasksDir, root } = makeProject('v2-ok');
  const f = path.join(tasksDir, 'orchestration-state.json');
  const v2 = {
    task_id: 'TP-001',
    schema_version: 2,
    phase: 'execution',
    gates: { p1_approved: true, p1_revise_count: 0 },
  };
  fs.writeFileSync(f, JSON.stringify(v2));
  const r = runHook(f, proj);
  assert.strictEqual(r.status, 0, `stderr=${r.stderr}`);
  assert.strictEqual(r.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

// Run.
let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    process.stdout.write(`ok  ${t.name}\n`);
    passed++;
  } catch (e) {
    process.stdout.write(`FAIL  ${t.name}\n`);
    process.stderr.write(`  ${e.message}\n`);
    failed++;
  }
}

process.stdout.write(`\n${passed} passed, ${failed} failed (${tests.length} total)\n`);
process.exit(failed === 0 ? 0 : 1);

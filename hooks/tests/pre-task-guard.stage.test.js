#!/usr/bin/env node
/**
 * Tests for hooks/pre-task-guard.js Phase 3.5 — stage guard.
 *
 * Run:
 *   node hooks/tests/pre-task-guard.stage.test.js
 *
 * Strategy mirrors pre-task-guard.test.js: build a tmpdir scaffold with a
 * v3 orchestration-state.json containing a `stage` field, spawn the hook
 * with the right CLAUDE_TOOL_INPUT_* env, and assert exit code + stderr.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'pre-task-guard.js');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

function makeProject(label, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ptg-stage-${label}-`));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const artifactRoot = path.join(proj, '.claude', 'aiaw-data-proj');
  fs.mkdirSync(artifactRoot, { recursive: true });

  if (opts.taskId) {
    const taskDir = path.join(artifactRoot, 'tasks', opts.taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    if (opts.state !== undefined) {
      fs.writeFileSync(
        path.join(taskDir, 'orchestration-state.json'),
        JSON.stringify(opts.state),
      );
    }
    if (opts.subtaskId) {
      const subDir = path.join(taskDir, opts.subtaskId);
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'ai-work.md'), '# skeleton\n');
      fs.writeFileSync(path.join(subDir, 'summary.md'), '# summary skeleton\n');
    }
  }
  return { root, proj, artifactRoot };
}

function v3State(extras = {}) {
  return Object.assign(
    {
      schema_version: 3,
      task_id: 'TP-001',
      classification: 'execution-full',
      mode: 'normal',
      phase: 'execution',
      stage: 'execution',
      previous_stage: null,
      stage_history: [
        {
          stage: 'execution',
          entered_at: '2026-05-07T10:00:00Z',
          exited_at: null,
          exit_reason: null,
        },
      ],
      stage_reopen_count: 0,
      pending_subtasks_needing_rereview: [],
      current_subtask: null,
      pending_subtasks: ['TP-001-A1'],
      last_completed_seq: 0,
      blocked_gates: [],
      pending_user_actions: [],
      subtask_offsets: {},
      gates: {
        p1_approved: true,
        p1_approved_at: '2026-05-07T09:55:00Z',
        p1_approved_signature:
          '0000000000000000000000000000000000000000000000000000000000000000',
        p1_revise_count: 0,
        p1_signature_at_stage_entry:
          '0000000000000000000000000000000000000000000000000000000000000000',
      },
      task_summary_path: 'tasks/TP-001/summary.md',
    },
    extras,
  );
}

function runHook(cwd, env) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    encoding: 'utf8',
    env: Object.assign(
      {},
      process.env,
      { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      env,
    ),
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// =========================================================================
// Stage mismatches — should block
// =========================================================================

test('stage=intake + executor dispatch → blocked', () => {
  const { root, proj } = makeProject('intake-exec', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: v3State({ stage: 'intake' }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 1, out.stderr);
  assert.match(out.stderr, /not allowed in stage="intake"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('stage=planning + executor dispatch → blocked', () => {
  const { root, proj } = makeProject('planning-exec', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: v3State({ stage: 'planning' }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /not allowed in stage="planning"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('stage=closure + executor dispatch → blocked', () => {
  const { root, proj } = makeProject('closure-exec', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: v3State({ stage: 'closure' }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /not allowed in stage="closure"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('stage=closure + reviewer dispatch → blocked', () => {
  const { root, proj } = makeProject('closure-rev', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: v3State({ stage: 'closure' }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'reviewer',
    CLAUDE_TOOL_INPUT_PROMPT: 'review TP-001-A1',
  });
  assert.strictEqual(out.status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Stage matches — should allow
// =========================================================================

test('stage=planning + lead dispatch → allowed', () => {
  const { root, proj } = makeProject('planning-lead', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: v3State({ stage: 'planning' }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'lead',
    CLAUDE_TOOL_INPUT_PROMPT: 'shape TP-001-A1',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('stage=execution + executor dispatch → allowed', () => {
  const { root, proj } = makeProject('exec-exec', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: v3State({ stage: 'execution' }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('stage=execution + reviewer dispatch → allowed', () => {
  const { root, proj } = makeProject('exec-rev', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: v3State({ stage: 'execution' }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'reviewer',
    CLAUDE_TOOL_INPUT_PROMPT: 'review TP-001-A1',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('stage=execution + integration-checker dispatch → allowed', () => {
  const { root, proj } = makeProject('exec-ic', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: v3State({ stage: 'execution' }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'integration-checker',
    CLAUDE_TOOL_INPUT_PROMPT: 'IC TP-001-A1',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Tolerance — silent no-op when stage info absent or schema is pre-v3
// =========================================================================

test('schema_version=2 (no stage field) + executor → allowed (silent no-op)', () => {
  const { root, proj } = makeProject('v2-exec', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: {
      schema_version: 2,
      task_id: 'TP-001',
      mode: 'normal',
      phase: 'execution',
      pending_subtasks: ['TP-001-A1'],
      blocked_gates: [],
      pending_user_actions: [],
      task_summary_path: 'tasks/TP-001/summary.md',
      current_subtask: null,
      last_completed_seq: 0,
      subtask_offsets: {},
      gates: { p1_approved: true },
      classification: 'execution-full',
    },
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Kill switch
// =========================================================================

test('AIAW_DISABLE_STAGE_GUARD=1 with bad stage → allowed', () => {
  const { root, proj } = makeProject('killsw', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: v3State({ stage: 'closure' }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
    AIAW_DISABLE_STAGE_GUARD: '1',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Unknown stage value
// =========================================================================

test('unknown stage value + executor dispatch → blocked', () => {
  const { root, proj } = makeProject('bad-stage', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: v3State({ stage: 'wat' }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /unknown stage="wat"/);
  fs.rmSync(root, { recursive: true, force: true });
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

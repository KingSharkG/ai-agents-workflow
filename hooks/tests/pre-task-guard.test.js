#!/usr/bin/env node
/**
 * Tests for hooks/pre-task-guard.js.
 *
 * Run:
 *   node hooks/tests/pre-task-guard.test.js
 *
 * Strategy: build a minimal artifact-root scaffold (state file + skeleton)
 * for each test, spawn the hook with the right CLAUDE_TOOL_INPUT_* env, and
 * assert exit code + stderr.
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ptg-${label}-`));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);

  if (opts.layout === 'legacy') {
    fs.mkdirSync(path.join(proj, 'ai-workflow-data'));
    return { root, proj, artifactRoot: null };
  }

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
      if (opts.skeleton !== false) {
        fs.writeFileSync(path.join(subDir, 'ai-work.md'), '# skeleton\n');
      }
    }
  }
  return { root, proj, artifactRoot };
}

function defaultState(extras = {}) {
  return Object.assign(
    {
      task_id: 'TP-001',
      mode: 'normal',
      phase: 'execution',
      pending_subtasks: ['TP-001-A1'],
      blocked_gates: [],
      pending_user_actions: [],
      task_summary_path: 'tasks/TP-001/summary.md',
      schema_version: 2,
      current_subtask: null,
      last_completed_seq: 0,
      subtask_offsets: {},
      gates: { p1_approved: true },
      classification: 'execution-full',
    },
    extras,
  );
}

function runHook(cwd, env) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }, env),
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// =========================================================================
// Caller exemption
// =========================================================================

test('chief-orchestrator dispatch is always exempt', () => {
  const { root, proj } = makeProject('chief-exempt', { layout: 'legacy' });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'chief-orchestrator',
    CLAUDE_TOOL_INPUT_PROMPT: 'irrelevant',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('init dispatch is exempt from legacy block', () => {
  const { root, proj } = makeProject('init-legacy', { layout: 'legacy' });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'init',
    CLAUDE_TOOL_INPUT_PROMPT: 'init',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('empty subagent type → fast-exit allow', () => {
  const { root, proj } = makeProject('empty-type', {});
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: '',
    CLAUDE_TOOL_INPUT_PROMPT: 'whatever',
  });
  assert.strictEqual(out.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Legacy block
// =========================================================================

test('legacy folder + executor → block with migration hint', () => {
  const { root, proj } = makeProject('legacy-exec', { layout: 'legacy' });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /Legacy artifact folder/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('legacy folder + lead → block', () => {
  const { root, proj } = makeProject('legacy-lead', { layout: 'legacy' });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'lead',
    CLAUDE_TOOL_INPUT_PROMPT: 'shape TP-001-A1',
  });
  assert.strictEqual(out.status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('legacy folder + reviewer → block', () => {
  const { root, proj } = makeProject('legacy-rev', { layout: 'legacy' });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'reviewer',
    CLAUDE_TOOL_INPUT_PROMPT: 'review',
  });
  assert.strictEqual(out.status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Skeleton check
// =========================================================================

test('valid task_id + present ai-work.md skeleton → allow', () => {
  const { root, proj } = makeProject('skeleton-ok', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: defaultState(),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('task_id present but missing ai-work.md skeleton → block', () => {
  const { root, proj } = makeProject('skeleton-missing', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    skeleton: false,
    state: defaultState(),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /ai-work\.md skeleton not found/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('parseable task_id but task directory absent → block', () => {
  const { root, proj } = makeProject('task-dir-missing', {});
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /task directory not found/);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// P1 gate
// =========================================================================

test('P1 gate not approved + executor dispatch → block', () => {
  const { root, proj } = makeProject('p1-block', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: defaultState({ gates: { p1_approved: false } }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /not allowed before the P1 \(Delivery Plan Approval\) gate/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('P1 gate not approved + delivery-pm dispatch → allow (delivery-pm produces the plan)', () => {
  const { root, proj } = makeProject('p1-deliv', {
    taskId: 'TP-001',
    state: defaultState({ gates: { p1_approved: false }, pending_subtasks: [] }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'delivery-pm',
    CLAUDE_TOOL_INPUT_PROMPT: 'plan TP-001',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('execution-trivial classification bypasses P1 gate even without p1_approved', () => {
  const { root, proj } = makeProject('p1-trivial', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: defaultState({
      gates: {},
      classification: 'execution-trivial',
    }),
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('legacy state file (no schema_version) → allow with WARN', () => {
  const { root, proj } = makeProject('legacy-state', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: {
      task_id: 'TP-001',
      mode: 'normal',
      phase: 'execution',
      pending_subtasks: ['TP-001-A1'],
      blocked_gates: [],
      pending_user_actions: [],
      task_summary_path: 'x',
      // no schema_version, no gates
    },
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  assert.match(out.stderr, /WARN: legacy task/);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Missing artifact root (Change 0)
// =========================================================================

test('no artifact root + no legacy + executor dispatch → block with init hint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-no-root-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  // No .claude/aiaw-data-proj, no sibling, no legacy folder.
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 1, out.stderr);
  assert.match(out.stderr, /cannot dispatch executor without an artifact folder/);
  assert.match(out.stderr, /\/ai-agents-workflow:init/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('no artifact root + delivery-pm dispatch → block (no improvising)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-no-root-pm-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'delivery-pm',
    CLAUDE_TOOL_INPUT_PROMPT: 'plan TP-001',
  });
  assert.strictEqual(out.status, 1, out.stderr);
  assert.match(out.stderr, /cannot dispatch delivery-pm without an artifact folder/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('no artifact root + init dispatch → allow (init scaffolds the folder)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-no-root-init-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'init',
    CLAUDE_TOOL_INPUT_PROMPT: 'init',
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

// =========================================================================
// Canonical schema_version=2 validation (Change 2)
// =========================================================================

test('legacy ad-hoc state shape (subtasks[] + phase:executing) → block with migration hint', () => {
  const { root, proj } = makeProject('adhoc-shape', {
    taskId: 'TP-001',
    subtaskId: 'TP-001-A1',
    state: {
      task_id: 'TP-001',
      classification: 'execution-simple',
      phase: 'executing', // not in canonical phase set
      schema_version: 2,
      gates: { p1_approved: true },
      pending_subtasks: [], // satisfies legacy requiredFields check
      // ad-hoc shape — has stray subtasks[] array, missing canonical fields
      subtasks: [{ id: 'TP-001-A1', status: 'in-progress', current_step: 'lead' }],
    },
  });
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'implement TP-001-A1',
  });
  assert.strictEqual(out.status, 1, out.stderr);
  assert.match(out.stderr, /fails canonical schema_version=2 validation/);
  assert.match(out.stderr, /unknown field "subtasks"/);
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

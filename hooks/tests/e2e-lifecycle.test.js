#!/usr/bin/env node
/**
 * E2E lifecycle integration tests.
 *
 * Exercises the FULL state-write sequence for each task classification
 * (direct-answer, plan-only, execution-trivial, execution-simple) plus the
 * reversal (closure→execution) and P4-abort recipes the previous code review
 * fixes introduced. Each scenario:
 *   1. Spins up a temp artifact root.
 *   2. Writes successive `orchestration-state.json` snapshots representing
 *      every documented transition for the path.
 *   3. After each write, runs the working-tree `validate-orchestration-state-write.js`
 *      and (where appropriate) `validate-artifact-chain.js` hooks and asserts
 *      the documented allow / block outcome.
 *
 * Catches issues unit tests miss because unit tests examine a single state
 * file in isolation. The integration tests catch:
 *   - Transition pairs that pass individually but mis-thread across stages.
 *   - The reversal recipe being un-executable end-to-end (any step blocked).
 *   - Closure invariants firing on intermediate writes they shouldn't reject.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const assert = require('assert');

const REPO = path.resolve(__dirname, '..', '..');
const VALIDATE_STATE = path.join(REPO, 'hooks', 'validate-orchestration-state-write.js');
const VALIDATE_CHAIN = path.join(REPO, 'hooks', 'validate-artifact-chain.js');

const results = { passed: 0, failed: 0, cases: [] };
const NOW = () => new Date().toISOString();

function tmpRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aiaw-e2e-${prefix}-`));
}

function scaffoldArtifactRoot(prefix) {
  // The resolver uses `path.basename(cwd)` as the project name. We mimic it
  // by creating a fake project dir + a sibling `.claude/aiaw-data-<name>/`.
  const projectName = `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  const projectDir = path.join(tmpRoot('proj'), projectName);
  fs.mkdirSync(projectDir, { recursive: true });
  const artifactRoot = path.join(projectDir, '.claude', `aiaw-data-${projectName}`);
  fs.mkdirSync(path.join(artifactRoot, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, 'config'), { recursive: true });
  return { projectDir, artifactRoot };
}

function makeTaskDir(artifactRoot, taskId) {
  const dir = path.join(artifactRoot, 'tasks', taskId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runHook(scriptPath, filePath, cwd) {
  return spawnSync('node', [scriptPath, filePath], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, AIAW_DEBUG: '0' },
  });
}

function writeState(taskDir, state) {
  const p = path.join(taskDir, 'orchestration-state.json');
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
  return p;
}

function expectAllow(label, hook, statePath, cwd) {
  const r = runHook(hook, statePath, cwd);
  if (r.status !== 0) {
    results.failed++;
    results.cases.push({ label, ok: false, detail: `expected exit 0, got ${r.status}\nstderr: ${r.stderr}` });
    return false;
  }
  results.passed++;
  results.cases.push({ label, ok: true });
  return true;
}

function expectBlock(label, hook, statePath, cwd, expectInStderr) {
  const r = runHook(hook, statePath, cwd);
  if (r.status === 0) {
    results.failed++;
    results.cases.push({ label, ok: false, detail: `expected non-zero exit, got 0` });
    return false;
  }
  if (expectInStderr && !r.stderr.includes(expectInStderr)) {
    results.failed++;
    results.cases.push({ label, ok: false, detail: `stderr missing expected substring: ${JSON.stringify(expectInStderr)}\nactual: ${r.stderr.slice(0, 400)}` });
    return false;
  }
  results.passed++;
  results.cases.push({ label, ok: true });
  return true;
}

// ---------- Scenario builders ----------

function baseState(taskId, overrides) {
  return Object.assign(
    {
      schema_version: 3,
      task_id: taskId,
      classification: 'execution-simple',
      mode: 'normal',
      task_summary_path: 'tasks/<task_id>/summary.md',
      phase: 'planning',
      stage: 'intake',
      previous_stage: null,
      current_subtask: null,
      pending_subtasks: [],
      blocked_gates: [],
      pending_user_actions: [],
      pending_subtasks_needing_rereview: [],
      completed_subtasks: [],
      last_completed_seq: 0,
      stage_reopen_count: 0,
      gates: { p1_approved: false, p1_revise_count: 0 },
      stage_history: [
        { stage: 'intake', entered_at: NOW(), exited_at: null, exit_reason: null },
      ],
    },
    overrides,
  );
}

// ---------- Scenario A: plan-only end-to-end ----------
//
// Validates the just-fixed plan-only terminal phase: intake → planning → closure
// with phase=planned and an OPEN terminal closure entry (resumable). The fix
// in guard-chief-orchestrator-stop.js accepts phase=planned for plan-only;
// the validate-orchestration-state-write closure invariants must NOT fire on
// phase=planned (C1–C5 gate on phase=complete only).

function scenarioPlanOnly() {
  const { projectDir, artifactRoot } = scaffoldArtifactRoot('plan-only');
  const taskDir = makeTaskDir(artifactRoot, 'TP-001');

  // Step 2: initial intake write.
  const s1 = baseState('TP-001', { classification: 'plan-only' });
  expectAllow('plan-only step 2 (initial intake)', VALIDATE_STATE, writeState(taskDir, s1), projectDir);

  // Step 3: intake → planning transition.
  const t1 = NOW();
  const s2 = baseState('TP-001', {
    classification: 'plan-only',
    stage: 'planning',
    previous_stage: 'intake',
    stage_history: [
      { stage: 'intake', entered_at: t1, exited_at: t1, exit_reason: 'classified' },
      { stage: 'planning', entered_at: t1, exited_at: null, exit_reason: null },
    ],
  });
  expectAllow('plan-only intake→planning', VALIDATE_STATE, writeState(taskDir, s2), projectDir);

  // Step 4: P1 approve-stop → planning → closure with phase=planned (terminal-resumable).
  const t2 = NOW();
  const s3 = baseState('TP-001', {
    classification: 'plan-only',
    phase: 'planned',
    stage: 'closure',
    previous_stage: 'planning',
    gates: { p1_approved: true, p1_revise_count: 0, p1_approved_at: t2, p1_approved_signature: 'sha256:plan-only' },
    stage_history: [
      { stage: 'intake', entered_at: t1, exited_at: t1, exit_reason: 'classified' },
      { stage: 'planning', entered_at: t1, exited_at: t2, exit_reason: 'p1-approved-stop' },
      { stage: 'closure', entered_at: t2, exited_at: null, exit_reason: null },
    ],
  });
  expectAllow('plan-only planning→closure (phase=planned, terminal-resumable)', VALIDATE_STATE, writeState(taskDir, s3), projectDir);
}

// ---------- Scenario B: execution-trivial end-to-end ----------
//
// Validates the just-documented trivial-flow Step 2 init (mode, task_summary_path,
// last_completed_seq) and the trivial closure path (Step 12.5 mandatory).

function scenarioTrivial() {
  const { projectDir, artifactRoot } = scaffoldArtifactRoot('trivial');
  const taskDir = makeTaskDir(artifactRoot, 'TP-002');

  const t0 = NOW();

  // Trivial Step 2: initial write with stage=execution (skips planning).
  const s1 = baseState('TP-002', {
    classification: 'execution-trivial',
    phase: 'execution',
    stage: 'execution',
    previous_stage: 'intake',
    current_subtask: null,
    pending_subtasks: ['TP-002-A1'],
    gates: { p1_approved: true, p1_revise_count: 0, p1_approved_at: t0, p1_approved_signature: 'trivial-path-auto' },
    stage_history: [
      { stage: 'intake', entered_at: t0, exited_at: t0, exit_reason: 'classified' },
      { stage: 'execution', entered_at: t0, exited_at: null, exit_reason: null },
    ],
  });
  expectAllow('trivial Step 2 init (stage=execution, all required fields)', VALIDATE_STATE, writeState(taskDir, s1), projectDir);

  // Subtask completes: pending_subtasks empty, last_completed_seq=1.
  const s2 = JSON.parse(JSON.stringify(s1));
  s2.pending_subtasks = [];
  s2.last_completed_seq = 1;
  expectAllow('trivial after subtask completion', VALIDATE_STATE, writeState(taskDir, s2), projectDir);

  // Step 12.5: execution → closure with exit_reason=all-subtasks-approved.
  const t1 = NOW();
  const s3 = JSON.parse(JSON.stringify(s2));
  s3.stage = 'closure';
  s3.previous_stage = 'execution';
  s3.stage_history = [
    { stage: 'intake', entered_at: t0, exited_at: t0, exit_reason: 'classified' },
    { stage: 'execution', entered_at: t0, exited_at: t1, exit_reason: 'all-subtasks-approved' },
    { stage: 'closure', entered_at: t1, exited_at: null, exit_reason: null },
  ];
  expectAllow('trivial Step 12.5 execution→closure', VALIDATE_STATE, writeState(taskDir, s3), projectDir);

  // Step 15: phase=complete with terminal closure entry closed. Also requires
  // task-level summary.md to exist with populated body (per validate-artifact-chain).
  // For this scenario we test ONLY the state-write validator (chain validator
  // would also fire post-Edit, tested separately below).
  const t2 = NOW();
  const s4 = JSON.parse(JSON.stringify(s3));
  s4.phase = 'complete';
  s4.workflow_state = 'complete';
  s4.stage_history[2] = { stage: 'closure', entered_at: t1, exited_at: t2, exit_reason: 'completed-without-p4' };
  expectAllow('trivial Step 15 phase=complete', VALIDATE_STATE, writeState(taskDir, s4), projectDir);

  // Negative — phase=complete with non-empty pending_subtasks_needing_rereview MUST block (NEW closure invariant).
  const s5 = JSON.parse(JSON.stringify(s4));
  s5.pending_subtasks_needing_rereview = ['TP-002-A2'];
  expectBlock(
    'trivial phase=complete with non-empty pending_subtasks_needing_rereview MUST block (C2 NEW)',
    VALIDATE_STATE,
    writeState(taskDir, s5),
    projectDir,
    'pending_subtasks_needing_rereview',
  );
}

// ---------- Scenario C: reversal recipe (closure → execution) ----------
//
// Validates the new "State Rewrite Recipe" in reversal-packet/SKILL.md
// produces a state file that passes the validators.

function scenarioReversal() {
  const { projectDir, artifactRoot } = scaffoldArtifactRoot('reversal');
  const taskDir = makeTaskDir(artifactRoot, 'TP-003');

  const t0 = NOW();
  const t1 = NOW();

  // Start from a completed task in closure (phase=complete + stage=closure terminal).
  // Need an orchestration-history.json sibling so last_completed_seq parity holds.
  const historyPath = path.join(taskDir, 'orchestration-history.json');
  fs.writeFileSync(historyPath, JSON.stringify({
    task_id: 'TP-003',
    completed_subtasks: [
      { subtask_id: 'TP-003-A1', verdict: 'approved', cycles: 1, summary_path: 'TP-003-A1/summary.md', sections: ['spec', 'tep', 'implementation', 'review'] },
    ],
    trigger_decisions: {},
  }, null, 2));

  // Make a sibling task-level summary.md so phase=complete writes don't fail
  // validate-artifact-chain (it requires populated body content under
  // Task Status / Changes by Phase / ...).
  fs.writeFileSync(path.join(taskDir, 'summary.md'),
    '# Task Summary\n\n## Task Status\n- task_id: TP-003\n- phase: complete\n\n## Changes by Phase\n- A1\n\n## Detail\nApproved.\n\n## Totals\n- subtasks: 1\n\n## Dispatch Bundles\n- one\n\n## Context Breakdown\nfoo\n',
  );

  const closureState = baseState('TP-003', {
    classification: 'execution-simple',
    phase: 'complete',
    workflow_state: 'complete',
    stage: 'closure',
    previous_stage: 'execution',
    current_subtask: null,
    pending_subtasks: [],
    last_completed_seq: 1,
    stage_history: [
      { stage: 'intake', entered_at: t0, exited_at: t0, exit_reason: 'classified' },
      { stage: 'planning', entered_at: t0, exited_at: t0, exit_reason: 'p1-approved-execute' },
      { stage: 'execution', entered_at: t0, exited_at: t1, exit_reason: 'all-subtasks-approved' },
      { stage: 'closure', entered_at: t1, exited_at: t1, exit_reason: 'p4-approved' },
    ],
    gates: { p1_approved: true, p1_revise_count: 0, p1_approved_at: t0, p1_approved_signature: 'sha256:approved' },
  });
  expectAllow('reversal pre-condition: phase=complete + stage=closure', VALIDATE_STATE, writeState(taskDir, closureState), projectDir);

  // Apply the reversal recipe: close the closure entry with exit_reason: "reversal",
  // append fresh execution entry, reset phase to "execution", repopulate pending_subtasks,
  // increment stage_reopen_count, clear current_subtask.
  const t2 = NOW();
  const reversedState = JSON.parse(JSON.stringify(closureState));
  reversedState.phase = 'execution';
  delete reversedState.workflow_state; // can't keep workflow_state=complete with phase=execution (C4)
  reversedState.stage = 'execution';
  reversedState.previous_stage = 'closure';
  reversedState.stage_reopen_count = 1;
  reversedState.current_subtask = null;
  reversedState.pending_subtasks = ['TP-003-A1'];
  // Close the (previously open—but in the closure-state above the closure entry
  // is already closed because phase=complete) closure entry with reversal exit.
  // Replace the prior p4-approved closure entry with one that has exit_reason=reversal
  // and append a fresh execution entry.
  reversedState.stage_history[3] = { stage: 'closure', entered_at: t1, exited_at: t2, exit_reason: 'reversal' };
  reversedState.stage_history.push({ stage: 'execution', entered_at: t2, exited_at: null, exit_reason: null });
  expectAllow('reversal recipe: closure→execution with phase reset', VALIDATE_STATE, writeState(taskDir, reversedState), projectDir);
}

// ---------- Scenario D: P4 Abort recipe ----------
//
// Validates the new P4 Abort option produces a state that passes validators.

function scenarioP4Abort() {
  const { projectDir, artifactRoot } = scaffoldArtifactRoot('p4-abort');
  const taskDir = makeTaskDir(artifactRoot, 'TP-004');

  const t0 = NOW();
  const t1 = NOW();

  // Start in stage=closure with phase=execution waiting for P4.
  fs.writeFileSync(path.join(taskDir, 'orchestration-history.json'), JSON.stringify({
    task_id: 'TP-004',
    completed_subtasks: [
      { subtask_id: 'TP-004-A1', verdict: 'approved', cycles: 1, summary_path: 'A1/summary.md', sections: ['spec','tep','implementation','review'] },
    ],
    trigger_decisions: {},
  }, null, 2));

  // Apply P4 Abort recipe: phase=blocked, close closure entry with exit_reason=completed-without-p4,
  // populated pending_user_actions naming the abort reason. workflow_state omitted (per fix note).
  const abortedState = baseState('TP-004', {
    classification: 'execution-simple',
    phase: 'blocked',
    stage: 'closure',
    previous_stage: 'execution',
    pending_user_actions: ['Task aborted at P4 (user did not approve completion); review artifacts and decide whether to reopen or discard'],
    last_completed_seq: 1,
    stage_history: [
      { stage: 'intake', entered_at: t0, exited_at: t0, exit_reason: 'classified' },
      { stage: 'planning', entered_at: t0, exited_at: t0, exit_reason: 'p1-approved-execute' },
      { stage: 'execution', entered_at: t0, exited_at: t1, exit_reason: 'all-subtasks-approved' },
      { stage: 'closure', entered_at: t1, exited_at: t1, exit_reason: 'completed-without-p4' },
    ],
    gates: { p1_approved: true, p1_revise_count: 0, p1_approved_at: t0, p1_approved_signature: 'sha256:approved' },
  });
  expectAllow('P4 Abort: phase=blocked + closure exit completed-without-p4', VALIDATE_STATE, writeState(taskDir, abortedState), projectDir);
}

// ---------- Scenario E: closure invariant for stage=reopened ----------
//
// Validates the soft reopen execution→planning→execution cycle counts up.

function scenarioReopen() {
  const { projectDir, artifactRoot } = scaffoldArtifactRoot('reopen');
  const taskDir = makeTaskDir(artifactRoot, 'TP-005');

  const t0 = NOW();
  const t1 = NOW();
  const t2 = NOW();

  // Multi-reopen state: execution → planning → execution (Reviewer needs-replan).
  const s = baseState('TP-005', {
    phase: 'execution',
    stage: 'execution',
    previous_stage: 'planning',
    stage_reopen_count: 1,
    pending_subtasks: ['TP-005-B1'],
    pending_subtasks_needing_rereview: ['TP-005-A1'],
    gates: { p1_approved: true, p1_revise_count: 0, p1_approved_at: t0, p1_approved_signature: 'sha256:approved', p1_signature_at_stage_entry: 'sha256:approved' },
    stage_history: [
      { stage: 'intake', entered_at: t0, exited_at: t0, exit_reason: 'classified' },
      { stage: 'planning', entered_at: t0, exited_at: t0, exit_reason: 'p1-approved-execute' },
      { stage: 'execution', entered_at: t0, exited_at: t1, exit_reason: 'needs-replan' },
      { stage: 'planning', entered_at: t1, exited_at: t2, exit_reason: 'p1-signature-unchanged' },
      { stage: 'execution', entered_at: t2, exited_at: null, exit_reason: null },
    ],
  });
  expectAllow('soft-reopen execution→planning→execution', VALIDATE_STATE, writeState(taskDir, s), projectDir);

  // Try to close phase=complete with the rereview list still non-empty — MUST BLOCK.
  const sFail = JSON.parse(JSON.stringify(s));
  sFail.phase = 'complete';
  sFail.stage = 'closure';
  sFail.current_subtask = null;
  sFail.pending_subtasks = [];
  // pending_subtasks_needing_rereview is still ['TP-005-A1'] — should BLOCK.
  sFail.stage_history = sFail.stage_history.concat([
    { stage: 'closure', entered_at: t2, exited_at: t2, exit_reason: 'p4-approved' },
  ]);
  // The final stage_history entry's previous (execution) entry needs to be closed.
  sFail.stage_history[4] = { stage: 'execution', entered_at: t2, exited_at: t2, exit_reason: 'all-subtasks-approved' };
  expectBlock(
    'phase=complete with non-empty pending_subtasks_needing_rereview is rejected',
    VALIDATE_STATE,
    writeState(taskDir, sFail),
    projectDir,
    'pending_subtasks_needing_rereview',
  );
}

// ---------- Run ----------

[scenarioPlanOnly, scenarioTrivial, scenarioReversal, scenarioP4Abort, scenarioReopen].forEach((fn) => {
  try {
    fn();
  } catch (e) {
    results.failed++;
    results.cases.push({ label: `${fn.name} threw`, ok: false, detail: e.stack });
  }
});

const total = results.passed + results.failed;
console.log(`\n=== e2e-lifecycle.test.js ===`);
for (const c of results.cases) {
  console.log(`${c.ok ? 'ok ' : 'FAIL'}  ${c.label}${c.detail ? '\n      ' + c.detail.split('\n').join('\n      ') : ''}`);
}
console.log(`\n${results.passed} passed, ${results.failed} failed (${total} total)`);
process.exit(results.failed > 0 ? 1 : 0);

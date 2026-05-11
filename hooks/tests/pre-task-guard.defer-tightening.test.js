#!/usr/bin/env node
/**
 * Tests for the Phase 1.6/1.7 changes in hooks/pre-task-guard.js:
 *
 *   1.6: `init` is no longer in ALLOWED_BEFORE_P1 (it's a side-flow agent
 *        and would be blocked by Phase 3.5 stage gate anyway). Verified
 *        indirectly: `init` paths still exit cleanly via the early-return
 *        legacy-folder block, so the meaningful test is that gated roles
 *        without P1 still block — which is already covered in the existing
 *        suite. The set is also no longer a leaky exception.
 *
 *   1.7: Gated roles (lead/executor/reviewer/design-agent/integration-checker)
 *        with no resolvable task state now BLOCK rather than silently defer.
 *        Two failure modes:
 *          (a) no resolvedTaskId — prompt has no parseable task_id and
 *              no recent task dir matches.
 *          (b) resolvedTaskId points at a dir with no readable state file
 *              (race condition or partial setup).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'pre-task-guard.js');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

function makeProject(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ptg-defer-${label}-`));
  const proj = path.join(root, 'proj');
  const artifactRoot = path.join(proj, '.claude', 'aiaw-data-proj');
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, 'tasks'), { recursive: true });
  return { root, proj, artifactRoot };
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

test('gated executor with no resolvable task → BLOCK', () => {
  const { root, proj } = makeProject('exec-no-task');
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'do the thing', // no task id, no subtask id
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED.*executor.*no active task/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('gated reviewer with no resolvable task → BLOCK', () => {
  const { root, proj } = makeProject('rev-no-task');
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'reviewer',
    CLAUDE_TOOL_INPUT_PROMPT: 'review please',
  });
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED.*reviewer.*no active task/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('non-gated delivery-pm with no resolvable task is still ALLOWED (it produces the plan)', () => {
  const { root, proj } = makeProject('pm-no-task');
  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'delivery-pm',
    CLAUDE_TOOL_INPUT_PROMPT: 'plan it',
  });
  // delivery-pm is not in GATED_ROLES; the new defer-tightening only fires for
  // gated roles. delivery-pm without a state file is permitted to run because
  // it is the agent that creates the plan in the first place.
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(root, { recursive: true, force: true });
});

test('gated executor with resolvable task dir but no state file → BLOCK', () => {
  const { root, proj, artifactRoot } = makeProject('exec-no-state');
  // Create the task dir so the prompt resolves, but no orchestration-state.json.
  const taskDir = path.join(artifactRoot, 'tasks', 'TP-001');
  fs.mkdirSync(taskDir, { recursive: true });
  // We also need ai-work.md + summary.md skeletons so the skeleton phase
  // (which runs before the P1 phase) doesn't block first.
  const subDir = path.join(taskDir, 'TP-001-A1');
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(subDir, 'ai-work.md'), '# skeleton\n');
  fs.writeFileSync(path.join(subDir, 'summary.md'), '# summary\n');

  const out = runHook(proj, {
    CLAUDE_TOOL_INPUT_SUBAGENT_TYPE: 'executor',
    CLAUDE_TOOL_INPUT_PROMPT: 'work on TP-001 subtask TP-001-A1',
  });
  // resolvedTaskId resolves via mostRecentTaskDir 'state' mode — that
  // mode requires orchestration-state.json to exist on candidate dirs, so
  // resolvedTaskId comes back null, hitting the "no active task" branch.
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /BLOCKED.*executor.*no active task/);
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

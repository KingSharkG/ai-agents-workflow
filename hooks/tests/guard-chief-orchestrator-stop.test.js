#!/usr/bin/env node
/**
 * Tests for hooks/guard-chief-orchestrator-stop.js.
 *
 * Run:
 *   node hooks/tests/guard-chief-orchestrator-stop.test.js
 *
 * Strategy: build a synthetic JSONL transcript per case, write it to a tmp
 * file, spawn the hook with a stdin payload pointing at that transcript,
 * and assert on exit code (0 = allow, 2 = block) plus stderr content.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'guard-chief-orchestrator-stop.js');

// -------- Transcript-line builders --------

function userLine(text) {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
  });
}

function assistantToolUse(parts) {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: parts },
  });
}

function intakeSkillUse() {
  return {
    type: 'tool_use',
    name: 'Skill',
    input: { skill: 'orchestrator-intake' },
  };
}

function namespacedIntakeSkillUse() {
  return {
    type: 'tool_use',
    name: 'Skill',
    input: { skill: 'ai-agents-workflow:orchestrator-intake' },
  };
}

function taskDispatch(subagent) {
  return {
    type: 'tool_use',
    name: 'Task',
    input: { subagent_type: subagent || 'lead', prompt: 'work please' },
  };
}

function taskDataWrite(finalPath, filePath) {
  const fp = filePath || '/tmp/aiaw-data-x/tasks/AI-1/task-data.md';
  return {
    type: 'tool_use',
    name: 'Write',
    input: {
      file_path: fp,
      content:
        `<!-- section:intake-classification -->\n` +
        `### Intake Classification\n` +
        `- **heuristic_verdict**: ${finalPath}\n` +
        `- **final_path**: ${finalPath}\n` +
        `- **timestamp**: 2026-05-06T00:00:00Z\n` +
        `<!-- /section:intake-classification -->\n`,
    },
  };
}

function unrelatedSkillUse(name) {
  return {
    type: 'tool_use',
    name: 'Skill',
    input: { skill: name },
  };
}

// -------- Test harness --------

function writeTranscript(label, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gcos-${label}-`));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return { dir, file };
}

function runHook(transcriptPath, opts = {}) {
  const payload = Object.assign(
    {
      session_id: 'test-session',
      transcript_path: transcriptPath,
      stop_hook_active: false,
    },
    opts.payloadOverrides || {},
  );
  return spawnSync(process.execPath, [HOOK], {
    cwd: opts.cwd || undefined,
    encoding: 'utf8',
    input: JSON.stringify(payload),
    env: process.env,
  });
}

// -------- Project scaffold for execute-path closure tests --------
//
// Strengthened guard reads <artifact-root>/tasks/<task_id>/orchestration-state.json
// and the current subtask's ai-work.md. We need a real on-disk layout the hook
// can resolve via resolveArtifactRoot() when run with cwd = projectDir.
function makeProject(label, opts = {}) {
  const taskId = opts.taskId || 'AI-1';
  const subtaskId = opts.subtaskId || 'AI-1-A1';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gcos-proj-${label}-`));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const artifactRoot = path.join(proj, '.claude', 'aiaw-data-proj');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const taskDir = path.join(artifactRoot, 'tasks', taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  if (opts.state) {
    fs.writeFileSync(
      path.join(taskDir, 'orchestration-state.json'),
      JSON.stringify(opts.state),
    );
  }
  const subDir = path.join(taskDir, subtaskId);
  fs.mkdirSync(subDir, { recursive: true });
  const aiWorkContent = opts.implContent
    ? `# ai-work\n<!-- section:implementation -->\n${opts.implContent}\n<!-- /section:implementation -->\n`
    : `# ai-work\n<!-- section:implementation -->\n<!-- /section:implementation -->\n`;
  fs.writeFileSync(path.join(subDir, 'ai-work.md'), aiWorkContent);
  fs.writeFileSync(path.join(subDir, 'summary.md'), '# summary\n');
  return { root, proj, taskDir, subDir, taskId, subtaskId };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// =========================================================================
// Failure mode: intake invoked, no Task, no task-data.md → BLOCK
// =========================================================================

test('intake invoked, no dispatch, no task-data → BLOCK', () => {
  const { dir, file } = writeTranscript('block-bare', [
    userLine('/ai-agents-workflow:task add a comment to foo.ts'),
    assistantToolUse([intakeSkillUse()]),
    userLine('3'),
    // chief just answers inline — no further tool_use
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 2, `expected block, got ${out.status}: ${out.stderr}`);
  assert.match(out.stderr, /BLOCKED/);
  assert.match(out.stderr, /no Task\(\) dispatch/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('namespaced intake invoked, no dispatch, no task-data → BLOCK', () => {
  const { dir, file } = writeTranscript('block-namespaced', [
    userLine('/ai-agents-workflow:task fix typo'),
    assistantToolUse([namespacedIntakeSkillUse()]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Allow: intake invoked AND Task dispatched
// =========================================================================

test('intake invoked + Task(lead) dispatched → ALLOW', () => {
  const { dir, file } = writeTranscript('allow-task', [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse()]),
    assistantToolUse([taskDispatch('delivery-pm')]),
    assistantToolUse([taskDispatch('lead')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Allow: intake invoked + direct-answer task-data.md
// =========================================================================

test('intake invoked + task-data.md with final_path direct-answer → ALLOW', () => {
  const { dir, file } = writeTranscript('allow-direct', [
    userLine('/ai-agents-workflow:task what does foo() do?'),
    assistantToolUse([intakeSkillUse()]),
    assistantToolUse([taskDataWrite('direct-answer')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Allow: intake invoked + plan-only task-data.md
// =========================================================================

test('intake invoked + task-data.md with final_path plan-only → ALLOW', () => {
  const { dir, file } = writeTranscript('allow-plan', [
    userLine('/ai-agents-workflow:task draft a plan'),
    assistantToolUse([intakeSkillUse()]),
    assistantToolUse([taskDataWrite('plan-only')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Allow: intake never invoked → ALLOW (not chief, or chief errored early)
// =========================================================================

test('intake never invoked → ALLOW (other subagent or early-exit chief)', () => {
  const { dir, file } = writeTranscript('allow-no-intake', [
    userLine('do some work'),
    assistantToolUse([unrelatedSkillUse('project-discovery')]),
    assistantToolUse([taskDispatch('executor')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('completely empty transcript → ALLOW', () => {
  const { dir, file } = writeTranscript('allow-empty', []);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Failure-open paths
// =========================================================================

test('stop_hook_active=true → ALLOW (no recursion)', () => {
  const { dir, file } = writeTranscript('allow-recursion', [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse()]),
  ]);
  const out = runHook(file, { payloadOverrides: { stop_hook_active: true } });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing transcript_path → ALLOW (fail-open)', () => {
  const out = spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify({ session_id: 's', stop_hook_active: false }),
    env: process.env,
  });
  assert.strictEqual(out.status, 0);
});

test('nonexistent transcript file → ALLOW (fail-open)', () => {
  const out = runHook('/tmp/definitely-not-a-real-transcript-xyz.jsonl');
  assert.strictEqual(out.status, 0);
});

test('malformed JSON in transcript line → ignored, intake-detection still works', () => {
  const { dir, file } = writeTranscript('malformed', [
    userLine('/ai-agents-workflow:task'),
    'this is not json',
    assistantToolUse([intakeSkillUse()]),
    'also not json',
    assistantToolUse([taskDispatch('lead')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Edge: Edit (not Write) producing the task-data.md classification block
// =========================================================================

test('intake invoked + Edit on task-data.md adding final_path direct-answer → ALLOW', () => {
  const editPart = {
    type: 'tool_use',
    name: 'Edit',
    input: {
      file_path: '/tmp/aiaw-data-x/tasks/AI-1/task-data.md',
      old_string: '<placeholder>',
      new_string:
        '<!-- section:intake-classification -->\n' +
        '- **final_path**: direct-answer\n' +
        '<!-- /section:intake-classification -->\n',
    },
  };
  const { dir, file } = writeTranscript('allow-edit', [
    userLine('/ai-agents-workflow:task what is X'),
    assistantToolUse([intakeSkillUse()]),
    assistantToolUse([editPart]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Strengthened execute-path closure invariants
// =========================================================================

function executeTurn({ taskDir, subtaskId, dispatchReviewer = true, finalPath = 'execution-trivial' }) {
  const taskDataPath = path.join(taskDir, 'task-data.md');
  const parts = [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse()]),
    assistantToolUse([taskDataWrite(finalPath, taskDataPath)]),
    assistantToolUse([taskDispatch('executor')]),
  ];
  if (dispatchReviewer) parts.push(assistantToolUse([taskDispatch('reviewer')]));
  return parts;
}

test('execute-trivial + executor + reviewer + phase=complete + impl filled → ALLOW', () => {
  const { root, proj, taskDir, subtaskId, taskId } = makeProject('exec-complete', {
    implContent: 'impl-summary: did the thing\n',
    state: {
      schema_version: 3,
      task_id: 'AI-1',
      classification: 'execution-trivial',
      stage: 'closure',
      phase: 'complete',
      workflow_state: 'complete',
      current_subtask: null,
      pending_subtasks: [],
      blocked_gates: [],
      pending_user_actions: [],
      last_completed_seq: 1,
    },
  });
  const { dir, file } = writeTranscript('exec-complete', executeTurn({ taskDir, subtaskId }));
  const out = runHook(file, { cwd: proj });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('execute-trivial + executor only (no reviewer) + state still in_progress → BLOCK', () => {
  // The bug scenario: orchestrator stopped after Executor returned without
  // dispatching Reviewer, without running closure, without populating the
  // implementation section.
  const { root, proj, taskDir, subtaskId } = makeProject('bug-scenario', {
    state: {
      schema_version: 3,
      task_id: 'AI-1',
      classification: 'execution-trivial',
      stage: 'execution',
      phase: 'execution',
      workflow_state: 'in_progress',
      current_subtask: 'AI-1-A1',
      pending_subtasks: ['AI-1-A1'],
      blocked_gates: [],
      pending_user_actions: [],
      last_completed_seq: 0,
    },
  });
  const { dir, file } = writeTranscript(
    'bug-scenario',
    executeTurn({ taskDir, subtaskId, dispatchReviewer: false }),
  );
  const out = runHook(file, { cwd: proj });
  assert.strictEqual(out.status, 2, `expected block, got ${out.status}: ${out.stderr}`);
  assert.match(out.stderr, /closure invariants/);
  assert.match(out.stderr, /section:implementation/);
  assert.match(out.stderr, /reviewer/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('execute-trivial + reviewer + state phase=complete but impl section empty → BLOCK', () => {
  const { root, proj, taskDir, subtaskId } = makeProject('empty-impl', {
    state: {
      schema_version: 3,
      task_id: 'AI-1',
      classification: 'execution-trivial',
      stage: 'closure',
      phase: 'complete',
      workflow_state: 'complete',
      current_subtask: 'AI-1-A1',
      pending_subtasks: [],
      blocked_gates: [],
      pending_user_actions: [],
      last_completed_seq: 1,
    },
  });
  const { dir, file } = writeTranscript('empty-impl', executeTurn({ taskDir, subtaskId }));
  const out = runHook(file, { cwd: proj });
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /section:implementation/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('execute-trivial + executor only + pending_user_actions non-empty → ALLOW (legitimate hand-off)', () => {
  const { root, proj, taskDir, subtaskId } = makeProject('handoff', {
    implContent: 'impl-summary: paused awaiting user\n',
    state: {
      schema_version: 3,
      task_id: 'AI-1',
      classification: 'execution-trivial',
      stage: 'execution',
      phase: 'execution',
      current_subtask: 'AI-1-A1',
      pending_subtasks: ['AI-1-A1'],
      blocked_gates: [],
      pending_user_actions: [{ id: 'install-deps', description: 'run npm install' }],
      last_completed_seq: 0,
    },
  });
  const { dir, file } = writeTranscript(
    'handoff',
    executeTurn({ taskDir, subtaskId, dispatchReviewer: false }),
  );
  const out = runHook(file, { cwd: proj });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
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

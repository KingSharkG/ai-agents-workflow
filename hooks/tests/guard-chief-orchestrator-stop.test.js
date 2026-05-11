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

// The orchestrator-intake skill mandates a four-option AskUserQuestion popup
// after classification. The guard treats intake-invoked-but-no-AskUserQuestion
// as a protocol violation. Every fixture that asserts a non-popup-skip outcome
// must include this tool_use after the intake invocation.
function askUserQuestionUse() {
  return {
    type: 'tool_use',
    name: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'Confirm classification',
          header: 'Path',
          multiSelect: false,
          options: [
            { label: 'Direct answer', description: 'd' },
            { label: 'Plan only', description: 'p' },
            { label: 'Execute (lightweight)', description: 'l' },
            { label: 'Execute (full pipeline)', description: 'f' },
          ],
        },
      ],
    },
  };
}

// Variant with the `(Recommended)` suffix on one option — must still be
// recognized as a confirm popup.
function askUserQuestionUseWithRecommended() {
  return {
    type: 'tool_use',
    name: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'How should I handle this?',
          header: 'Classification',
          multiSelect: false,
          options: [
            { label: 'Direct answer', description: 'd' },
            { label: 'Plan only (Recommended)', description: 'p' },
            { label: 'Execute (lightweight)', description: 'l' },
            { label: 'Execute (full pipeline)', description: 'f' },
          ],
        },
      ],
    },
  };
}

// Variant with model-drifted labels — must still be recognized via the
// "≥2 of 4 canonical labels match" tolerance.
function askUserQuestionUseDrifted() {
  return {
    type: 'tool_use',
    name: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'How should I handle this?',
          header: 'Path',
          multiSelect: false,
          options: [
            { label: 'Direct answer', description: 'd' },
            { label: 'Plan only', description: 'p' },
            { label: 'Run it now (drifted label)', description: 'l' },
            { label: 'Not sure / didn\'t check', description: 'f' },
          ],
        },
      ],
    },
  };
}

// 3-option freeform clarify-gate AskUserQuestion — must NOT be recognized as
// the confirm popup (different structural shape).
function clarifyGateUse() {
  return {
    type: 'tool_use',
    name: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'What file should this target?',
          header: 'Clarify',
          multiSelect: false,
          options: [
            { label: 'src/foo.ts', description: 'f' },
            { label: 'src/bar.ts', description: 'b' },
            { label: 'other', description: 'o' },
          ],
        },
      ],
    },
  };
}

// A 4-option AskUserQuestion with completely unrelated labels — the "false
// friend" case the shape check must reject.
function unrelatedFourOptionPopup() {
  return {
    type: 'tool_use',
    name: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'Which artifacts should I review?',
          header: 'Artifacts',
          multiSelect: false,
          options: [
            { label: 'ai-work.md', description: 'a' },
            { label: 'summary.md', description: 's' },
            { label: 'task-data.md', description: 't' },
            { label: 'orchestration-state.json', description: 'o' },
          ],
        },
      ],
    },
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
  // Strip developer-shell pollution: the hook's env-var fallback scoping makes
  // CLAUDE_SUBAGENT_TYPE meaningful, and CLAUDE_TRANSCRIPT_PATH is a fallback
  // when payload.transcript_path is absent. Wildcard the strip so any future
  // CLAUDE_* env contract the hook reads is also isolated. Each test must
  // explicitly opt-in via opts.env if it wants to set a var.
  //
  // The wildcard is intentionally broad: tests must be hermetic, so even
  // unrelated CLAUDE_* vars (e.g. CLAUDE_HOME, CLAUDE_VERSION) are stripped.
  const baseEnv = Object.assign({}, process.env);
  for (const k of Object.keys(baseEnv)) {
    if (k.startsWith('CLAUDE_')) delete baseEnv[k];
  }
  return spawnSync(process.execPath, [HOOK], {
    cwd: opts.cwd || undefined,
    encoding: 'utf8',
    input: JSON.stringify(payload),
    env: Object.assign(baseEnv, opts.env || {}),
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
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),
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
    assistantToolUse([namespacedIntakeSkillUse(), askUserQuestionUse()]),
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
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),
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
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),
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
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),
    assistantToolUse([taskDataWrite('plan-only')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Failure mode: intake invoked but AskUserQuestion popup skipped
// =========================================================================

test('intake invoked but no AskUserQuestion popup + final_path written → BLOCK (popup skipped)', () => {
  // Chief invoked orchestrator-intake, then wrote final_path into task-data.md
  // without firing the mandatory four-option AskUserQuestion popup. User never
  // got to override the heuristic verdict.
  const { dir, file } = writeTranscript('block-popup-skipped', [
    userLine('/ai-agents-workflow:task something risky'),
    assistantToolUse([intakeSkillUse()]),
    assistantToolUse([taskDataWrite('plan-only')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 2, `expected block, got ${out.status}: ${out.stderr}`);
  assert.match(out.stderr, /AskUserQuestion confirm popup/);
  assert.match(out.stderr, /Confirm-and-Override Protocol/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('intake invoked but no AskUserQuestion + Task dispatched, no task-data.md → BLOCK (intake-errored)', () => {
  // No task-data.md → intake-errored branch (chief got partway then stalled
  // before recording a final_path). Downstream dispatches alone are not enough.
  const { dir, file } = writeTranscript('block-intake-errored-dispatched', [
    userLine('/ai-agents-workflow:task fix the thing'),
    assistantToolUse([intakeSkillUse()]),
    assistantToolUse([taskDispatch('delivery-pm')]),
    assistantToolUse([taskDispatch('lead')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /intake stage did not complete/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('intake + popup-skipped but [E2E_AUTO_APPROVE_MODE] marker in transcript → ALLOW', () => {
  // The e2e harness intentionally bypasses the popup by injecting the marker.
  // This is the only legal popup-skip path.
  const { dir, file } = writeTranscript('allow-e2e-auto-approve', [
    userLine('/ai-agents-workflow:task [E2E_AUTO_APPROVE_MODE] fix the bug'),
    assistantToolUse([intakeSkillUse()]),
    assistantToolUse([taskDataWrite('direct-answer')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, `expected allow, got ${out.status}: ${out.stderr}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('intake + AskUserQuestion BEFORE intake (clarify gate) only → BLOCK (post-intake popup still required)', () => {
  // The orchestrator-intake skill has a clarify gate that may fire
  // AskUserQuestion BEFORE classification. That call doesn't count toward the
  // post-classification confirm popup requirement.
  const { dir, file } = writeTranscript('block-clarify-only', [
    userLine('/ai-agents-workflow:task vague request'),
    assistantToolUse([askUserQuestionUse()]),       // clarify gate
    assistantToolUse([intakeSkillUse()]),           // then intake classifies
    assistantToolUse([taskDataWrite('plan-only')]), // then writes final_path — no confirm popup
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /AskUserQuestion confirm popup/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Shape detection: confirm popup vs clarify gate vs unrelated 4-option popup
// =========================================================================

test('confirm popup with (Recommended) suffix → ALLOW', () => {
  // Real production runs append " (Recommended)" to the heuristic-pick label.
  // The shape check must strip that and still recognize the popup.
  const { dir, file } = writeTranscript('allow-recommended-suffix', [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse(), askUserQuestionUseWithRecommended()]),
    assistantToolUse([taskDataWrite('plan-only')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, `expected allow, got ${out.status}: ${out.stderr}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('label-drifted confirm popup (only 2 of 4 canonical labels match) → ALLOW', () => {
  // The model drifts on labels at runtime. As long as ≥2 of the 4 canonical
  // labels match, the popup counts. Strict equality would false-block this.
  const { dir, file } = writeTranscript('allow-drifted-labels', [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse(), askUserQuestionUseDrifted()]),
    assistantToolUse([taskDataWrite('plan-only')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, `expected allow, got ${out.status}: ${out.stderr}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('3-option clarify-gate AskUserQuestion after intake but no 4-option confirm → BLOCK', () => {
  // A clarify-gate-shaped popup (3 options, freeform labels) after intake
  // doesn't satisfy the confirm-popup requirement.
  const { dir, file } = writeTranscript('block-clarify-shape', [
    userLine('/ai-agents-workflow:task vague'),
    assistantToolUse([intakeSkillUse(), clarifyGateUse()]),
    assistantToolUse([taskDataWrite('plan-only')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /AskUserQuestion confirm popup/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('4-option AskUserQuestion with unrelated labels ("Artifacts" false-friend) → BLOCK', () => {
  // 4 options is the right cardinality, but the labels are nothing like the
  // canonical confirm popup. ≥2-of-4 match rule rejects this.
  const { dir, file } = writeTranscript('block-unrelated-4-option', [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse(), unrelatedFourOptionPopup()]),
    assistantToolUse([taskDataWrite('plan-only')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /AskUserQuestion confirm popup/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Distinct failure modes: popup-skipped vs intake-errored
// =========================================================================

test('intake invoked, no popup, no task-data.md → BLOCK with intake-errored reason', () => {
  // Distinct from popup-skipped: chief invoked intake but neither popped the
  // popup NOR wrote task-data.md. The classification process aborted
  // mid-flight. Different remediation than popup-skipped.
  const { dir, file } = writeTranscript('block-intake-errored', [
    userLine('/ai-agents-workflow:task fix the thing'),
    assistantToolUse([intakeSkillUse()]),
    // No popup, no task-data.md write, no dispatch — chief just stopped.
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /intake stage did not complete/);
  assert.match(out.stderr, /aborted mid-flight/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('intake invoked, no popup, taskDataWrite present → BLOCK with popup-skipped reason (not intake-errored)', () => {
  // popupSkipped branch: chief got far enough to record final_path but
  // skipped the user override popup.
  const { dir, file } = writeTranscript('block-popup-skipped-distinct', [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse()]),
    assistantToolUse([taskDataWrite('plan-only')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /recorded a final_path in task-data.md/);
  // Must NOT pick up the intake-errored message.
  assert.doesNotMatch(out.stderr, /aborted mid-flight/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// E2E marker scope: must be in the originating user prompt, not just anywhere
// =========================================================================

test('[E2E_AUTO_APPROVE_MODE] only in tool_result content (not user prompt) → still BLOCK', () => {
  // The marker can legitimately appear in a tool result (e.g. a Read of
  // orchestrator-intake/SKILL.md which documents it). The hook must scope its
  // marker scan to the originating user message, not the whole transcript.
  const toolResult = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          content:
            'When the originating task prompt contains the literal marker ' +
            '[E2E_AUTO_APPROVE_MODE], this skill enters auto-approve mode...',
        },
      ],
    },
  });
  const { dir, file } = writeTranscript('block-marker-in-tool-result', [
    userLine('/ai-agents-workflow:task fix it (no marker in this user prompt)'),
    assistantToolUse([intakeSkillUse()]),
    toolResult, // marker appears here, NOT in the first user message
    assistantToolUse([taskDataWrite('plan-only')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 2, `expected block: ${out.stderr}`);
  assert.match(out.stderr, /AskUserQuestion confirm popup/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// =========================================================================
// Latest-intake anchoring (defensive against rare reclassification retries)
// =========================================================================

test('intake invoked twice in one turn, popup after second only → ALLOW', () => {
  // Latest-intake-wins: an earlier intake without a popup is fine as long as
  // a later intake DOES have the popup after it.
  const { dir, file } = writeTranscript('allow-intake-retried', [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse()]),                            // first intake — no popup
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),      // reclassify with popup
    assistantToolUse([taskDataWrite('plan-only')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 0, `expected allow, got ${out.status}: ${out.stderr}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('intake invoked twice, popup only BEFORE second intake → BLOCK (popup needs to come after latest)', () => {
  // Inverse: if the popup happens between the two intakes, the latest
  // intake invocation has no popup after it → popupSkipped.
  const { dir, file } = writeTranscript('block-popup-before-latest-intake', [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),  // first intake + popup
    assistantToolUse([intakeSkillUse()]),                        // reclassify, no popup after
    assistantToolUse([taskDataWrite('plan-only')]),
  ]);
  const out = runHook(file);
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /AskUserQuestion confirm popup/);
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
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),
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
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),
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
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),
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
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),
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
// CAKE-5997 hardening — new conditions
// =========================================================================

// Build a transcript with chief making out-of-artifact Edit calls. Returns
// path to transcript and root for cleanup.
function makeOutOfArtifactWriteScenario(label, opts = {}) {
  const { root, proj, taskDir } = makeProject(label, {
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
  const taskDataPath = path.join(taskDir, 'task-data.md');
  const offendingEdit = {
    type: 'tool_use',
    name: 'Edit',
    input: {
      file_path: opts.offendingPath || path.join(proj, 'src', 'Color.kt'),
      old_string: 'a',
      new_string: 'b',
    },
  };
  const parts = [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),
    assistantToolUse([taskDataWrite('execution-trivial', taskDataPath)]),
    assistantToolUse([offendingEdit]),
    assistantToolUse([taskDispatch('executor')]),
    assistantToolUse([taskDispatch('reviewer')]),
  ];
  const { dir, file } = writeTranscript(label, parts);
  return { root, proj, dir, file };
}

test('chief Edit on consumer-repo path → BLOCK (CAKE-5997 retroactive backstop)', () => {
  const { root, proj, dir, file } = makeOutOfArtifactWriteScenario('out-of-artifact-edit');
  const out = runHook(file, { cwd: proj });
  assert.strictEqual(out.status, 2, `expected block, got ${out.status}: ${out.stderr}`);
  assert.match(out.stderr, /outside the artifact root/);
  assert.match(out.stderr, /Color\.kt/);
  assert.match(out.stderr, /reserved for Task\(executor\)/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('chief Write on consumer-repo path → BLOCK', () => {
  const { root, proj, taskDir } = makeProject('out-of-artifact-write', {
    implContent: 'impl-summary: ok\n',
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
  const offendingWrite = {
    type: 'tool_use',
    name: 'Write',
    input: { file_path: path.join(proj, 'README.md'), content: 'oops' },
  };
  const parts = [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),
    assistantToolUse([taskDataWrite('execution-trivial', path.join(taskDir, 'task-data.md'))]),
    assistantToolUse([offendingWrite]),
    assistantToolUse([taskDispatch('executor')]),
    assistantToolUse([taskDispatch('reviewer')]),
  ];
  const { dir, file } = writeTranscript('out-of-artifact-write', parts);
  const out = runHook(file, { cwd: proj });
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /outside the artifact root/);
  assert.match(out.stderr, /README\.md/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('CLAUDE_SUBAGENT_TYPE=chief-orchestrator + intake never invoked → BLOCK', () => {
  // CAKE-5997 primary failure mode: chief was dispatched, but skipped Step 0
  // entirely. Intake skill never ran. The intake-invoked scoping wouldn't
  // catch this — the env-var fallback does.
  const { dir, file } = writeTranscript('env-says-chief-no-intake', [
    userLine('/ai-agents-workflow:task add a color token'),
    // No intake skill use, no task-data.md, no Task() dispatch — chief just
    // answers inline.
  ]);
  const out = runHook(file, {
    env: { CLAUDE_SUBAGENT_TYPE: 'chief-orchestrator' },
  });
  assert.strictEqual(out.status, 2, `expected block, got ${out.status}: ${out.stderr}`);
  assert.match(out.stderr, /orchestrator-intake/);
  assert.match(out.stderr, /Step 0/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLAUDE_SUBAGENT_TYPE=ai-agents-workflow:chief-orchestrator + intake never invoked → BLOCK', () => {
  // bareRole() must strip the namespace.
  const { dir, file } = writeTranscript('env-says-chief-namespaced', [
    userLine('/ai-agents-workflow:task'),
  ]);
  const out = runHook(file, {
    env: { CLAUDE_SUBAGENT_TYPE: 'ai-agents-workflow:chief-orchestrator' },
  });
  assert.strictEqual(out.status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLAUDE_SUBAGENT_TYPE=executor + intake never invoked → ALLOW (other agent)', () => {
  // env says it's not chief — hook must stay scoped.
  const { dir, file } = writeTranscript('env-says-executor', [
    userLine('do work'),
    assistantToolUse([taskDispatch('lead')]),
  ]);
  const out = runHook(file, {
    env: { CLAUDE_SUBAGENT_TYPE: 'executor' },
  });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLAUDE_SUBAGENT_TYPE="" + intake never invoked → ALLOW (env unset semantics)', () => {
  // Empty-string env var must behave the same as unset: bareRole('') !== 'chief-orchestrator'.
  const { dir, file } = writeTranscript('env-empty', [userLine('hi')]);
  const out = runHook(file, { env: { CLAUDE_SUBAGENT_TYPE: '' } });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLAUDE_SUBAGENT_TYPE="   " + intake never invoked → ALLOW (whitespace-only env value treated as not-chief)', () => {
  // The hook does NOT trim/normalize CLAUDE_SUBAGENT_TYPE before comparison —
  // a whitespace-only value just doesn't equal "chief-orchestrator" and so
  // bypasses the env-fallback scoping. If a real injection ever produced
  // "  chief-orchestrator  " we'd want it to fail loudly, not be silently
  // normalized; this test pins down the no-trim contract.
  const { dir, file } = writeTranscript('env-whitespace', [userLine('hi')]);
  const out = runHook(file, { env: { CLAUDE_SUBAGENT_TYPE: '   ' } });
  assert.strictEqual(out.status, 0, out.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('chief out-of-artifact Edit + intake invoked + execute-path complete still BLOCKs', () => {
  // Out-of-artifact write check overrides the otherwise-legitimate execute
  // path. Even if everything else is fine, consumer-repo edits by chief are
  // a protocol violation.
  const { root, proj, dir, file } = makeOutOfArtifactWriteScenario('override-allow');
  const out = runHook(file, { cwd: proj });
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /outside the artifact root/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('chief Edit on path UNDER artifact root → ALLOW (artifact maintenance is fine)', () => {
  const { root, proj, taskDir } = makeProject('artifact-edit-ok', {
    implContent: 'impl-summary: ok\n',
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
  const taskDataPath = path.join(taskDir, 'task-data.md');
  const artifactEdit = {
    type: 'tool_use',
    name: 'Edit',
    input: {
      file_path: path.join(taskDir, 'orchestration-state.json'),
      old_string: 'a',
      new_string: 'b',
    },
  };
  const parts = [
    userLine('/ai-agents-workflow:task'),
    assistantToolUse([intakeSkillUse(), askUserQuestionUse()]),
    assistantToolUse([taskDataWrite('execution-trivial', taskDataPath)]),
    assistantToolUse([artifactEdit]),
    assistantToolUse([taskDispatch('executor')]),
    assistantToolUse([taskDispatch('reviewer')]),
  ];
  const { dir, file } = writeTranscript('artifact-edit-ok', parts);
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

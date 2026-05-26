#!/usr/bin/env node
/**
 * SubagentStop hook: guard-reviewer-stop (blocking)
 *
 * Purpose
 * -------
 * The Reviewer subagent's role contract (agents/reviewer.md) mandates a
 * three-step write order, with the LAST action being "finalize summary.md
 * with actual verdict". When the Reviewer hits a context limit, errors,
 * or simply forgets the final step, summary.md is left in skeleton form
 * with `review_verdict: pending`. Downstream P2/P4 gates then see a stale
 * pending verdict, the orchestrator can't decide whether the subtask
 * passed, and `validate-artifact-chain.js`'s drift checks fail far from
 * the actual cause.
 *
 * This hook closes the loop: at Reviewer SubagentStop, verify that the
 * current subtask's `summary.md` has a non-`pending` `review_verdict`.
 *
 * Scoping
 * -------
 * Triggers ONLY when `CLAUDE_SUBAGENT_TYPE` resolves to `reviewer`. For any
 * other subagent (including chief, which has its own stop guard), exit 0.
 * Cannot use transcript-based scoping like guard-chief-orchestrator-stop
 * because the Reviewer's tool footprint is not uniquely identifying —
 * Read/Grep/Edit/Write/Skill calls overlap with every other role.
 *
 * Failure-open
 * ------------
 * Any unresolved signal (no env var, no payload, no artifact root, no
 * current_subtask in state, no summary.md, malformed verdict, etc.) exits
 * 0 with optional debug. The hook can ONLY block when it positively
 * identifies a stale `pending` verdict in a sibling summary.md — false
 * positives must be impossible. Other downstream validators
 * (`validate-artifact-chain.js`'s drift / population checks) catch shapes
 * this hook can't see.
 *
 * Exit semantics
 *   0 — allow
 *   2 — block (stderr carries the actionable message)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveArtifactRoot } = require('./lib/artifact-root');
const { bareRole, mostRecentTaskDir } = require('./lib/active-task');
const { findSubtaskSummary } = require('./lib/find-subtask-summary');

// --- Stdin payload (best-effort) ---

function readStdinSync() {
  try {
    const stat = fs.fstatSync(0);
    if (stat && stat.isCharacterDevice() && process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

let payload = {};
const stdinRaw = readStdinSync();
if (stdinRaw) {
  try {
    payload = JSON.parse(stdinRaw);
  } catch (_) {
    payload = {};
  }
}

// Avoid recursion if Claude Code re-fires after a block.
if (payload && payload.stop_hook_active === true) {
  process.exit(0);
}

// --- Scope to Reviewer only ---

const subagentType = bareRole(process.env.CLAUDE_SUBAGENT_TYPE || '');
if (subagentType !== 'reviewer') {
  process.exit(0);
}

// --- Resolve artifact root + most recent task + current subtask ---

const ARTIFACT = resolveArtifactRoot();
if (!ARTIFACT.root) {
  // No artifact root — nothing we can validate. Failure-open.
  process.exit(0);
}

const tasksRoot = path.join(ARTIFACT.root, 'tasks');
if (!fs.existsSync(tasksRoot)) {
  process.exit(0);
}

const recentTaskId = mostRecentTaskDir(tasksRoot, 'state');
if (!recentTaskId) {
  process.exit(0);
}

const taskDir = path.join(tasksRoot, recentTaskId);
const statePath = path.join(taskDir, 'orchestration-state.json');
if (!fs.existsSync(statePath)) {
  process.exit(0);
}

let state;
try {
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
} catch (_) {
  process.exit(0);
}

const subtaskId =
  state && typeof state.current_subtask === 'string' && state.current_subtask.length > 0
    ? state.current_subtask
    : null;

if (!subtaskId) {
  // Reviewer ran but no current subtask is tracked — likely a degraded path
  // or a hand-off already finalized. Don't block.
  process.exit(0);
}

// --- Locate the subtask's summary.md ---

const summaryPath = findSubtaskSummary(taskDir, subtaskId);
if (!summaryPath) {
  // No summary.md to validate. validate-artifact-chain catches the
  // "review section populated but summary.md missing" case separately;
  // this hook stays narrow.
  process.exit(0);
}

// --- Extract review_verdict from Status section ---
//
// Canonical shape (per ARTIFACT_DISCIPLINE.md → minimum-summary-schema):
//   ## Status
//   - **workflow_state**: <...>
//   - **review_verdict**: <pending | approved | changes_requested | needs-replan>

let summaryText;
try {
  summaryText = fs.readFileSync(summaryPath, 'utf8');
} catch (_) {
  process.exit(0);
}

const verdictMatch = summaryText.match(
  /^[ \t]*-\s*\*\*review_verdict\*\*:\s*([A-Za-z0-9_-]+)/im,
);
const verdict = verdictMatch ? verdictMatch[1].toLowerCase() : null;

const VALID_TERMINAL_VERDICTS = new Set([
  'approved',
  'changes_requested',
  'changes-requested',
  'needs-replan',
  'needs_replan',
]);

// `pending` (the skeleton default) is the canonical fail state. A missing
// field is treated the same — Reviewer must explicitly write a value.
const isStale = verdict === null || verdict === 'pending';

if (!isStale && VALID_TERMINAL_VERDICTS.has(verdict)) {
  process.exit(0);
}

// If verdict is something unrecognised (e.g. a typo like "approvedz"), we
// don't block — the artifact-chain validator's drift checks own that
// surface. But emit a warn-level hook-log entry so the typo is auditable
// post-session instead of silently passing.
if (!isStale) {
  try {
    const hookLog = require('./lib/hook-log');
    hookLog.append({
      taskId: recentTaskId,
      hook: 'guard-reviewer-stop',
      decision: 'warn',
      reason: `unrecognised review_verdict=${JSON.stringify(verdict)} (allowed: approved | changes_requested | needs-replan); not blocking — artifact-chain drift check owns this surface`,
    });
  } catch (_e) {}
  process.exit(0);
}

const relSummary = path.relative(process.cwd(), summaryPath) || summaryPath;

// Best-effort hook-log.
try {
  const hookLog = require('./lib/hook-log');
  hookLog.append({
    taskId: recentTaskId,
    hook: 'guard-reviewer-stop',
    decision: 'block',
    reason: `reviewer returned with review_verdict=${JSON.stringify(verdict)} in ${relSummary}`,
  });
} catch (_e) {}

process.stderr.write(
  `[guard-reviewer-stop] BLOCKED: Reviewer is returning but the subtask summary.md still has ` +
    `review_verdict=${JSON.stringify(verdict)} (skeleton default).\n` +
    `Subtask: ${subtaskId}\n` +
    `Summary: ${relSummary}\n` +
    `\n` +
    `The Reviewer's role contract (agents/reviewer.md → role-contract:reviewer) requires ` +
    `the LAST write to be summary.md finalization, including:\n` +
    `  - Status fields populated: workflow_state, review_verdict (one of: approved, ` +
    `changes_requested, needs-replan), cycle_count.\n` +
    `  - Telemetry / Dispatch Bundles / Context Manifest sections populated.\n` +
    `  - Files Changed / Acceptance Signals / Notes filled in.\n` +
    `\n` +
    `Resolution: BEFORE returning, append the Cycle N review block to ai-work.md AND ` +
    `finalize summary.md with a non-pending review_verdict. If you ran out of context budget, ` +
    `write summary.md with review_verdict="changes_requested" + a single review-finding noting ` +
    `the partial-review state, rather than leaving the verdict pending — that keeps the ` +
    `orchestrator able to route the next cycle.\n`,
);
process.exit(2);

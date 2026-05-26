'use strict';

/**
 * Locate a subtask's summary.md given the task directory and subtask id.
 *
 * Layouts handled (in order):
 *   1. <task_dir>/<subtask_id>/summary.md            — flat (single-phase tasks)
 *   2. <task_dir>/phase-<id>/<subtask_id>/summary.md — multi-phase tasks
 *
 * Bounded depth (no recursion past `phase-*` siblings) keeps this fast and
 * predictable when called from PostToolUse / SubagentStop hooks. Returns the
 * absolute path or null when no summary.md exists.
 *
 * Shared by `validate-orchestration-state-write.js` (C7 invariant) and
 * `guard-reviewer-stop.js` (Reviewer-stop verdict check). The shape is
 * identical, so both must read it the same way; centralising avoids
 * silent drift.
 */

const fs = require('fs');
const path = require('path');

function findSubtaskSummary(taskDir, subtaskId) {
  if (!taskDir || !subtaskId || typeof subtaskId !== 'string') return null;
  const direct = path.join(taskDir, subtaskId, 'summary.md');
  if (fs.existsSync(direct)) return direct;
  let entries;
  try {
    entries = fs.readdirSync(taskDir, { withFileTypes: true });
  } catch (_e) {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith('phase-')) continue;
    const candidate = path.join(taskDir, e.name, subtaskId, 'summary.md');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

module.exports = { findSubtaskSummary };

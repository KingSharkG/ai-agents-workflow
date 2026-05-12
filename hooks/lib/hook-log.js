/**
 * Shared helper for appending hook outcomes to `<artifact-root>/tasks/<task_id>/hooks.log`.
 *
 * Used by:
 *   - hooks/validate-orchestration-state-write.js (per-WARN audit line)
 *   - any future guard/validator that wants to leave a durable trace
 *
 * Design contract:
 *   - **Append-only.** Each call writes a single line; never reads or rewrites.
 *   - **Best-effort.** Any I/O error is swallowed silently — hook-logging
 *     failure must never break the hook itself. The point is observability,
 *     not enforcement.
 *   - **Resolver-rooted.** Path is derived from `resolveArtifactRoot()` + the
 *     parsed task_id. If either is missing, the call is a no-op.
 *   - **Line format.** `<ISO-8601 UTC> | <hook> | <decision> | <reason>`.
 *     Decision is a short tag (`pass | warn | block`); reason is a one-line
 *     summary (newlines stripped to keep the log greppable).
 *
 * Why a shared lib instead of per-hook ad-hoc writes:
 *   Several hooks (validate-summary-telemetry, validate-artifact-chain, the
 *   new validate-orchestration-state-write) emit WARN lines to stderr. Stderr
 *   is fine for the harness's live diagnostics view but is not persisted in
 *   the artifact tree, so retrospectives and resume runs lose the signal. A
 *   single shared appender lets any hook opt into durable logging in two
 *   lines of code: `require('./lib/hook-log').append({...})`.
 *
 * NOT a replacement for the hook's stderr message — both happen. The
 * stderr message stays visible at run time; the hooks.log line stays
 * available for later forensics.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveArtifactRoot, canonicalize } = require('./artifact-root');

/**
 * Extract `task_id` from an arbitrary path under `<artifact-root>/tasks/<task_id>/...`.
 * Returns null if `filePath` does not sit under the resolved tasks root.
 *
 * Kept here (not in artifact-root.js) because it's specific to per-task
 * logging and the broader resolver doesn't need to know about task IDs.
 */
function taskIdFromFilePath(filePath) {
  if (!filePath) return null;
  const ARTIFACT = resolveArtifactRoot();
  if (!ARTIFACT.root) return null;
  // Canonicalize BOTH sides — macOS resolves /var → /private/var via realpath,
  // and a startsWith check between a canonicalized root and a non-canonicalized
  // path would silently fail. Mirror the pattern used by the main hook in
  // validate-orchestration-state-write.js + validate-summary-telemetry.js.
  const tasksRoot = canonicalize(path.join(ARTIFACT.root, 'tasks'));
  const canonicalTarget = canonicalize(path.resolve(filePath));
  if (!canonicalTarget.startsWith(tasksRoot + path.sep)) return null;
  const rel = canonicalTarget.slice(tasksRoot.length + 1);
  const first = rel.split(path.sep)[0];
  if (!first) return null;
  return first;
}

/**
 * Append one line to `<artifact-root>/tasks/<task_id>/hooks.log`.
 *
 * @param {object} opts
 * @param {string} opts.taskId    - Required. The task id segment of the path.
 * @param {string} opts.hook      - Hook script basename, e.g. "validate-orchestration-state-write".
 * @param {string} opts.decision  - Short tag: "pass" | "warn" | "block".
 * @param {string} opts.reason    - One-line summary; newlines are stripped.
 * @returns {boolean}             - true if the line was written, false otherwise.
 */
function append(opts) {
  const { taskId, hook, decision, reason } = opts || {};
  if (!taskId || !hook || !decision) return false;

  const ARTIFACT = resolveArtifactRoot();
  if (!ARTIFACT.root) return false;

  const logPath = path.join(ARTIFACT.root, 'tasks', taskId, 'hooks.log');
  const ts = new Date().toISOString();
  // Strip newlines / tabs / pipe collisions so the file stays one-line-per-event.
  const flatReason = String(reason || '').replace(/[\r\n\t]+/g, ' ').replace(/\|/g, '/').trim();
  const line = `${ts} | ${hook} | ${decision} | ${flatReason}\n`;

  try {
    // Ensure the directory exists; the task dir is normally already there but
    // some early-life hook calls may fire before it's created.
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line, { encoding: 'utf8' });
    return true;
  } catch (_e) {
    // Logging is best-effort; never throw from a hook.
    return false;
  }
}

module.exports = { append, taskIdFromFilePath };

/**
 * Shared helpers for resolving the "active task" from hook context.
 *
 * Used by:
 *   - hooks/pre-task-guard.js          (Task-matcher hook; uses parseTaskIdFromPrompt + taskPrefixFor + mostRecentTaskDir(_, 'state'))
 *   - hooks/guard-orchestrator-step0.js (Edit/Write/Task-matcher hook; uses bareRole + parseTaskIdFromPrompt + mostRecentTaskDir(_, 'dir'))
 *   - hooks/guard-chief-orchestrator-stop.js (SubagentStop; uses bareRole + mostRecentTaskDir(_, 'state'))
 *
 * Kept tiny and dependency-free so adding callers does not bloat hook startup.
 *
 * Task-id formats recognized in prompts:
 *   - Compound: "AAA-BBB-123"     (≥2-char alpha + dash + ≥2-char alphanumeric + dash + digits)
 *   - Plain:    "AAA-123"         (≥2-char alpha + dash + digits)
 *
 * Per-function semantics live in each function's JSDoc below.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Strip plugin namespace from a subagent identifier.
 *   "ai-agents-workflow:chief-orchestrator" → "chief-orchestrator"
 *   "executor"                              → "executor"
 *   ""                                      → ""
 */
function bareRole(id) {
  if (!id) return '';
  return id.includes(':') ? id.split(':').pop() : id;
}

function parseTaskIdFromPrompt(p) {
  if (!p) return null;
  return (
    p.match(/\b([A-Z]{2,}-[A-Z0-9]+-\d+)\b/) ||
    p.match(/\b([A-Z]{2,}-\d+)\b/)
  )?.[1] || null;
}

function taskPrefixFor(id) {
  if (!id) return null;
  const segs = id.split('-');
  return segs.length >= 3 ? segs.slice(0, 2).join('-') : id;
}

/**
 * Walk one level under `tasksRoot` and pick the directory with the newest
 * mtime according to `mode`:
 *   - mode="state"  — only consider dirs containing orchestration-state.json,
 *                     and rank by that file's mtime. Used by pre-task-guard
 *                     and the stop hook's task-id resolution.
 *   - mode="dir"    — consider any directory and rank by the directory's own
 *                     mtime. Used by guard-orchestrator-step0 during the
 *                     intake stage when the state file may not yet exist.
 *
 * Tied mtimes resolve deterministically: the lexically larger directory name
 * wins so different filesystems / readdir orderings produce the same answer.
 *
 * Returns null when `tasksRoot` is missing/unreadable, when there are no
 * directories, or (mode="state") when no directory contains the state file.
 *
 * Contract: an unknown `mode` value throws an Error. This is the contract,
 * not a defensive bonus — typos like `'stat'` would otherwise silently behave
 * like `'dir'`, hiding bugs. All current callers pass static literals so the
 * throw cannot fire at runtime today; any future caller deriving `mode` from
 * config or env MUST validate before passing.
 */
// Filename of the optional recent-task index. Maintained at
// `<tasksRoot>/.recent` and read by mostRecentTaskDir() to skip the
// readdir+per-entry-stat fallback. The index is best-effort: any read or
// write failure falls back to the directory walk so behaviour stays
// correct even when the index is missing or stale.
const RECENT_INDEX_FILENAME = '.recent';

function readRecentIndex(tasksRoot, mode) {
  const indexPath = path.join(tasksRoot, RECENT_INDEX_FILENAME);
  let raw;
  try {
    raw = fs.readFileSync(indexPath, 'utf8');
  } catch (_) {
    return null;
  }
  // The index is a tiny JSON document: { state: "<id>", dir: "<id>" }.
  // Fields are independent because each `mode` ranks dirs by a different
  // mtime (state-file mtime vs dir mtime), so the most-recent answer can
  // diverge between modes within the same task root.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const id = parsed[mode];
  if (typeof id !== 'string' || !id) return null;
  // Verify the candidate dir still exists and (for `state` mode) still has
  // the state file. Stale indices recover gracefully via the fallback walk.
  const dirPath = path.join(tasksRoot, id);
  try {
    if (!fs.statSync(dirPath).isDirectory()) return null;
    if (mode === 'state' && !fs.existsSync(path.join(dirPath, 'orchestration-state.json'))) {
      return null;
    }
  } catch (_) {
    return null;
  }
  return id;
}

/**
 * Write or update the recent-task index. Called by validate-artifact-chain
 * after every legitimate `orchestration-state.json` write so subsequent
 * mostRecentTaskDir() calls hit the index instead of walking the tasks
 * directory. Best-effort: any failure is swallowed (the worst that happens
 * is the next mostRecentTaskDir() call falls back to the readdir walk).
 *
 * `mode` ('state' | 'dir') selects which field is updated. The two fields
 * are independent because each `mostRecentTaskDir` mode ranks by a
 * different mtime — a state-file write only freshens the state-mode answer;
 * the dir-mode answer can legitimately point at a different task whose
 * directory mtime was bumped by a sibling file (ai-work.md, summary.md).
 * Updating both unconditionally would let a state write silently override
 * a dir-mode answer that hasn't actually changed.
 *
 * Defaults to mode='state' for the validate-artifact-chain caller, which
 * is the only invocation site today.
 */
function writeRecentIndex(tasksRoot, taskId, mode = 'state') {
  if (mode !== 'state' && mode !== 'dir') {
    throw new Error(
      `writeRecentIndex: unknown mode "${mode}". Expected "state" or "dir".`,
    );
  }
  if (!tasksRoot || !taskId) return;
  const indexPath = path.join(tasksRoot, RECENT_INDEX_FILENAME);
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(indexPath, 'utf8')) || {};
    if (typeof current !== 'object') current = {};
  } catch (_) {
    current = {};
  }
  current[mode] = taskId;
  current.updated_at = new Date().toISOString();
  try {
    fs.writeFileSync(indexPath, JSON.stringify(current));
  } catch (_) {}
}

function mostRecentTaskDir(tasksRoot, mode = 'state') {
  if (mode !== 'state' && mode !== 'dir') {
    throw new Error(
      `mostRecentTaskDir: unknown mode "${mode}". Expected "state" or "dir".`,
    );
  }
  if (!tasksRoot || !fs.existsSync(tasksRoot)) return null;
  // Fast path: consult the recent-task index. Falls through to the walk
  // when the index is missing, malformed, or points at a stale entry.
  const indexed = readRecentIndex(tasksRoot, mode);
  if (indexed) return indexed;
  let entries;
  try {
    entries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  let best = null;
  let bestMtime = -Infinity;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(tasksRoot, entry.name);
    let mtime;
    try {
      if (mode === 'state') {
        const statePath = path.join(dirPath, 'orchestration-state.json');
        if (!fs.existsSync(statePath)) continue;
        mtime = fs.statSync(statePath).mtimeMs;
      } else {
        mtime = fs.statSync(dirPath).mtimeMs;
      }
    } catch (_) {
      continue;
    }
    if (mtime > bestMtime || (mtime === bestMtime && best !== null && entry.name > best)) {
      bestMtime = mtime;
      best = entry.name;
    }
  }
  return best;
}

/**
 * Extract the text of the first `user`-role entry in a parsed JSONL transcript.
 * In Claude Code subagent transcripts the first user entry corresponds to the
 * `prompt` field passed to the Task tool — i.e. the dispatching agent's
 * description of the work to do. Useful for scoping content scans (e.g. for
 * sentinel markers like `[E2E_AUTO_APPROVE_MODE]`) to the originating prompt
 * rather than the entire transcript, which would false-positive on tool
 * results that happen to quote the marker.
 *
 * `entries` is an array of already-parsed JSONL objects (one per line).
 * Returns the concatenated text content of that first user entry, or an
 * empty string when there is no user entry or its content is unrecognized.
 *
 * Content shape tolerance matches the rest of the hook code: handles both
 * `{message: {role, content}}` and flat `{role, content}` entries, and
 * `content` as either a string or an array of `{type, text}` parts.
 */
function firstUserPromptText(entries) {
  if (!Array.isArray(entries)) return '';
  for (const entry of entries) {
    if (!entry) continue;
    const role =
      (entry.message && entry.message.role) || entry.role || entry.type || null;
    if (role !== 'user') continue;
    const content =
      (entry.message && entry.message.content) || entry.content || '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part.text === 'string') return part.text;
          return '';
        })
        .join('\n');
    }
    return '';
  }
  return '';
}

/**
 * True when a parsed orchestration-state.json classifies the task as
 * `execution-trivial`. Trivial tasks follow the compressed flow (skip
 * Delivery PM + P1 + Lead, single subtask, optional P4) and therefore are
 * permitted to ship a minimal task summary.md instead of the canonical
 * multi-section template required by larger flows.
 *
 * Returns false for any non-object input or any other classification value
 * (including missing classification, which means we can't prove triviality).
 */
function isTrivialClassification(state) {
  return !!(state && typeof state === 'object' && state.classification === 'execution-trivial');
}

module.exports = {
  bareRole,
  parseTaskIdFromPrompt,
  taskPrefixFor,
  mostRecentTaskDir,
  firstUserPromptText,
  isTrivialClassification,
  writeRecentIndex,
  RECENT_INDEX_FILENAME,
};

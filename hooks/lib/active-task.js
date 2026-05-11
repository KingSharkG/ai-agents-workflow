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
function mostRecentTaskDir(tasksRoot, mode = 'state') {
  if (mode !== 'state' && mode !== 'dir') {
    throw new Error(
      `mostRecentTaskDir: unknown mode "${mode}". Expected "state" or "dir".`,
    );
  }
  if (!tasksRoot || !fs.existsSync(tasksRoot)) return null;
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

module.exports = {
  bareRole,
  parseTaskIdFromPrompt,
  taskPrefixFor,
  mostRecentTaskDir,
  firstUserPromptText,
};

'use strict';

/**
 * Shared plan-mode detection used by `pre-task-guard.js` Phase 0.
 *
 * Claude Code's native plan mode injects a literal "Plan mode is active"
 * banner into the system-reminder block of every assistant turn while it's
 * on. The banner disappears the moment plan mode is exited (Shift+Tab).
 *
 * `isPlanModeActiveForTranscript(transcriptPath)` reads the JSONL transcript
 * at the given path and returns `true` iff the banner appears anywhere in
 * the most-recent user/system block (i.e., the block leading into the
 * upcoming assistant turn). Scanning is intentionally narrow — scanning from
 * the start of the transcript would catch stale banners from earlier turns.
 *
 * All failure modes (missing path, unreadable file, malformed JSONL, no
 * assistant turn yet) return `false` — the caller fails open. The hook never
 * blocks on uncertainty about its own inputs.
 */

const fs = require('fs');

const PLAN_MODE_BANNER = 'Plan mode is active';

function extractText(content) {
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

function entryText(entry) {
  const content =
    (entry.message && entry.message.content) || entry.content || '';
  return extractText(content);
}

function isPlanModeActiveForTranscript(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return false;

  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  } catch (_) {
    return false;
  }

  let lastUserIndex = -1;
  let lastAssistantIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch (_) {
      continue;
    }
    const role =
      (entry.message && entry.message.role) ||
      entry.role ||
      entry.type ||
      null;
    if (role === 'assistant' && lastAssistantIndex === -1) {
      lastAssistantIndex = i;
    }
    if (role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  if (lastAssistantIndex === -1) return false;

  const scanStart =
    lastUserIndex !== -1 ? lastUserIndex : Math.max(lastAssistantIndex, 0);
  for (let i = scanStart; i < lines.length; i++) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch (_) {
      continue;
    }
    if (entryText(entry).includes(PLAN_MODE_BANNER)) return true;
  }
  return false;
}

module.exports = { isPlanModeActiveForTranscript, PLAN_MODE_BANNER };

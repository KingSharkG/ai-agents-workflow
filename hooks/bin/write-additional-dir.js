#!/usr/bin/env node
/**
 * Helper: merge a directory entry into <cwd>/.claude/settings.local.json →
 * permissions.additionalDirectories[].
 *
 * Intended for the init agent's sibling-layout setup: writing the one
 * permission grant Claude Code needs to access an out-of-tree artifact root.
 *
 * Behavior:
 *   - Reads the existing settings.local.json if present, else starts from {}.
 *   - Preserves every other key untouched (including unrelated permissions).
 *   - Appends the directory to permissions.additionalDirectories[] only if not
 *     already present (string equality).
 *   - Writes atomically via temp-file + rename.
 *   - Prints a one-line summary on stdout: "added <dir>" or "noop <dir>".
 *
 * Never touches .claude/settings.json (the committed file).
 *
 * Usage:
 *   node hooks/bin/write-additional-dir.js <dir>
 *
 * Exit codes:
 *   0 — success (added or noop)
 *   1 — usage error or filesystem failure
 */

'use strict';

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: write-additional-dir.js <directory>');
  process.exit(1);
}

const cwd = process.cwd();
const claudeDir = path.join(cwd, '.claude');
const settingsPath = path.join(claudeDir, 'settings.local.json');

try {
  fs.mkdirSync(claudeDir, { recursive: true });
} catch (e) {
  console.error(`Could not create ${claudeDir}: ${e.message}`);
  process.exit(1);
}

let settings = {};
if (fs.existsSync(settingsPath)) {
  let raw;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch (e) {
    console.error(`Could not read ${settingsPath}: ${e.message}`);
    process.exit(1);
  }
  if (raw.trim() === '') {
    settings = {};
  } else {
    try {
      settings = JSON.parse(raw);
      if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
        console.error(
          `${settingsPath} is not a JSON object (got ${Array.isArray(settings) ? 'array' : typeof settings}). Refusing to overwrite.`,
        );
        process.exit(1);
      }
    } catch (e) {
      console.error(`${settingsPath} is malformed JSON — ${e.message}. Refusing to overwrite.`);
      process.exit(1);
    }
  }
}

if (!settings.permissions || typeof settings.permissions !== 'object' || Array.isArray(settings.permissions)) {
  settings.permissions = {};
}
if (!Array.isArray(settings.permissions.additionalDirectories)) {
  settings.permissions.additionalDirectories = [];
}

const list = settings.permissions.additionalDirectories;
const already = list.includes(dir);
let action;
if (already) {
  action = 'noop';
} else {
  list.push(dir);
  action = 'added';
}

const serialized = JSON.stringify(settings, null, 2) + '\n';
const tmpPath = `${settingsPath}.tmp.${process.pid}`;
try {
  fs.writeFileSync(tmpPath, serialized, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, settingsPath);
} catch (e) {
  // Best-effort cleanup of the temp file; surface any failure so an orphan
  // is not silent.
  try {
    fs.unlinkSync(tmpPath);
  } catch (cleanupErr) {
    if (cleanupErr.code !== 'ENOENT') {
      console.error(
        `Warning: could not remove orphan temp file ${tmpPath}: ${cleanupErr.message}`,
      );
    }
  }
  console.error(`Could not write ${settingsPath}: ${e.message}`);
  process.exit(1);
}

process.stdout.write(`${action} ${dir}\n`);
process.exit(0);

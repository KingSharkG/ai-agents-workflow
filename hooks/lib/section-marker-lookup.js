#!/usr/bin/env node
/**
 * Section-marker registry lookup helper.
 *
 * Used by .claude/commands/e2e-regression.sh check 8 (registry sync).
 * Given a marker name and the path to ai/core/SECTION_MARKERS.md, prints one
 * of:
 *   OK      — marker is registered (literal, templated, or slash-list form)
 *   MISSING — marker is not registered in any recognized form
 *
 * Inputs (env vars rather than argv to avoid shell quoting headaches):
 *   REGISTRY_FILE — absolute path to SECTION_MARKERS.md
 *   MARKER        — marker name (without the `<!-- section:` / `-->` wrapper)
 *
 * Recognized registered forms:
 *   1. Literal `marker` backticked anywhere in the registry.
 *   2. Template form: registry has `<marker>-<id>` or similar — check for
 *      "`<marker>-<" as backticked text.
 *   3. Slash-list form: registry has `<base>-a/b/c` and marker is one of
 *      `<base>-a`, `<base>-b`, `<base>-c`.
 */

'use strict';

const fs = require('fs');

const file = process.env.REGISTRY_FILE;
const marker = process.env.MARKER;

if (!file || !marker) {
  console.log('ERR');
  process.exit(0);
}

let registry;
try {
  registry = fs.readFileSync(file, 'utf8');
} catch (_) {
  console.log('ERR');
  process.exit(0);
}

// (1) Literal backticked entry.
if (registry.includes('`' + marker + '`')) {
  console.log('OK');
  process.exit(0);
}

// (2) Template-start: `marker-<id>`, `marker-<n>`, etc. We only need to find
//     `marker-<` as backticked text — everything after the `<` is template
//     metadata and we don't care about the exact placeholder.
if (registry.includes('`' + marker + '-<')) {
  console.log('OK');
  process.exit(0);
}

// (3) Slash-list form. Registry expresses `<base>-a/b/c` to mean three
//     markers: `<base>-a`, `<base>-b`, `<base>-c`. If the input marker has
//     the shape `<base>-<single-or-multi-char-suffix>`, look for any
//     backticked slash-list under `<base>-` that contains our suffix.
const dash = marker.lastIndexOf('-');
if (dash > 0) {
  const base = marker.slice(0, dash);
  const suffix = marker.slice(dash + 1);
  // Build a regex that matches a backticked slash-list under base-:
  // `base-FOO/BAR/BAZ` (no spaces inside the backticks).
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const slashRe = new RegExp('`' + escapedBase + '-([a-z0-9]+(?:/[a-z0-9]+)+)`');
  const m = registry.match(slashRe);
  if (m) {
    const parts = m[1].split('/');
    if (parts.includes(suffix)) {
      console.log('OK');
      process.exit(0);
    }
  }
}

console.log('MISSING');

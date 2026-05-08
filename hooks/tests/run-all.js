#!/usr/bin/env node
/**
 * Aggregate runner for every *.test.js file in this directory.
 *
 * Run:
 *   node hooks/tests/run-all.js                # unit tests only (default)
 *   node hooks/tests/run-all.js --include-e2e  # + e2e/*.assert.js scenarios
 *
 * Each suite is spawned as its own Node subprocess (so module-level state
 * stays isolated) and its stdout/stderr are streamed live. The runner exits
 * non-zero if ANY suite exits non-zero. Output ends with a totals line.
 *
 * E2E tests live under hooks/tests/e2e/<scenario>.assert.js. Each one is a
 * standalone Node script that scaffolds a sandbox project, runs an end-to-end
 * scenario, and asserts the artifact tree matches expectations. They are
 * slower than unit tests and therefore opt-in via --include-e2e.
 *
 * Zero dependencies (Node built-ins only). No reliance on a test framework.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const includeE2e = process.argv.includes('--include-e2e');

const TESTS_DIR = __dirname;
const E2E_DIR = path.join(TESTS_DIR, 'e2e');

const suites = fs
  .readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

if (includeE2e && fs.existsSync(E2E_DIR)) {
  const e2eSuites = fs
    .readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.assert.js'))
    .sort()
    .map((f) => path.join('e2e', f));
  suites.push(...e2eSuites);
}

if (suites.length === 0) {
  process.stderr.write('No *.test.js files found in hooks/tests/.\n');
  process.exit(1);
}

let totalPassed = 0;
let totalFailed = 0;
let totalCases = 0;
let failedSuites = [];

for (const suite of suites) {
  const suitePath = path.join(TESTS_DIR, suite);
  process.stdout.write(`\n=== ${suite} ===\n`);

  const result = spawnSync(process.execPath, [suitePath], {
    encoding: 'utf8',
  });

  process.stdout.write(result.stdout || '');
  if (result.stderr) process.stderr.write(result.stderr);

  // Parse the suite's totals line. Accept either:
  //   "<n> passed, <n> failed (<n> total)"   (preferred)
  //   "<n> passed, <n> failed"               (older form; total = passed+failed)
  // Single source of truth for the contract — no need to update every test
  // file when the format expands.
  //
  // Both regexes anchor on end-of-line (`$` with the `m` flag) so a future
  // line like "5 passed, 0 failed (3 of 5 skipped)" doesn't partial-match
  // either pattern and report wrong totals. The trailing `\s*$` tolerates
  // trailing whitespace before EOL — defensive, not redundant. If neither
  // anchored regex matches, we fall through to the "no totals line"
  // diagnostic below.
  const stdout = result.stdout || '';
  const match =
    stdout.match(/^(\d+)\s+passed,\s+(\d+)\s+failed\s+\((\d+)\s+total\)\s*$/m) ||
    stdout.match(/^(\d+)\s+passed,\s+(\d+)\s+failed\s*$/m);
  if (match) {
    const passed = parseInt(match[1], 10);
    const failed = parseInt(match[2], 10);
    totalPassed += passed;
    totalFailed += failed;
    totalCases += match[3] !== undefined ? parseInt(match[3], 10) : passed + failed;
  } else {
    // Suite didn't print a recognizable totals line — count it as a failure.
    totalFailed += 1;
    totalCases += 1;
    failedSuites.push(`${suite} (no totals line)`);
  }

  if (result.status !== 0) {
    if (!failedSuites.includes(suite)) failedSuites.push(suite);
  }
}

process.stdout.write('\n========================================\n');
process.stdout.write(
  `Total: ${totalPassed} passed, ${totalFailed} failed (${totalCases} cases across ${suites.length} suites)\n`,
);
if (failedSuites.length > 0) {
  process.stdout.write(`Failing suites: ${failedSuites.join(', ')}\n`);
}

process.exit(totalFailed === 0 ? 0 : 1);

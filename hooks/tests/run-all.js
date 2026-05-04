#!/usr/bin/env node
/**
 * Aggregate runner for every *.test.js file in this directory.
 *
 * Run:
 *   node hooks/tests/run-all.js
 *
 * Each suite is spawned as its own Node subprocess (so module-level state
 * stays isolated) and its stdout/stderr are streamed live. The runner exits
 * non-zero if ANY suite exits non-zero. Output ends with a totals line.
 *
 * Zero dependencies (Node built-ins only). No reliance on a test framework.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS_DIR = __dirname;
const suites = fs
  .readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

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

  // Parse the suite's totals line: "<n> passed, <n> failed (<n> total)"
  const match = (result.stdout || '').match(
    /(\d+)\s+passed,\s+(\d+)\s+failed\s+\((\d+)\s+total\)/,
  );
  if (match) {
    totalPassed += parseInt(match[1], 10);
    totalFailed += parseInt(match[2], 10);
    totalCases += parseInt(match[3], 10);
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

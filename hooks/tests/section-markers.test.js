#!/usr/bin/env node
/**
 * Tests for ai/core/section-markers.json — the machine-readable sidecar to
 * SECTION_MARKERS.md. The file is currently a stub (`_status: "stub"`,
 * `markers: []`); these tests pin down its shape so consumers can rely on it
 * the moment Step 0 of the migration plan lands.
 *
 * Run:
 *   node hooks/tests/section-markers.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', '..', 'ai', 'core', 'section-markers.json');

// Read + parse once at module scope; tests reuse `data`. The raw text is also
// cached for the JSON-validity test (which exercises the parse path itself).
const RAW = fs.readFileSync(FILE, 'utf8');
let data;
try {
  data = JSON.parse(RAW);
} catch (_) {
  data = null; // surfaces via the "valid JSON" test below
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('section-markers.json exists', () => {
  assert.ok(fs.existsSync(FILE), `expected file at ${FILE}`);
});

test('section-markers.json is valid JSON', () => {
  assert.doesNotThrow(() => JSON.parse(RAW));
});

test('section-markers.json has the expected stub shape', () => {
  assert.ok(data, 'parse must succeed for shape checks to be meaningful');
  assert.strictEqual(data._status, 'stub', '_status sentinel must be "stub" until Step 0 lands');
  assert.ok(typeof data._status_doc === 'string', '_status_doc must explain the stub state');
  assert.ok(typeof data._schema_doc === 'string', '_schema_doc must describe the file purpose');
  assert.ok(
    data._field_descriptions && typeof data._field_descriptions === 'object',
    '_field_descriptions must be an object describing field shapes',
  );
  assert.ok(Array.isArray(data.markers), 'markers must be an array');
});

test('stub markers[] is empty (populating it is Step 0 of the migration)', () => {
  assert.strictEqual(data.markers.length, 0, 'stub markers[] must be empty until populated');
});

test('does NOT use reserved JSON Schema "$schema" key', () => {
  // JSON Schema convention reserves $schema for a meta-schema URL. Using it
  // for inline documentation confuses ajv / VS Code IntelliSense / similar
  // tooling. We use `_field_descriptions` instead.
  //
  // STICKY CONTRACT: this test pins down "no $schema key today". If a real
  // meta-schema URL is later added intentionally (e.g. to enable IDE schema
  // validation), update or remove this test rather than fighting it.
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(data, '$schema'),
    false,
    'section-markers.json must NOT define a top-level $schema key',
  );
});

// =========================================================================
// Runner
// =========================================================================

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`ok  ${name}\n`);
  } catch (e) {
    failed += 1;
    process.stdout.write(`FAIL  ${name}\n`);
    process.stderr.write(`   ${e.stack || e.message}\n`);
  }
}

process.stdout.write(`\n${passed} passed, ${failed} failed (${tests.length} total)\n`);
process.exit(failed === 0 ? 0 : 1);

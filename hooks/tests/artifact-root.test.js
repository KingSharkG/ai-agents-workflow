#!/usr/bin/env node
/**
 * Tests for hooks/lib/artifact-root.js.
 *
 * Run with:
 *   node hooks/tests/artifact-root.test.js
 *
 * Zero dependencies — uses Node's built-in `assert` and `fs` modules. Each
 * test creates an isolated tmp project and exercises one resolver case.
 *
 * Coverage:
 *   - In-project layout (./.claude/aiaw-data-<name>/)
 *   - Sibling layout    (../aiaw-data-<name>/)
 *   - Legacy folder detection (./ai-workflow-data/)
 *   - No-folder error
 *   - In-project takes precedence over sibling when both exist
 *   - Symlink canonicalization for not-yet-created files (the macOS
 *     /var/folders → /private/var/folders case the source-writes guard hit)
 *   - canonicalize() walks up to the deepest existing ancestor
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveArtifactRoot, canonicalize, PREFIX, LEGACY_DIR_NAME } = require('../lib/artifact-root');

// resolveArtifactRoot caches by cwd. Each test must invalidate it before
// running by passing a fresh cwd, OR by clearing the require cache. We rotate
// project names so cwd is always unique and the cache check (which is
// `cached._cwd === cwd`) misses.
let counter = 0;
function newProject(prefix) {
  counter += 1;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aiaw-test-${prefix}-`));
  const proj = path.join(root, `proj${counter}`);
  fs.mkdirSync(proj, { recursive: true });
  return { root, proj, name: path.basename(proj) };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('in-project layout: ./.claude/aiaw-data-<name>/', () => {
  const { root, proj, name } = newProject('local');
  fs.mkdirSync(path.join(proj, '.claude', `${PREFIX}${name}`), { recursive: true });
  const r = resolveArtifactRoot(proj);
  assert.strictEqual(r.layout, 'local');
  assert.ok(r.root.endsWith(path.join('.claude', `${PREFIX}${name}`)), `unexpected root: ${r.root}`);
  assert.strictEqual(r.legacyDetected, false);
  assert.strictEqual(r.error, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('sibling layout: ../aiaw-data-<name>/', () => {
  const { root, proj, name } = newProject('sibling');
  fs.mkdirSync(path.join(path.dirname(proj), `${PREFIX}${name}`), { recursive: true });
  const r = resolveArtifactRoot(proj);
  assert.strictEqual(r.layout, 'sibling');
  assert.strictEqual(path.basename(r.root), `${PREFIX}${name}`);
  assert.strictEqual(r.legacyDetected, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('legacy folder block', () => {
  const { root, proj } = newProject('legacy');
  fs.mkdirSync(path.join(proj, LEGACY_DIR_NAME), { recursive: true });
  const r = resolveArtifactRoot(proj);
  assert.strictEqual(r.root, null);
  assert.strictEqual(r.legacyDetected, true);
  assert.match(r.error, /Legacy artifact folder/);
  assert.match(r.error, /\.claude\//, 'legacy hint should reference new in-project layout');
  fs.rmSync(root, { recursive: true, force: true });
});

test('no folder at all', () => {
  const { root, proj } = newProject('empty');
  const r = resolveArtifactRoot(proj);
  assert.strictEqual(r.root, null);
  assert.strictEqual(r.legacyDetected, false);
  assert.match(r.error, /No artifact folder found/);
  assert.match(r.error, /Run \/ai-agents-workflow:init/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('in-project precedence: when both layouts exist, local wins', () => {
  const { root, proj, name } = newProject('precedence');
  fs.mkdirSync(path.join(proj, '.claude', `${PREFIX}${name}`), { recursive: true });
  fs.mkdirSync(path.join(path.dirname(proj), `${PREFIX}${name}`), { recursive: true });
  const r = resolveArtifactRoot(proj);
  assert.strictEqual(r.layout, 'local');
  fs.rmSync(root, { recursive: true, force: true });
});

test('canonicalize: returns realpath for an existing file', () => {
  const { root, proj } = newProject('canon-exist');
  const target = path.join(proj, 'real-file.txt');
  fs.writeFileSync(target, 'x');
  const got = canonicalize(target);
  assert.ok(fs.existsSync(got));
  assert.strictEqual(fs.realpathSync(target), got);
  fs.rmSync(root, { recursive: true, force: true });
});

test('canonicalize: walks up to deepest existing ancestor for not-yet-created paths', () => {
  // This is the exact case that broke isArtifactPath on macOS: target file
  // does not yet exist (a write target), but its grand-grand-ancestor is a
  // symlinked /var/folders/... → /private/var/folders/... directory.
  const { root, proj, name } = newProject('canon-tail');
  fs.mkdirSync(path.join(proj, '.claude', `${PREFIX}${name}`, 'tasks'), { recursive: true });
  const writeTarget = path.join(
    proj,
    '.claude',
    `${PREFIX}${name}`,
    'tasks',
    'TP-001',
    'phase-1',
    'TP-001-A1',
    'ai-work.md',
  );
  // None of these directories exist yet; the file doesn't exist either.
  const got = canonicalize(writeTarget);
  // The canonicalized path must (a) start at the realpath of the deepest
  // existing ancestor (proj/.claude/aiaw-data-<name>/tasks) and (b) preserve
  // the not-yet-created tail.
  const realTasks = fs.realpathSync(path.join(proj, '.claude', `${PREFIX}${name}`, 'tasks'));
  assert.ok(got.startsWith(realTasks + path.sep), `expected ${got} to start with ${realTasks}/`);
  assert.ok(got.endsWith(path.join('TP-001', 'phase-1', 'TP-001-A1', 'ai-work.md')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('canonicalize: idempotent on root /', () => {
  const got = canonicalize('/');
  assert.strictEqual(got, '/');
});

test('project name with a space resolves correctly', () => {
  // basename returns "my proj" with the space preserved; the artifact folder
  // ships with an embedded space too. This is unusual but not invalid on
  // any major filesystem, so the resolver must not choke on it.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaw-test-space-'));
  const proj = path.join(root, 'my proj');
  fs.mkdirSync(proj);
  fs.mkdirSync(path.join(proj, '.claude', `${PREFIX}my proj`), { recursive: true });
  const r = resolveArtifactRoot(proj);
  assert.strictEqual(r.layout, 'local');
  assert.strictEqual(r.name, 'my proj');
  assert.ok(r.root.endsWith(`${PREFIX}my proj`), `unexpected root: ${r.root}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('project name with leading hyphen resolves correctly', () => {
  // path.basename happily returns "-weird-name". The resolver must accept it.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaw-test-hyphen-'));
  const proj = path.join(root, '-weird-name');
  fs.mkdirSync(proj);
  fs.mkdirSync(path.join(proj, '.claude', `${PREFIX}-weird-name`), { recursive: true });
  const r = resolveArtifactRoot(proj);
  assert.strictEqual(r.layout, 'local');
  assert.strictEqual(r.name, '-weird-name');
  fs.rmSync(root, { recursive: true, force: true });
});

test('broken symlink as artifact root is treated as not-existing', () => {
  // The in-project candidate path points at a symlink whose target does not
  // exist. fs.existsSync returns false for broken symlinks, so the resolver
  // should fall through to "no folder found" rather than crash.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaw-test-broken-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  fs.mkdirSync(path.join(proj, '.claude'));
  fs.symlinkSync(
    path.join(root, 'does-not-exist'),
    path.join(proj, '.claude', `${PREFIX}proj`),
  );
  const r = resolveArtifactRoot(proj);
  assert.strictEqual(r.root, null, 'broken symlink should not resolve as a valid artifact root');
  assert.strictEqual(r.legacyDetected, false);
  assert.match(r.error, /No artifact folder found/);
  fs.rmSync(root, { recursive: true, force: true });
});

// --- CLI wrapper tests (spawn the wrapper as a subprocess) ---

const { spawnSync } = require('child_process');
const RESOLVE_CLI = path.join(__dirname, '..', 'bin', 'resolve-artifact-root.js');
const WRITE_DIR_CLI = path.join(__dirname, '..', 'bin', 'write-additional-dir.js');

function runCli(scriptPath, args, cwd) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('resolve-artifact-root CLI: plain mode prints absolute path on success', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaw-cli-ok-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, '.claude', `${PREFIX}proj`), { recursive: true });
  const out = runCli(RESOLVE_CLI, [], proj);
  assert.strictEqual(out.status, 0);
  assert.ok(out.stdout.trim().endsWith(path.join('.claude', `${PREFIX}proj`)), `unexpected stdout: ${out.stdout}`);
  assert.strictEqual(out.stderr, '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolve-artifact-root CLI: plain mode exits 1 with diagnostic on failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaw-cli-fail-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const out = runCli(RESOLVE_CLI, [], proj);
  assert.strictEqual(out.status, 1);
  assert.strictEqual(out.stdout, '');
  assert.match(out.stderr, /No artifact folder found/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolve-artifact-root CLI: --json mode emits structured payload (success)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaw-cli-json-ok-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, '.claude', `${PREFIX}proj`), { recursive: true });
  const out = runCli(RESOLVE_CLI, ['--json'], proj);
  assert.strictEqual(out.status, 0);
  const parsed = JSON.parse(out.stdout);
  assert.strictEqual(typeof parsed.root, 'string');
  assert.strictEqual(parsed.layout, 'local');
  assert.strictEqual(parsed.legacyDetected, false);
  assert.strictEqual(parsed.error, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolve-artifact-root CLI: --json mode always exits 0', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaw-cli-json-fail-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const out = runCli(RESOLVE_CLI, ['--json'], proj);
  assert.strictEqual(out.status, 0, 'json mode should never use exit code to signal failure');
  const parsed = JSON.parse(out.stdout);
  assert.strictEqual(parsed.root, null);
  assert.match(parsed.error, /No artifact folder found/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('write-additional-dir CLI: fresh project creates settings.local.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaw-write-fresh-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const out = runCli(WRITE_DIR_CLI, ['../aiaw-data-proj'], proj);
  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /^added \.\.\/aiaw-data-proj/);
  const written = JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'settings.local.json'), 'utf8'));
  assert.deepStrictEqual(written.permissions.additionalDirectories, ['../aiaw-data-proj']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('write-additional-dir CLI: idempotent (re-run is noop)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaw-write-idem-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  runCli(WRITE_DIR_CLI, ['../aiaw-data-proj'], proj);
  const out2 = runCli(WRITE_DIR_CLI, ['../aiaw-data-proj'], proj);
  assert.strictEqual(out2.status, 0);
  assert.match(out2.stdout, /^noop /);
  const written = JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'settings.local.json'), 'utf8'));
  assert.strictEqual(written.permissions.additionalDirectories.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('write-additional-dir CLI: preserves existing keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaw-write-preserve-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  const initial = {
    model: 'opus',
    permissions: {
      allowed: ['Bash(npm test:*)'],
      additionalDirectories: ['../existing-dir'],
    },
    env: { DEBUG: 'true' },
  };
  fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify(initial));
  const out = runCli(WRITE_DIR_CLI, ['../aiaw-data-proj'], proj);
  assert.strictEqual(out.status, 0);
  const written = JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'settings.local.json'), 'utf8'));
  assert.strictEqual(written.model, 'opus');
  assert.deepStrictEqual(written.permissions.allowed, ['Bash(npm test:*)']);
  assert.deepStrictEqual(written.permissions.additionalDirectories, ['../existing-dir', '../aiaw-data-proj']);
  assert.deepStrictEqual(written.env, { DEBUG: 'true' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('write-additional-dir CLI: refuses to overwrite malformed JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiaw-write-bad-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), 'not json {{{');
  const out = runCli(WRITE_DIR_CLI, ['../aiaw-data-proj'], proj);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /malformed JSON/);
  // Original file content must be untouched.
  assert.strictEqual(
    fs.readFileSync(path.join(proj, '.claude', 'settings.local.json'), 'utf8'),
    'not json {{{',
  );
  fs.rmSync(root, { recursive: true, force: true });
});

// --- runner ---

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

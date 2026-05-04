/**
 * Artifact root resolver.
 *
 * The plugin no longer hardcodes `ai-workflow-data/` as the artifact location.
 * Each consumer project picks one of two layouts at /ai-agents-workflow:init:
 *
 *   1. In-project   →  <cwd>/.claude/aiaw-data-<project>/
 *   2. Sibling      →  <dirname(cwd)>/aiaw-data-<project>/
 *
 * `<project>` is `path.basename(cwd)` — the project folder name (no
 * slugification). The in-project layout sits under `.claude/` so the project
 * root stays clean and no `additionalDirectories` permission grant is needed
 * (Claude Code already has access to anything under CWD).
 *
 * Resolution order (no silent fallback):
 *
 *   1. ./.claude/aiaw-data-<project>/  exists  → return it.
 *   2. ../aiaw-data-<project>/         exists  → return it.
 *   3. ./ai-workflow-data/             exists  → legacy folder, error with rename hint.
 *   4. neither exists                          → error pointing at /init.
 *
 * The function does NOT call process.exit. Callers (hooks) decide whether to
 * block or fall through — `pre-task-guard` blocks on dispatch attempts;
 * `guard-orchestrator-source-writes` blocks on legacy detection only.
 *
 * Result shape:
 *   {
 *     root: string|null,         // absolute path to artifact root, or null
 *     name: string,              // basename(cwd) — the project folder name
 *     layout: 'local'|'sibling'|null,
 *     legacyDetected: boolean,   // true if ./ai-workflow-data/ exists
 *     error: string|null,        // human-readable diagnostic when root is null
 *   }
 *
 * The resolver is cheap (one or two fs.existsSync calls) and the result is
 * cached for the lifetime of the process.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LEGACY_DIR_NAME = 'ai-workflow-data';
const PREFIX = 'aiaw-data-';

function resolveArtifactRoot(cwd = process.cwd()) {
  // No module-level cache. Each call re-probes the filesystem (two cheap
  // existsSync calls). Caching across calls within one process is unsafe
  // when the resolver is called before AND after init creates the folder
  // (e.g. in a long-running test runner or future bundled hook).
  const canonicalCwd = canonicalize(cwd);
  const name = path.basename(canonicalCwd);
  const local = path.join(canonicalCwd, '.claude', `${PREFIX}${name}`);
  const sibling = path.join(path.dirname(canonicalCwd), `${PREFIX}${name}`);
  const legacy = path.join(canonicalCwd, LEGACY_DIR_NAME);
  const legacyDetected = safeExistsSync(legacy);

  let result;
  if (safeExistsSync(local)) {
    result = {
      root: canonicalize(local),
      name,
      layout: 'local',
      legacyDetected,
      error: null,
    };
  } else if (safeExistsSync(sibling)) {
    result = {
      root: canonicalize(sibling),
      name,
      layout: 'sibling',
      legacyDetected,
      error: null,
    };
  } else if (legacyDetected) {
    result = {
      root: null,
      name,
      layout: null,
      legacyDetected: true,
      error:
        `Legacy artifact folder ./${LEGACY_DIR_NAME}/ detected. ` +
        `That layout is no longer supported. Rename to one of:\n` +
        `  mkdir -p .claude && mv ${LEGACY_DIR_NAME} .claude/${PREFIX}${name}   (in-project layout)\n` +
        `  mv ${LEGACY_DIR_NAME} ../${PREFIX}${name}                            (sibling layout)\n` +
        `For sibling layout also add to .claude/settings.local.json:\n` +
        `  { "permissions": { "additionalDirectories": ["../${PREFIX}${name}"] } }\n` +
        `See README → "Migration from ai-workflow-data".`,
    };
  } else {
    result = {
      root: null,
      name,
      layout: null,
      legacyDetected: false,
      error:
        `No artifact folder found for project "${name}". Looked for:\n` +
        `  ${local}\n` +
        `  ${sibling}\n` +
        `Run /ai-agents-workflow:init to scaffold one.`,
    };
  }

  return result;
}

function safeExistsSync(p) {
  try {
    return fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

/**
 * Canonicalize a path: resolve symlinks via realpath when the path exists,
 * otherwise walk up to the deepest existing ancestor, realpath that, and
 * append the remaining tail. This matters on macOS where `/var/folders/...`
 * is a symlink to `/private/var/folders/...` — a naive string comparison
 * between an `fs.realpathSync`-derived root and a not-yet-created target path
 * produces false negatives.
 */
function canonicalize(p) {
  if (!p) return p;
  const absolute = path.resolve(p);
  try {
    return fs.realpathSync(absolute);
  } catch (_) {
    // Walk up until we find an existing ancestor, then rebuild.
    const tail = [];
    let cursor = absolute;
    while (true) {
      const parent = path.dirname(cursor);
      tail.unshift(path.basename(cursor));
      if (parent === cursor) {
        // Hit the filesystem root without finding anything realpath-able.
        return absolute;
      }
      try {
        const realParent = fs.realpathSync(parent);
        return path.join(realParent, ...tail);
      } catch (_) {
        cursor = parent;
      }
    }
  }
}

/**
 * Convenience: resolve and return just the absolute root, or null.
 * Use the full resolveArtifactRoot() when you need the diagnostic.
 */
function artifactRootOrNull(cwd) {
  return resolveArtifactRoot(cwd).root;
}

/**
 * Build the absolute path for a workflow file inside the artifact root.
 *   artifactPath('config', 'PROJECT_CONFIG.md')
 *     → "/abs/.../aiaw-data-myproject/config/PROJECT_CONFIG.md"
 * Returns null when no artifact root is resolved.
 */
function artifactPath(...segments) {
  const root = artifactRootOrNull();
  if (!root) return null;
  return path.join(root, ...segments);
}

module.exports = {
  resolveArtifactRoot,
  artifactRootOrNull,
  artifactPath,
  canonicalize,
  LEGACY_DIR_NAME,
  PREFIX,
};

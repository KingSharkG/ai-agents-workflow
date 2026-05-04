#!/usr/bin/env node
/**
 * CLI wrapper around hooks/lib/artifact-root.js → resolveArtifactRoot().
 *
 * Used by the chief-orchestrator and resume-orchestrator at their Step 0
 * checks instead of an inline `node -e "..."` (which is fragile around
 * shell quoting and harder to test).
 *
 * Usage:
 *   node hooks/bin/resolve-artifact-root.js [--json]
 *
 * Plain mode:
 *   - On success → exit 0, prints the absolute artifact root on stdout.
 *   - On failure → exit 1, prints the diagnostic on stderr.
 *
 * --json mode (for tooling):
 *   - Always exit 0, prints a single JSON object on stdout:
 *       {"root": "/abs/path", "layout": "local"|"sibling", "legacyDetected": false, "error": null}
 *     or
 *       {"root": null, "layout": null, "legacyDetected": true|false, "error": "..."}
 *   Use --json when a caller needs both the success and the diagnostic
 *   without parsing exit codes.
 */

'use strict';

const { resolveArtifactRoot } = require('../lib/artifact-root');

const wantJson = process.argv.includes('--json');
const result = resolveArtifactRoot();

if (wantJson) {
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(0);
}

if (result.root) {
  process.stdout.write(result.root);
  process.exit(0);
}

process.stderr.write(result.error + '\n');
process.exit(1);

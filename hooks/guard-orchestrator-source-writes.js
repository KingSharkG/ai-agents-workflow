#!/usr/bin/env node
/**
 * PreToolUse hook: guard-orchestrator-source-writes (blocking)
 *
 * Prevents the chief-orchestrator from writing production code in the
 * consumer repo. The orchestrator's role contract forbids "writing
 * production code" — its Edit/Write/Bash tools are for ai-workflow-data/
 * artifacts only. Code changes must go through Task(executor).
 *
 * This hook is the structural backstop for that rule: even if the
 * orchestrator's prompt enforcement drifts, this hook denies the call.
 *
 * Scope:
 *   Only fires when CLAUDE_SUBAGENT_TYPE === "chief-orchestrator". Other
 *   agents (executor, lead, reviewer, etc.) and the top-level user
 *   session are unaffected.
 *
 * Tool matchers: Edit, Write, Bash.
 *
 * Decision logic:
 *   - Edit / Write: deny if CLAUDE_TOOL_INPUT_FILE_PATH targets anything
 *     outside ai-workflow-data/**.
 *   - Bash: deny if CLAUDE_TOOL_INPUT_COMMAND clearly writes outside
 *     ai-workflow-data/** (redirection to non-artifact paths, or known
 *     mutation commands targeting consumer-repo paths). Read-only and
 *     ai-workflow-data/-scoped commands pass.
 *
 * Env vars read:
 *   CLAUDE_SUBAGENT_TYPE          — currently-running agent role
 *   CLAUDE_TOOL_MATCHER           — "Edit" | "Write" | "Bash"
 *   CLAUDE_TOOL_INPUT_FILE_PATH   — Edit/Write target
 *   CLAUDE_TOOL_INPUT_COMMAND     — Bash command string
 *   CLAUDE_PLUGIN_ROOT            — plugin installation root (unused but
 *                                   reserved for future governance reads)
 *
 * Exit semantics:
 *   0 — allow
 *   1 — block (stderr carries the actionable message)
 *
 * Fail-open: any unrecognized state (no env, ambiguous Bash command,
 * unknown matcher) exits 0 with a stderr note. Fix A (prompt
 * enforcement) is the primary protection; this hook adds defense in
 * depth without becoming a usability footgun.
 */

const path = require('path');

const ARTIFACT_PREFIX = 'ai-workflow-data';

const bareRole = (id) => {
  if (!id) return '';
  return id.includes(':') ? id.split(':').pop() : id;
};

const callingRole = bareRole(process.env.CLAUDE_SUBAGENT_TYPE || '');

// Only the chief-orchestrator is subject to this rule. Every other
// caller (other agents, top-level user) is allowed.
if (callingRole !== 'chief-orchestrator') {
  process.exit(0);
}

const matcher = (process.env.CLAUDE_TOOL_MATCHER || '').trim();

// Normalize a path (relative or absolute) and check whether it lives
// inside ai-workflow-data/. We treat both `ai-workflow-data/...` and
// `<cwd>/ai-workflow-data/...` as artifact paths.
function isArtifactPath(p) {
  if (!p) return false;
  const normalized = path.normalize(p).replace(/\\/g, '/');
  if (normalized.startsWith(`${ARTIFACT_PREFIX}/`) || normalized === ARTIFACT_PREFIX) {
    return true;
  }
  // Absolute path: check whether the segment chain contains the prefix
  // immediately under the CWD.
  const cwd = process.cwd().replace(/\\/g, '/');
  if (normalized.startsWith(`${cwd}/${ARTIFACT_PREFIX}/`)) return true;
  if (normalized === `${cwd}/${ARTIFACT_PREFIX}`) return true;
  return false;
}

function denyEditWrite(targetPath) {
  console.error(
    `[guard-orchestrator-source-writes] BLOCKED: chief-orchestrator may not ` +
      `${matcher} files outside ai-workflow-data/.\n` +
      `Path: ${targetPath}\n` +
      `Consumer-repo source must be modified by Executor. Dispatch via:\n` +
      `  Task(subagent_type: ai-agents-workflow:executor, prompt: ...)\n` +
      `If this write is for a workflow artifact, target an ai-workflow-data/** path instead.\n`,
  );
  process.exit(1);
}

function denyBash(command, reason) {
  console.error(
    `[guard-orchestrator-source-writes] BLOCKED: chief-orchestrator Bash ` +
      `command appears to write outside ai-workflow-data/.\n` +
      `Reason: ${reason}\n` +
      `Command: ${command}\n` +
      `Consumer-repo code changes must be performed by Executor via Task dispatch.\n`,
  );
  process.exit(1);
}

if (matcher === 'Edit' || matcher === 'Write') {
  const targetPath = process.env.CLAUDE_TOOL_INPUT_FILE_PATH || '';
  if (!targetPath) {
    // No path → cannot judge, fail-open.
    process.exit(0);
  }
  if (isArtifactPath(targetPath)) {
    process.exit(0);
  }
  denyEditWrite(targetPath);
}

if (matcher === 'Bash') {
  const command = process.env.CLAUDE_TOOL_INPUT_COMMAND || '';
  if (!command) process.exit(0);

  // 1. Output redirection (`>` or `>>`) targeting a non-artifact path
  //    is an unambiguous write outside ai-workflow-data/.
  //    Match `>` or `>>` followed by a path token.
  const redirRegex = /(?:^|[\s;|&])(>{1,2})\s*([^\s;|&]+)/g;
  let m;
  while ((m = redirRegex.exec(command)) !== null) {
    const target = m[2].replace(/^["']|["']$/g, '');
    if (!isArtifactPath(target)) {
      denyBash(command, `redirection "${m[1]} ${target}" writes outside ai-workflow-data/`);
    }
  }

  // 2. Common mutation commands. We block when their first non-flag
  //    argument is a non-artifact path. This is heuristic — read-only
  //    use of these commands (none here, since they all mutate by name)
  //    does not exist, so we can be aggressive.
  const mutators = [
    { name: 'rm', firstPathArg: true },
    { name: 'mv', firstPathArg: true },
    { name: 'cp', firstPathArg: true }, // cp's destination is the second arg, but the first is at least readable; we focus on the destination instead
    { name: 'install', firstPathArg: true },
    { name: 'chmod', firstPathArg: true },
    { name: 'chown', firstPathArg: true },
    { name: 'tee', firstPathArg: true },
    { name: 'touch', firstPathArg: true },
    { name: 'sed', firstPathArg: false }, // -i edits in place; only deny -i variant
    { name: 'truncate', firstPathArg: true },
  ];

  // Tokenize the command on simple separators. This is intentionally
  // conservative — anything we cannot tokenize cleanly falls through.
  const segments = command.split(/&&|\|\||;|\|/g).map((s) => s.trim());
  for (const segment of segments) {
    if (!segment) continue;
    const tokens = segment.split(/\s+/);
    if (tokens.length === 0) continue;
    const cmd = path.basename(tokens[0]);

    const mutator = mutators.find((mu) => mu.name === cmd);
    if (!mutator) continue;

    if (mutator.name === 'sed') {
      // Block only sed -i / sed --in-place that targets non-artifact paths.
      const usesInPlace = tokens.some((t) => t === '-i' || t === '--in-place' || t.startsWith('-i'));
      if (!usesInPlace) continue;
      const fileArg = tokens.slice(1).find((t) => !t.startsWith('-') && t !== 'sed');
      if (fileArg && !isArtifactPath(fileArg)) {
        denyBash(command, `"sed -i" target "${fileArg}" is outside ai-workflow-data/`);
      }
      continue;
    }

    if (mutator.name === 'cp') {
      // cp <src> <dst>: destination is the LAST positional arg.
      const positional = tokens.slice(1).filter((t) => !t.startsWith('-'));
      if (positional.length < 2) continue;
      const dest = positional[positional.length - 1];
      if (!isArtifactPath(dest)) {
        denyBash(command, `"cp" destination "${dest}" is outside ai-workflow-data/`);
      }
      continue;
    }

    if (mutator.name === 'mv') {
      // mv <src> <dst>: destination is the LAST positional arg; either
      // src or dst leaving ai-workflow-data/ is a violation.
      const positional = tokens.slice(1).filter((t) => !t.startsWith('-'));
      if (positional.length < 2) continue;
      const dest = positional[positional.length - 1];
      if (!isArtifactPath(dest)) {
        denyBash(command, `"mv" destination "${dest}" is outside ai-workflow-data/`);
      }
      continue;
    }

    // Generic single-target mutators (rm, chmod, chown, tee, touch,
    // install, truncate): deny if any positional arg is a non-artifact
    // path. This intentionally over-blocks `rm src/*.tmp` etc. because
    // the orchestrator has no business deleting consumer-repo files.
    const positional = tokens.slice(1).filter((t) => !t.startsWith('-'));
    for (const arg of positional) {
      // Skip glob/wildcard args we cannot statically resolve — fail-open.
      if (arg.includes('*') || arg.includes('?')) continue;
      if (!isArtifactPath(arg)) {
        denyBash(command, `"${cmd}" target "${arg}" is outside ai-workflow-data/`);
      }
    }
  }

  // 3. Known wholesale-write commands the orchestrator should never run
  //    directly on the consumer repo. These belong to executor.
  const forbiddenPrefixes = [
    'git commit',
    'git add',
    'git push',
    'git reset',
    'git rm',
    'git restore',
    'git checkout',
    'git merge',
    'git rebase',
    'git stash',
    'npm install',
    'npm run',
    'npm publish',
    'yarn install',
    'yarn add',
    'yarn remove',
    'pnpm install',
    'pnpm add',
    'pnpm remove',
    'pip install',
    'pip uninstall',
  ];
  const trimmed = command.trim();
  for (const prefix of forbiddenPrefixes) {
    if (trimmed.startsWith(prefix)) {
      denyBash(command, `command "${prefix}" mutates consumer-repo state; route via executor`);
    }
  }

  // Default: allow.
  process.exit(0);
}

// Unknown matcher — fail-open.
process.exit(0);

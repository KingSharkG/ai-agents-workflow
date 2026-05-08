#!/usr/bin/env node
/**
 * PreToolUse hook: guard-orchestrator-source-writes (blocking)
 *
 * Prevents the chief-orchestrator from writing production code in the
 * consumer repo. The orchestrator's role contract forbids "writing
 * production code" — its Edit/Write/Bash tools are for the workflow
 * artifact root only (resolved by hooks/lib/artifact-root.js, currently
 * `aiaw-data-<project>` in either the in-project or sibling layout).
 * Code changes must go through Task(executor).
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
 *     outside the resolved artifact root.
 *   - Bash: deny if CLAUDE_TOOL_INPUT_COMMAND clearly writes outside the
 *     resolved artifact root (redirection to non-artifact paths, or known
 *     mutation commands targeting consumer-repo paths). Read-only and
 *     artifact-scoped commands pass.
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
const { resolveArtifactRoot, canonicalize } = require('./lib/artifact-root');

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

const ARTIFACT = resolveArtifactRoot();

// Hard-stop: if the consumer repo still has the legacy ./ai-workflow-data/
// folder (no current-format folder yet), the orchestrator must be told to
// migrate before any artifact write is attempted.
if (ARTIFACT.legacyDetected && !ARTIFACT.root) {
  console.error(
    `[guard-orchestrator-source-writes] BLOCKED: ${ARTIFACT.error}\n`,
  );
  process.exit(1);
}

// Canonicalize (resolve symlinks) and check whether the path lives inside the
// resolved artifact root. Both sides are canonicalized so symlinked tmp dirs
// (macOS `/var/folders` → `/private/var/folders`) compare correctly.
function isArtifactPath(p) {
  if (!p) return false;
  if (!ARTIFACT.root) return false;
  const root = ARTIFACT.root.replace(/\\/g, '/');
  const abs = canonicalize(path.resolve(process.cwd(), p)).replace(/\\/g, '/');
  if (abs === root) return true;
  if (abs.startsWith(`${root}/`)) return true;
  return false;
}

const artifactHint = ARTIFACT.root || '<artifact-root>';

function denyEditWrite(targetPath) {
  console.error(
    `[guard-orchestrator-source-writes] BLOCKED: chief-orchestrator may not ` +
      `${matcher} files outside the artifact root.\n` +
      `Path:          ${targetPath}\n` +
      `Artifact root: ${artifactHint}\n` +
      `Consumer-repo source must be modified by Executor. Dispatch via:\n` +
      `  Task(subagent_type: ai-agents-workflow:executor, prompt: ...)\n` +
      `If this write is for a workflow artifact, target a path under ${artifactHint}/** instead.\n`,
  );
  process.exit(1);
}

function denyBash(command, reason) {
  console.error(
    `[guard-orchestrator-source-writes] BLOCKED: chief-orchestrator Bash ` +
      `command appears to write outside the artifact root (${artifactHint}).\n` +
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

  // Quote-aware splitter shared by segment + token + redirect scanning.
  // Returns an array of { text, quoted } chunks where `text` is the literal
  // run with quotes stripped and `quoted` is true if any character of the run
  // came from inside a quoted region. Backslash escapes outside quotes
  // pass through; sufficient for the heuristic decisions made below.
  function shellLex(input) {
    const out = [];
    let buf = '';
    let bufQuoted = false;
    let i = 0;
    let mode = 'normal'; // 'normal' | 'single' | 'double'
    const flush = () => {
      if (buf.length) out.push({ text: buf, quoted: bufQuoted });
      buf = '';
      bufQuoted = false;
    };
    while (i < input.length) {
      const ch = input[i];
      if (mode === 'normal') {
        if (ch === '\\' && i + 1 < input.length) {
          buf += input[i + 1];
          i += 2;
          continue;
        }
        if (ch === "'") { mode = 'single'; bufQuoted = true; i++; continue; }
        if (ch === '"') { mode = 'double'; bufQuoted = true; i++; continue; }
        if (/\s/.test(ch) || ch === ';' || ch === '|' || ch === '&' || ch === '>' || ch === '<') {
          flush();
          out.push({ text: ch, quoted: false, sep: true });
          i++;
          continue;
        }
        buf += ch;
        i++;
        continue;
      }
      if (mode === 'single') {
        if (ch === "'") { mode = 'normal'; i++; continue; }
        buf += ch; i++; continue;
      }
      // double quotes: allow \" \\ escapes
      if (ch === '\\' && i + 1 < input.length && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        buf += input[i + 1]; i += 2; continue;
      }
      if (ch === '"') { mode = 'normal'; i++; continue; }
      buf += ch; i++;
    }
    flush();
    return out;
  }

  // Re-stitch shellLex() output into segments separated by &&, ||, ;, |.
  // Each segment is an array of token objects { text, quoted }.
  function splitSegments(input) {
    const lex = shellLex(input);
    const segs = [];
    let cur = [];
    let pendingSep = '';
    const pushSeg = () => {
      if (cur.length) segs.push(cur);
      cur = [];
    };
    for (const part of lex) {
      if (part.sep) {
        if (part.text === '&' || part.text === '|') {
          pendingSep += part.text;
          if (pendingSep === '&&' || pendingSep === '||' || pendingSep === '|') {
            pushSeg();
            pendingSep = '';
          }
          continue;
        }
        if (part.text === ';') { pushSeg(); pendingSep = ''; continue; }
        // whitespace, redirect operator
        pendingSep = '';
        continue;
      }
      pendingSep = '';
      cur.push({ text: part.text, quoted: part.quoted });
    }
    pushSeg();
    return segs;
  }

  // 1. Output redirection (`>` or `>>`) targeting a non-artifact path is an
  //    unambiguous write outside the artifact root. Walk the lex stream so
  //    redirect operators inside quoted strings (`echo "a > b"`) are ignored.
  {
    const lex = shellLex(command);
    for (let i = 0; i < lex.length; i++) {
      const part = lex[i];
      if (!part.sep) continue;
      if (part.text !== '>' ) continue;
      // Coalesce >> into one operator
      let op = '>';
      if (i + 1 < lex.length && lex[i + 1].sep && lex[i + 1].text === '>') {
        op = '>>';
        i++;
      }
      // Find the next non-whitespace, non-sep token = target
      let j = i + 1;
      while (j < lex.length && lex[j].sep) j++;
      if (j >= lex.length) break;
      const target = lex[j].text;
      if (!isArtifactPath(target)) {
        denyBash(command, `redirection "${op} ${target}" writes outside the artifact root`);
      }
      i = j;
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

  // Quote-aware segment + token walk. Anything we cannot tokenize cleanly
  // (e.g. unbalanced quotes degrade to a single segment) falls through.
  // For each segment we walk tokens linearly, honoring per-command
  // "flag takes a value" sets so `sed -i -e 'expr' file` resolves to `file`
  // (not `-e`) and `cp -t dest src1 src2` resolves to `dest` (not `src2`).

  // Flags that consume the next token as their value.
  const SED_VALUE_FLAGS = new Set(['-e', '-f', '--expression', '--file']);
  const CP_VALUE_FLAGS = new Set(['-t', '--target-directory', '-S', '--suffix']);
  const MV_VALUE_FLAGS = new Set(['-t', '--target-directory', '-S', '--suffix']);

  // Walk tokens, returning { positionals, longFlagValues } where
  // longFlagValues maps the canonical long-flag name to its value (for
  // `--target-directory=DIR` and `--target-directory DIR`).
  function parseArgs(tokens, valueFlags) {
    const positionals = [];
    const longFlagValues = new Map();
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const text = tok.text;
      if (text === '--') {
        for (let j = i + 1; j < tokens.length; j++) positionals.push(tokens[j]);
        break;
      }
      if (text.startsWith('--')) {
        const eq = text.indexOf('=');
        const name = eq === -1 ? text : text.slice(0, eq);
        if (valueFlags.has(name)) {
          if (eq !== -1) {
            longFlagValues.set(name, text.slice(eq + 1));
          } else if (i + 1 < tokens.length) {
            longFlagValues.set(name, tokens[i + 1].text);
            i++;
          }
        }
        continue;
      }
      if (text.startsWith('-') && text.length > 1) {
        // Short flag (or cluster). If it (or its first char form) takes a
        // value, consume the next token. Conservative: only the bare
        // short-flag forms in valueFlags trigger this — clusters like
        // `-it` won't be misread as `-i` taking the next arg.
        if (valueFlags.has(text) && i + 1 < tokens.length) {
          longFlagValues.set(text, tokens[i + 1].text);
          i++;
        }
        continue;
      }
      positionals.push(tok);
    }
    return { positionals, longFlagValues };
  }

  const segments = splitSegments(command);
  for (const segTokens of segments) {
    if (!segTokens.length) continue;
    const cmd = path.basename(segTokens[0].text);

    const mutator = mutators.find((mu) => mu.name === cmd);
    if (!mutator) continue;

    const argTokens = segTokens.slice(1);

    if (mutator.name === 'sed') {
      // Block only sed -i / sed --in-place that targets non-artifact paths.
      // BSD sed accepts `-i ''` (empty suffix) where the empty string is the
      // backup-suffix value, not a flag — handle by treating bare `-i` as
      // potentially consuming an empty next token only when that token is
      // literally empty / a quoted empty string.
      const usesInPlace = argTokens.some(
        (t) => t.text === '-i' || t.text === '--in-place' || t.text.startsWith('-i'),
      );
      if (!usesInPlace) continue;
      const { positionals } = parseArgs(argTokens, SED_VALUE_FLAGS);
      // The file argument is the last positional after -e/-f values are
      // peeled off. sed may take multiple files; check all of them.
      for (const p of positionals) {
        if (!isArtifactPath(p.text)) {
          denyBash(command, `"sed -i" target "${p.text}" is outside the artifact root`);
        }
      }
      continue;
    }

    if (mutator.name === 'cp') {
      // cp <src>... <dst>  OR  cp -t <dst> <src>...
      const { positionals, longFlagValues } = parseArgs(argTokens, CP_VALUE_FLAGS);
      const targetFlag =
        longFlagValues.get('-t') || longFlagValues.get('--target-directory');
      if (targetFlag) {
        if (!isArtifactPath(targetFlag)) {
          denyBash(command, `"cp" destination "${targetFlag}" is outside the artifact root`);
        }
        continue;
      }
      if (positionals.length < 2) continue;
      const dest = positionals[positionals.length - 1].text;
      if (!isArtifactPath(dest)) {
        denyBash(command, `"cp" destination "${dest}" is outside the artifact root`);
      }
      continue;
    }

    if (mutator.name === 'mv') {
      const { positionals, longFlagValues } = parseArgs(argTokens, MV_VALUE_FLAGS);
      const targetFlag =
        longFlagValues.get('-t') || longFlagValues.get('--target-directory');
      if (targetFlag) {
        if (!isArtifactPath(targetFlag)) {
          denyBash(command, `"mv" destination "${targetFlag}" is outside the artifact root`);
        }
        continue;
      }
      if (positionals.length < 2) continue;
      const dest = positionals[positionals.length - 1].text;
      if (!isArtifactPath(dest)) {
        denyBash(command, `"mv" destination "${dest}" is outside the artifact root`);
      }
      continue;
    }

    // Generic single-target mutators (rm, chmod, chown, tee, touch,
    // install, truncate): deny if any positional arg is a non-artifact
    // path. Intentionally over-blocks `rm src/*.tmp` etc. — orchestrator
    // has no business deleting consumer-repo files.
    const { positionals } = parseArgs(argTokens, new Set());
    for (const p of positionals) {
      const arg = p.text;
      if (arg.includes('*') || arg.includes('?')) continue;
      if (!isArtifactPath(arg)) {
        denyBash(command, `"${cmd}" target "${arg}" is outside the artifact root`);
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

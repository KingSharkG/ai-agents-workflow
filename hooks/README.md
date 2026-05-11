# `hooks/` — Plugin hook scripts

Node.js scripts wired by the Claude Code harness via `hooks.json`. Every hook is its own short-lived process: the harness sets `CLAUDE_*` environment variables, invokes the script, and reads its exit code (and stderr/stdout). Stdlib only — no `package.json`, no build step, no third-party dependencies.

## Layout

```
hooks/
├── hooks.json                                  # harness config (matchers → scripts)
├── pre-task-guard.js                           # PreToolUse Task — blocking
├── guard-agent-reads.js                        # PreToolUse Read — non-blocking warning
├── guard-orchestrator-source-writes.js         # PreToolUse Edit|Write|Bash — blocking
├── validate-artifact-chain.js                  # PostToolUse Write|Edit — blocking on schema violations
├── validate-summary-telemetry.js               # PostToolUse Write|Edit — non-blocking warning
├── lib/
│   ├── artifact-root.js                        # resolver: probes for the project's artifact root
│   └── plugin-root.js                          # resolver: locates the plugin install dir
├── bin/
│   ├── resolve-artifact-root.js                # CLI wrapper around lib/artifact-root.js
│   └── write-additional-dir.js                 # atomic JSON merge into .claude/settings.local.json
└── tests/
    ├── run-all.js                              # aggregate runner — exits non-zero if any suite fails
    ├── artifact-root.test.js
    ├── validate-artifact-chain.test.js
    ├── guard-orchestrator-source-writes.test.js
    └── pre-task-guard.test.js
```

## Hook contracts

| File | Tool matcher | Blocking? | What it enforces | Tests |
|---|---|---|---|---|
| `pre-task-guard.js` | `Task` | yes | (1) Caller is exempt (chief-orchestrator) or task scaffolding exists; (2) ai-work.md skeleton present for the dispatched subtask; (3) `gates.p1_approved === true` for gated roles; (4) legacy `./ai-workflow-data/` blocks all non-orchestrator/non-init dispatches; (5) emits trigger-keyword assessment to stdout (non-blocking). | `pre-task-guard.test.js` |
| `guard-agent-reads.js` | `Read` | no | Warns when an agent reads governance files, canonical role contracts, `PROJECT_CONFIG.md`, or the derived domain-contexts cache directly instead of via dispatch bundle. | (no direct suite — covered indirectly) |
| `guard-orchestrator-source-writes.js` | `Edit \| Write \| Bash` | yes | The chief-orchestrator may only Edit/Write inside the resolved artifact root. Bash output redirection and mutators (`rm`, `mv`, `cp`, `sed -i`, `touch`, etc.) targeting paths outside the artifact root are denied. A list of forbidden command prefixes (`git commit`, `npm install`, etc.) is always denied. Non-orchestrator callers and the top-level user are exempt. | `guard-orchestrator-source-writes.test.js` |
| `validate-artifact-chain.js` | `Write \| Edit` | yes | Per-artifact schema checks: required fields, required headings, required section markers, paired open/close markers, JSON shape for `orchestration-state.json`, integration-check verdict gating, telemetry-belongs-in-summary, etc. | `validate-artifact-chain.test.js` |
| `validate-summary-telemetry.js` | `Write \| Edit` | no | Warns when a subtask `summary.md` has a verdict but the `## Telemetry` or `## Context Manifest` section is empty/missing. | (no direct suite — small surface) |
| `check-plan-mode.js` | `Task` | yes | Blocks `Task(chief-orchestrator)` dispatch while Claude Code's native plan mode is active. Detection: scans the most recent user turn in the transcript for the literal banner `Plan mode is active`. Exits 1 with the canonical "press Shift+Tab" message on stderr (surfaced to the model). Kill switch: `AIAW_DISABLE_PLAN_MODE_GUARD=1`. | `check-plan-mode.test.js` |
| `block-aiaw-task-in-plan-mode.js` | UserPromptSubmit (event, not Tool matcher) | yes | Backstop for the slash-command path: blocks `/ai-agents-workflow:{task,continue,init,add,update,remove,pr-lessons,review}` while the harness reports `permission_mode === "plan"`. Catches the case where plan mode would otherwise steer the model into writing a plan document instead of dispatching, so `check-plan-mode.js` (PreToolUse on `Task`) never fires. Exits 2 with the canonical message on stderr (surfaced to the user before any model turn runs). Kill switch: `AIAW_DISABLE_PLAN_MODE_GUARD=1`. | `block-aiaw-task-in-plan-mode.test.js` |
| `guard-chief-orchestrator-stop.js` | SubagentStop | yes | Structural backstop on chief-orchestrator stop: detects intake skipped/errored/popup-skipped, missing executor/reviewer dispatch on execute paths, missing terminal state, out-of-artifact chief writes, empty `<!-- section:implementation -->`. Exits 2 with a specific reason naming each missing invariant. | `guard-chief-orchestrator-stop.test.js` |

## Shared libraries (`hooks/lib/`)

- **`artifact-root.js`** — exports `resolveArtifactRoot()`, `canonicalize()`, `artifactRootOrNull()`, `artifactPath()`, `LEGACY_DIR_NAME`, `PREFIX`. Resolution order: `./.claude/aiaw-data-<project>/` → `../aiaw-data-<project>/` → legacy block → no-folder error. Canonicalization handles macOS `/var/folders` symlinks via `fs.realpathSync` with walk-up for not-yet-created paths. No module-level cache — every call re-probes (cost: 1–2 `existsSync` calls).
- **`plugin-root.js`** — exports `resolvePluginRoot()` and `getPluginVersion()`. Locates the plugin installation by walking up from `__dirname` looking for `.claude-plugin/plugin.json`. Used by hooks that need to load plugin governance files.
- **`active-task.js`** — exports `bareRole()`, `parseTaskIdFromPrompt()`, `taskPrefixFor()`, `mostRecentTaskDir()`, `firstUserPromptText()`. Helpers for resolving active-task identity from hook context (task-id regexes, recent-task-dir picking) plus a tolerant first-user-prompt extractor used by `guard-chief-orchestrator-stop.js` to scope content scans (e.g. for `[E2E_AUTO_APPROVE_MODE]`) to the subagent's input prompt instead of the whole transcript.
- **`plan-mode-message.js`** — single source of truth for the user-facing "press Shift+Tab" message. Exports `PLAN_MODE_MESSAGE` (the historical wording for `/ai-agents-workflow:task`, preserved verbatim) and `planModeMessageFor(command)` (command-aware variant for other gated commands). The constant is computed from the function so they cannot drift.

## CLI helpers (`hooks/bin/`)

- **`resolve-artifact-root.js`** — wrapper around `lib/artifact-root.js → resolveArtifactRoot()`. Plain mode prints the absolute path on stdout and exits 0, or prints the diagnostic on stderr and exits 1. `--json` mode always exits 0 and emits the full result object on stdout for tooling. Used by the chief-orchestrator and resume-orchestrator at their Step 0 CWD-validation checks.
- **`write-additional-dir.js`** — atomic dedupe-and-merge of one entry into `<cwd>/.claude/settings.local.json` → `permissions.additionalDirectories[]`. Preserves all other keys, refuses to overwrite malformed JSON, never touches `.claude/settings.json`. Used by the init agent's Step 0 sibling-layout setup.

## Running the test suite

Run the whole suite:

```
node hooks/tests/run-all.js
```

Or run a single suite directly:

```
node hooks/tests/artifact-root.test.js
node hooks/tests/validate-artifact-chain.test.js
node hooks/tests/guard-orchestrator-source-writes.test.js
node hooks/tests/pre-task-guard.test.js
```

Each suite is a self-contained Node script using only `assert`, `fs`, `os`, `path`, and `child_process`. There is no test framework. The convention: declare tests with `test('name', fn)`, the runner at the bottom of each file iterates the array, prints `ok` or `FAIL`, and exits non-zero on any failure. Each test isolates itself via a fresh tmp directory created with `fs.mkdtempSync` and cleans up in its own teardown.

## Conventions

- **No external deps.** Every hook and test runs against vanilla Node without `npm install`. The hooks are on the hot path of every Task dispatch; a build/install step would slow every workflow invocation.
- **Exit-code semantics.** Blocking hooks: 0 = allow, 1 = block (with stderr explaining why). Non-blocking hooks: always exit 0; warnings go to stderr or stdout.
- **Path comparisons go through `canonicalize()`.** Anywhere a hook compares an input path to the artifact root, both sides are realpath-resolved (with walk-up for not-yet-created targets) so symlinks behave consistently across hooks.
- **Resolver returns, never throws.** `resolveArtifactRoot()` always returns a result object. Callers decide whether `result.root === null` should block.

## Timeout policy

| Script kind | Timeout | Rationale |
|---|---|---|
| PreToolUse / SubagentStop guards | 5000 ms | Each guard reads at most a handful of small JSON / Markdown files (orchestration-state, plugin manifest, single ai-work / summary). The 5 s cap fails fast on a wedged hook without slowing healthy dispatches. |
| PostToolUse validators (`validate-artifact-chain`, `validate-summary-telemetry`) | 10000 ms | Validators re-scan the just-written artifact (plus its sibling `summary.md` for telemetry). On large summary files (long-running tasks with deep `<!-- section:dispatch-bundles -->` audit logs) the regex sweep can approach 5 s on cold disk caches. 10 s gives headroom without becoming a usability problem. |

If a hook still times out under this policy, that is a real bug — fix the hook (stream / chunk / exit early), don't raise the budget further.

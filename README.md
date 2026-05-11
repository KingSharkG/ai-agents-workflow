# ai-agents-workflow

A Claude Code plugin that installs a portable multi-agent governance pipeline into any repo: chief-orchestrator, delivery-PM, lead, executor, design-agent, reviewer, integration-checker, init, resume-orchestrator, pr-lessons-harvester — plus 28 governance skills (organized by lifecycle stage) and a Node-based hook chain that enforces stage discipline, P1 plan approval, and plan-mode pre-flight.

## Install (remote marketplace, recommended)

From any target repo:

```
/plugin marketplace add KingSharkG/ai-agents-workflow
/plugin install ai-agents-workflow@ai-agents-workflow
```

Verify:

```
/plugin
```

You should see `ai-agents-workflow` listed as enabled. Pick up upstream edits with:

```
/plugin marketplace update ai-agents-workflow
/plugin uninstall ai-agents-workflow
/plugin install ai-agents-workflow@ai-agents-workflow
```

> **Note:** `/plugin marketplace update` only refreshes the marketplace source — you must uninstall and reinstall for changes to take effect in the plugin cache.

## Install (local development)

If you have this repo cloned locally and want to iterate on the plugin itself:

```
/plugin marketplace add /absolute/path/to/ai-agents-workflow
/plugin install ai-agents-workflow@ai-agents-workflow
```

Pick up local edits with the same update sequence:

```
/plugin marketplace update ai-agents-workflow
/plugin uninstall ai-agents-workflow
/plugin install ai-agents-workflow@ai-agents-workflow
```

## Uninstall

```
/plugin uninstall ai-agents-workflow
/plugin marketplace remove ai-agents-workflow
```

## Usage

Eight namespaced slash commands cover the plugin's surface:

| Command                                                           | Purpose                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `/ai-agents-workflow:init`                                        | Bootstrap `<artifact-root>/config/PROJECT_CONFIG.md` |
| `/ai-agents-workflow:add <target-type> <value> [--domain <d>]`    | Add a config entry                                    |
| `/ai-agents-workflow:update`                                      | Refresh CLI-owned sections of the config              |
| `/ai-agents-workflow:remove <target-type> <value> [--domain <d>]` | Remove a config entry                                 |
| `/ai-agents-workflow:task <description>`                          | Classify and route a task (see Intake Classification) |
| `/ai-agents-workflow:continue [task_id]`                          | Resume an interrupted or in-progress task             |
| `/ai-agents-workflow:pr-lessons <PR-ref>`                         | Harvest review comments from a PR into the lessons file |
| `/ai-agents-workflow:review [pr-number \| URL \| phrase]`         | PR-lessons-aware review of local diff or a GitHub PR; offers to dispatch fixes via `/ai-agents-workflow:task` |

Valid `<target-type>` values for `:add` / `:remove`: `domain`, `skill`, `plugin`, `baseline`, `validation-rule`, `forbidden-action`, `best-practice`, `cross-domain-rule`.

Natural-language invocations (e.g., "initialize project config") still work — the slash commands are a typed shortcut, not a replacement.

### Lifecycle Stages

A task progresses through up to four explicit stages, recorded in `orchestration-state.json` → `stage` (schema_version 3+):

| Stage | What runs | Subagents legal here |
|-------|-----------|----------------------|
| `intake` | Classify the request, ask clarifications if ambiguous, write `task-data.md` and initialize state | `chief-orchestrator`, `delivery-pm` |
| `planning` | Delivery PM produces the plan; P1 user gate approves it | `chief-orchestrator`, `delivery-pm`, `lead`, `design-agent` |
| `execution` | Per-subtask Lead → Executor → Integration → Reviewer cycles, P2 phase boundary | `chief-orchestrator`, `lead`, `executor`, `reviewer`, `design-agent`, `integration-checker` |
| `closure` | Post-approval cleanup, task-level summary, P4 task-completion gate, optional P5 retrospective | `chief-orchestrator` |

The `pre-task-guard.js` Phase 3.5 hook blocks subagent dispatches that don't belong to the active stage. Stage reopens are supported as soft transitions: `execution → planning` (Reviewer `needs-replan` or P2 user-elected replan) and `closure → execution` (`reversal-packet`). The reopen counter is soft-capped at 3; a 4th attempt triggers a `blocker-escalation-report` plus a "Continue / Abort" P-gate.

See `ai/playbooks/ORCHESTRATION.md` for the stage-grouped flow, the stage transition diagram, and the trivial-path compressed flow.

### Intake Classification

The `/ai-agents-workflow:task` command classifies each request before deciding how much of the pipeline to run:

| Classification | When (heuristic) | What happens |
|----------------|------------------|-------------|
| `direct-answer` | Question, explanation, advice, summary — no imperative verb targeting code | Orchestrator answers inline — no agents dispatched. A minimal classification record is written to `task-data.md` if an artifact root exists |
| `plan-only` | User explicitly says "plan only", "draft a plan", "don't implement", etc. | Creates Task Packet + Delivery Plan, stops after P1 approval. Resume later with `/continue` |
| `execution-trivial` | Single file, ≤ 5 LOC, no risk-area keywords, no public-symbol changes (typo, version bump, single import) | Compressed flow: skip Delivery PM + P1 + Lead. Orchestrator → Executor → Reviewer |
| `execution-simple` | ≤ 2 files AND ≤ 50 LOC, no risk keywords, no schema/API/auth/cross-cutting concerns | Full workflow, lightweight/ultra-light paths preferred |
| `execution-full` | Anything with a risk-area keyword, > 2 files, > 50 LOC, refactor/migrate/redesign, or vague scope | Full 15-step orchestration |

**Confirm-and-Override popup**: every request — without exception — produces an `AskUserQuestion` radio-button popup with four user-facing options (`Direct answer` / `Plan only` / `Execute (lightweight)` / `Execute (full pipeline)`). The orchestrator's heuristic pick is marked `(Recommended)` and pre-selected; the user can override before any pipeline work starts. See [skills/intake/orchestrator-intake/SKILL.md](skills/intake/orchestrator-intake/SKILL.md) for full checklist rules and the risk-area keyword sets (schema, API, auth, reliability, cross-cutting).

## Knowledge: PR Lessons

`/ai-agents-workflow:pr-lessons <PR-ref>` harvests review comments from a GitHub PR (your own or anyone's) and turns them into reusable lessons so the same mistake doesn't recur.

- **Storage:** `<artifact-root>/knowledge/pr-lessons.md` — one file per project, append-only with dedup on the rule slug.
- **Format:** each lesson is a `## <slug>` block with `Rule`, `Why`, `Fix`, `Tags`, `Source`, `Seen`, `First seen`, `Last seen`. Owned by the `pr-lessons-store` skill — do not hand-edit the structure.
- **Source:** GitHub MCP when available; falls back to the `gh` CLI. Manual trigger only in v1.
- **Consumed by:**
  - The `reviewer` agent automatically consults the file via the `pr-lessons-check` skill on every review.
  - You can run the same check before commit / PR creation: invoke the `pr-lessons-check` skill against `git diff --staged` (or any range) to see likely repeats of past feedback.

`<PR-ref>` accepts `123`, `owner/repo#123`, or a full PR URL. The harvester classifies each comment, generalizes it into a rule, asks you which to keep / edit / drop, then merges accepted lessons (incrementing `Seen` and adding source links for repeats).

The feature is self-contained (own command, agent, three skills, dedicated `knowledge/` subdir) so it can be lifted into a standalone plugin later by swapping the artifact-root resolver.

## External sources

The plugin's governance catalog (`ai/governance/RESOLUTION_POLICY.md`) is authoritative for every skill or plugin a consumer project may reference. See `<!-- section:external-sources -->` for the supported source taxonomy: `mcp-server`, `claude-builtin`, `github-marketplace`, `consumer-marketplace`, `npx-skills-find`, `local-plugin`. A consumer project references plugins/skills by bare name in `<artifact-root>/config/PROJECT_CONFIG.md`; the governance file resolves each name to its source. Names absent from the catalog are rejected by `project-config-mutate`.

Note: `source_ref` is not version-pinned. If a referenced MCP server or Claude built-in plugin changes behavior upstream, consumer projects may observe drift. Pin via the consumer's own `/plugin` state, not via this registry.

## Target-repo expectations

### Artifact root

Throughout this README, `<artifact-root>` is the absolute path resolved by `hooks/lib/artifact-root.js` for the current consumer repo. The plugin supports two layouts, picked at `/ai-agents-workflow:init`:

| Layout         | Resolved path                                          | When to use                                                                 |
|----------------|--------------------------------------------------------|-----------------------------------------------------------------------------|
| **In-project** | `<cwd>/.claude/aiaw-data-<project>/`                   | Default. Lives under the project's `.claude/` directory. No permission grant needed. Add `.claude/aiaw-data-<project>/` to `.gitignore` if you want it untracked (or rely on your existing `.claude/` ignore). |
| **Sibling**    | `<dirname(cwd)>/aiaw-data-<project>/`                  | Keeps the project tree completely free of artifacts. Requires a one-key entry in `<project>/.claude/settings.local.json` (auto-merged by `init`). |

`<project>` is `path.basename(process.cwd())` — your project folder name, no slugification. The legacy `ai-workflow-data/` layout is no longer supported (see Migration below).

### Migration from `ai-workflow-data/`

If you used an earlier version of this plugin, your artifacts live at `./ai-workflow-data/`. That location is no longer recognized. Rename the folder before running any workflow command:

```bash
# In-project layout (artifacts stay inside the repo, under .claude/)
mkdir -p .claude
mv ai-workflow-data .claude/aiaw-data-<project>

# OR — sibling layout (artifacts move out of the repo)
mv ai-workflow-data ../aiaw-data-<project>
```

For the sibling layout, also merge a permission entry into `<project>/.claude/settings.local.json` (this file is gitignored by Claude Code default — never committed). The plugin ships a helper that does this safely:

```bash
node "$CLAUDE_PLUGIN_ROOT/hooks/bin/write-additional-dir.js" "../aiaw-data-<project>"
```

Or, if you prefer to edit by hand, the resulting JSON should look like:

```json
{
  "permissions": {
    "additionalDirectories": ["../aiaw-data-<project>"]
  }
}
```

Replace `<project>` with your project folder name. After renaming, resume any in-flight task with `/ai-agents-workflow:continue`. The hooks detect the legacy folder and refuse to dispatch agents until the rename is performed, so missing this step is loud, not silent.

### Paths used by the plugin

This plugin reads and writes files under `<artifact-root>/` in the consumer repo. The main paths are:

1. `<artifact-root>/config/PROJECT_CONFIG.md` — per-project overlay. Sections used by the pipeline:
   - `<!-- section:domains -->`
   - `<!-- section:<domain> -->` / `<!-- section:<domain>-baseline -->`
   - `<!-- section:api-baseline -->` and `<!-- section:auth-baseline -->` for BE
   - `<!-- section:project-best-practices -->`
   - `<!-- section:agent-best-practices -->`
   - `<!-- section:extra-trigger-keywords -->` (optional)
   - `<!-- section:cross-domain-rules -->` (read by delivery-pm)
   - `<!-- section:quality-gates -->` (read by reviewer and executor)
2. `<artifact-root>/config/domain-contexts.cache.md` + `domain-contexts.cache.manifest.json` — **derived cache** of the pre-extracted sections above. The `.md` file is the concatenation of every cached section block (anchors preserved); the manifest is written last as the completion marker. Regenerated automatically by `init` / `update` / `add` / `remove`; never hand-edit. `context-minimizer` reads from this cache instead of grepping PROJECT_CONFIG.md on every agent dispatch. Contents are project-dependent — a Python-only backend repo's cache will not contain an `fe-baseline` block. The legacy fan-out layout (`domain-contexts/<tag>.md` + `_manifest.json`) is no longer written and gets removed on next regeneration if present. See `skills/project-config/project-config-template/SKILL.md` → "Derived Context Cache" for the exact format.
3. `<artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` — per-subtask artifact. The `pre-task-guard` hook blocks any non-exempt Task dispatch if this file is missing.
4. `<artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/summary.md` — per-subtask summary with diagnostics such as telemetry, context manifests, and dispatch-bundle audit details.
5. Dispatch bundles are not persisted to disk. The orchestrator composes each bundle in memory via the `context-minimizer` skill and embeds it inline in the Task `prompt` parameter (between `<!-- dispatch-bundle:start ... -->` and `<!-- dispatch-bundle:end -->` markers). A one-line audit per dispatch is appended to `<subtask_id>/summary.md` → `<!-- section:dispatch-bundles -->`.
6. `<artifact-root>/tasks/<task_id>/orchestration-state.json` — **hot** orchestrator state (current cursor: phase, current_subtask, pending_subtasks, blocked_gates, pending_user_actions, subtask_offsets). Read before every subtask transition.
7. `<artifact-root>/tasks/<task_id>/orchestration-history.json` — **history** orchestrator state (`completed_subtasks[]` with validated sections, `trigger_decisions{}`). Written once per subtask completion; read only at P2/P4 gates, resume, and retrospective. Separated from hot state so task-history growth doesn't inflate per-dispatch read cost. See `skills/shared/orchestrator-state/SKILL.md` for the schema.

The `pre-task-guard` hook reads the subtask's `ai-work.md` spec section for trigger keyword matching during its Phase 4 (trigger evaluation) step. It does NOT scan `.claude/plans/`.

Run `/ai-agents-workflow:init` in a fresh consumer repo (or use natural language: "initialize project config") to generate `<artifact-root>/config/PROJECT_CONFIG.md` and scaffold `<artifact-root>/tasks/`. Modes: `init` | `update` | `add` | `remove`, each available as a corresponding `/ai-agents-workflow:<mode>` command.

## What's inside

- `agents/` — 10 subagent definitions: `chief-orchestrator`, `delivery-pm`, `lead`, `executor`, `design-agent`, `reviewer`, `integration-checker`, `init`, `resume-orchestrator`, `pr-lessons-harvester`.
- `skills/` — 28 skills organized into folder groups:
  - **Task-pipeline stages:**
    - `skills/intake/` (2): `orchestrator-intake`, `task-packet`
    - `skills/planning/` (5): `delivery-plan`, `technical-execution-packet`, `multi-approach-architecture`, `codebase-exploration`, `plan-addendum`
    - `skills/execution/` (3): `implementation-report`, `review-report`, `integration-check`
    - `skills/closure/` (1): `post-task-review`
    - `skills/shared/` (10): cross-cutting orchestration skills used in every task stage — `orchestrator-state`, `orchestrator-dispatch`, `orchestrator-user-gates`, `orchestrator-degraded`, `orchestrator-telemetry`, `context-minimizer`, `blocker-escalation-report`, `reversal-packet`, `resolve-artifact-root`, `telemetry-summary`
  - **Side flows** (independent of the task pipeline):
    - `skills/project-config/` (4): owned by `/init`, `/add`, `/update`, `/remove`
    - `skills/pr-lessons/` (3): owned by `/pr-lessons`; `pr-lessons-check` is also consulted by Executor and Reviewer during execution
- `hooks/` — Node.js hook scripts plus `hooks/hooks.json`. Notable: `pre-task-guard.js` (Phase 0 plan-mode block + Phases 1–4 + Phase 3.5 stage guard), `lib/plan-mode-check.js` + `lib/plan-mode-message.js` (plan-mode detection helper + canonical error message).
- `commands/` — 8 user-facing slash commands (`init`, `add`, `update`, `remove`, `task`, `continue`, `pr-lessons`, `review`) namespaced as `/ai-agents-workflow:<command>`.
- `ai/core/`, `ai/governance/`, `ai/playbooks/`, `ai/agents/` — canonical governance docs.

See `CLAUDE.md` for the full layout and path conventions.

## Hooks & Guards

The plugin enforces workflow discipline via Node.js hooks wired through [hooks/hooks.json](hooks/hooks.json). All guards are synchronous, fail-open on missing input, and exit fast (5s timeout each).

| Hook | Event / Matcher | Blocks when… |
| --- | --- | --- |
| `pre-task-guard.js` | `PreToolUse(Task)` | Plan mode is active (Phase 0, chief only), subtask skeleton missing, P1 gate unmet, stage discipline violated, or trigger evaluation fails. |
| `guard-agent-reads.js` | `PreToolUse(Read)` | Audit-only (non-blocking). |
| `guard-main-thread-mutations.js` | `PreToolUse(Edit\|Write\|Bash)` | Main thread tries to mutate `<artifact-root>` outside dispatch. |
| `guard-orchestrator-source-writes.js` | `PreToolUse(Edit\|Write\|Bash)` | Plugin source files are written from a non-orchestrator caller. |
| `guard-main-thread-skills.js` | `PreToolUse(Skill)` | Main thread invokes a dispatched-only skill before chief-orchestrator handoff. |
| `guard-chief-orchestrator-stop.js` | `SubagentStop` | Chief-orchestrator returns without satisfying the executor-required stop guard. |
| `validate-artifact-chain.js` | `PostToolUse(Write\|Edit)` | Audit-only — verifies `<!-- section:* -->` markers. |
| `validate-summary-telemetry.js` | `PostToolUse(Write\|Edit)` | Audit-only — verifies telemetry / context manifest. |

### Troubleshooting

If a hook blocks an action, the stderr message names the exact remediation skill (e.g., `orchestrator-user-gates` for an unmet P1 gate). Read the message and re-run after fixing.

**Emergency kill switches** (set in your shell environment; do NOT commit to settings):

- `AIAW_DISABLE_PLAN_MODE_GUARD=1` — bypass `pre-task-guard.js` Phase 0 (plan-mode block on chief-orchestrator dispatch). Use only when you need the orchestrator to dispatch from inside plan mode and accept that ExitPlanMode tracking is skipped.
- `AIAW_DISABLE_STAGE_GUARD=1` — bypass Phase 3.5 stage discipline in `pre-task-guard.js`. Use only when recovering from a corrupted `orchestration-state.json`; restore the file and unset immediately.

Other guards have no kill switch by design — they enforce invariants the workflow cannot reason about if violated.

## Development

Plugin-internal paths use `${CLAUDE_PLUGIN_ROOT}` in markdown and hook configs, and `process.env.CLAUDE_PLUGIN_ROOT` in Node.js scripts. Test changes locally via `/plugin marketplace update` without reinstall.

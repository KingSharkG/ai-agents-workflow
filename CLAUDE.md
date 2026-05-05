# ai-agents-workflow — Claude Code Plugin

Portable multi-agent governance layer. Packages the orchestration, lead/executor, delivery-PM, design, reviewer, integration-checker, and init roles as a single installable plugin, plus the governance skills and hook scripts listed below.

## Layout

- `.claude-plugin/plugin.json` — plugin manifest
- `.claude-plugin/marketplace.json` — local marketplace entry
- `agents/` — ten subagent definitions (orchestrator, lead, executor, delivery-pm, design-agent, reviewer, integration-checker, init, resume-orchestrator, pr-lessons-harvester)
- `skills/` — governance skills: base eleven (task-packet, technical-execution-packet, delivery-plan, implementation-report, review-report, integration-check, telemetry-summary, context-minimizer, plan-addendum, blocker-escalation-report, reversal-packet), four project-config skills (project-discovery, project-config-template, project-config-review, project-config-mutate), two Lead-side pre-TEP skills (codebase-exploration, multi-approach-architecture) that integrate exploration and multi-option architecture into the TEP / `ai-work.md` artifact chain, and three PR-lessons skills (pr-lesson-extraction, pr-lessons-store, pr-lessons-check) for harvesting and consulting review feedback
- `commands/` — seven user-facing slash commands (`init`, `add`, `update`, `remove`, `task`, `continue`, `pr-lessons`) that namespace as `/ai-agents-workflow:<command>`; thin entry-points dispatching the `init`, `chief-orchestrator`, `resume-orchestrator`, or `pr-lessons-harvester` subagent
- `hooks/` — Node.js hook scripts wired via `hooks/hooks.json`: `pre-task-guard` (blocking `Task` PreToolUse — consolidates skeleton + P1 gate + trigger evaluation into one process per dispatch), `guard-agent-reads` (`Read` PreToolUse), `guard-orchestrator-source-writes` (blocking `Edit|Write|Bash` PreToolUse), `validate-artifact-chain` (`Write|Edit` PostToolUse), `validate-summary-telemetry` (`Write|Edit` PostToolUse)
- `ai/core/PROJECT_CONSTITUTION.md` — workflow rules, Definition of Done
- `ai/governance/` — trigger rules, review checklist, artifact discipline, resolution policy (helper plugins/skills)
- `ai/playbooks/ORCHESTRATION.md` — default flow (Step 0 intake classification through Step 15 completion), dispatch bundles, orchestrator state, token-saving rules
- `ai/agents/` — canonical stack-agnostic role docs. Each per-role file embeds a `<!-- role-contract:<role> -->` marker block that `context-minimizer` reads verbatim on every dispatch and copies into the bundle's `## Role Contract` section. The surrounding prose is human documentation; only the marker block is load-bearing at runtime.

## Paths inside this plugin

Agent stubs, role contracts, and skills reference plugin-internal docs via `${CLAUDE_PLUGIN_ROOT}/ai/...`. The Claude Code harness exports `CLAUDE_PLUGIN_ROOT` to tool subprocesses; agents resolve it by running `echo $CLAUDE_PLUGIN_ROOT` in Bash, then passing the absolute path to the `Read` tool.

## Consumer-repo expectations

`<artifact-root>` is the resolved absolute path returned by `hooks/lib/artifact-root.js` for the current consumer repo. It points at one of two supported layouts, picked at `/ai-agents-workflow:init`:

- **In-project layout** — `<cwd>/.claude/aiaw-data-<project>/`
- **Sibling layout**    — `<dirname(cwd)>/aiaw-data-<project>/`

`<project>` is `path.basename(cwd)` — the consumer-project folder name, no slugification. The in-project layout sits under `.claude/` so the project root stays clean and no `additionalDirectories` permission grant is required (Claude Code already has access to anything under CWD). Hooks resolve the root at runtime; the chief-orchestrator injects the absolute path into every dispatch bundle via the `<!-- artifact-root: ... -->` fact line. The legacy `ai-workflow-data/` directory is no longer supported — see README → "Migration from ai-workflow-data".

The plugin reads files from the consumer repo (NOT from the plugin), under `<artifact-root>/`:

- `<artifact-root>/config/PROJECT_CONFIG.md` — per-project overlay: domains, baselines, cross-domain rules, quality gates, per-domain skills/plugins, `<!-- section:extra-trigger-keywords -->`. Generated and maintained by the `init` agent.
- `<artifact-root>/config/domain-contexts.cache.md` + `domain-contexts.cache.manifest.json` — derived cache of pre-extracted PROJECT_CONFIG.md sections. The `.md` file concatenates every cached section block (anchors preserved); the manifest is written last as the completion marker. Regenerated on every `init` / `update` / `add` / `remove`; read by `context-minimizer` during bundle assembly instead of re-extracting. Never hand-edit. Contents are project-dependent — only sections present in PROJECT_CONFIG.md appear in the cache. The legacy fan-out layout (`domain-contexts/<tag>.md` + `_manifest.json`) is no longer written and gets removed on the next regeneration if present. See `skills/project-config-template/SKILL.md` → "Derived Context Cache".
- `<artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` — per-subtask artifact. Must exist before dispatching any non-exempt agent, or the `pre-task-guard` hook blocks the Task call.
- `<artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/summary.md` — per-subtask summary with diagnostics (telemetry, context manifest, dispatch bundle audit). Created by orchestrator alongside ai-work.md, finalized by Reviewer.
- Dispatch bundles are NOT persisted to disk. The orchestrator composes each bundle in memory via `context-minimizer` and embeds it inline in the Task `prompt` parameter (between `<!-- dispatch-bundle:start ... -->` and `<!-- dispatch-bundle:end -->` markers). The only on-disk record is a one-line audit entry per dispatch in `<subtask_id>/summary.md` → `<!-- section:dispatch-bundles -->`.
- `<artifact-root>/tasks/<task_id>/orchestration-state.json` — **hot** orchestrator state (execution cursor: phase, current_subtask, pending_subtasks, blocked_gates, pending_user_actions, subtask_offsets). Read before every subtask transition.
- `<artifact-root>/tasks/<task_id>/orchestration-history.json` — **history** orchestrator state (`completed_subtasks[]` with validated sections + `trigger_decisions{}`). Written once per subtask completion, read only at P2/P4 gates, resume, and post-task retrospective. Split from hot state so task-history growth doesn't inflate per-dispatch read cost. See `skills/orchestrator-state/SKILL.md`.

Run `/ai-agents-workflow:init` in a new consumer project (or natural language: "initialize project config") to generate `<artifact-root>/config/PROJECT_CONFIG.md` and scaffold `<artifact-root>/tasks/`. The full slash-command surface (`init` | `add` | `update` | `remove` | `task` | `continue`) is documented in `README.md` → **Usage**.

## Intake Classification

The `/ai-agents-workflow:task` command classifies requests into five paths (`direct-answer`, `plan-only`, `execution-trivial`, `execution-simple`, `execution-full`) at Step 0 before entering the pipeline. Questions get direct answers with no artifacts; plan-only requests stop after delivery plan approval (resumable via `/continue`); trivial mechanical changes (typo, single-string update, single-line bump) follow a compressed flow that skips Delivery PM + P1 + Lead and dispatches Executor with an inline TEP; simple tasks prefer lightweight execution paths within the full pipeline; everything else runs the full pipeline. See `ai/agents/chief-orchestrator.md` → Intake Classification Protocol and `ai/playbooks/ORCHESTRATION.md` → `<!-- section:trivial-flow -->`.

## Installation

See `README.md` for remote-marketplace install, local development install, and verification.

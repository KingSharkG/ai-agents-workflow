# ai-agents-workflow — Claude Code Plugin

Portable multi-agent governance layer. Packages the orchestration, lead/executor, delivery-PM, design, reviewer, integration-checker, and init roles as a single installable plugin, plus the governance skills and hook scripts listed below.

## Layout

- `.claude-plugin/plugin.json` — plugin manifest
- `.claude-plugin/marketplace.json` — local marketplace entry
- `agents/` — nine subagent definitions (orchestrator, lead, executor, delivery-pm, design-agent, reviewer, integration-checker, init, resume-orchestrator)
- `skills/` — governance skills: base eleven (task-packet, technical-execution-packet, delivery-plan, implementation-report, review-report, integration-check, telemetry-summary, context-minimizer, plan-addendum, blocker-escalation-report, reversal-packet), four project-config skills (project-discovery, project-config-template, project-config-review, project-config-mutate), and two Lead-side pre-TEP skills (codebase-exploration, multi-approach-architecture) that replace implicit exploration and single-design patterns and are the ai-agents-workflow counter-offer to `feature-dev:code-explorer` / `feature-dev:code-architect`
- `commands/` — six user-facing slash commands (`init`, `add`, `update`, `remove`, `task`, `continue`) that namespace as `/ai-agents-workflow:<command>`; thin entry-points dispatching the `init`, `chief-orchestrator`, or `resume-orchestrator` subagent
- `hooks/` — Node.js hook scripts wired via `hooks/hooks.json`: `guard-forbidden-workflows` (blocking `Task` + `Skill` PreToolUse — denies competing workflow orchestrators per `ai/governance/FORBIDDEN_WORKFLOWS.md`), `guard-subtask-skeleton` (blocking `Task` PreToolUse), `evaluate-triggers` (`Task` PreToolUse), `guard-agent-reads` (`Read` PreToolUse), `validate-artifact-chain` (`Write|Edit` PostToolUse), `validate-dispatch-bundle` (`Write|Edit` PostToolUse), `validate-summary-telemetry` (`Write|Edit` PostToolUse)
- `ai/core/PROJECT_CONSTITUTION.md` — workflow rules, Definition of Done
- `ai/governance/` — trigger rules, review checklist, artifact discipline, resolution policy (helper plugins/skills), **`FORBIDDEN_WORKFLOWS.md`** (competing orchestrators — hard-denylisted)
- `ai/playbooks/ORCHESTRATION.md` — default flow (Step 0 intake classification through Step 15 completion), dispatch bundles, orchestrator state, token-saving rules
- `ai/agents/` — canonical stack-agnostic role docs. Each per-role file embeds a `<!-- role-contract:<role> -->` marker block that `context-minimizer` reads verbatim on every dispatch and copies into the bundle's `## Role Contract` section. The surrounding prose is human documentation; only the marker block is load-bearing at runtime.

## Paths inside this plugin

Agent stubs, role contracts, and skills reference plugin-internal docs via `${CLAUDE_PLUGIN_ROOT}/ai/...`. The Claude Code harness exports `CLAUDE_PLUGIN_ROOT` to tool subprocesses; agents resolve it by running `echo $CLAUDE_PLUGIN_ROOT` in Bash, then passing the absolute path to the `Read` tool.

## Consumer-repo expectations

The plugin reads files from the consumer repo (NOT from the plugin), under `ai-workflow-data/`:

- `ai-workflow-data/config/PROJECT_CONFIG.md` — per-project overlay: domains, baselines, cross-domain rules, quality gates, per-domain skills/plugins, `<!-- section:extra-trigger-keywords -->`. Generated and maintained by the `init` agent.
- `ai-workflow-data/config/domain-contexts.cache.md` + `domain-contexts.cache.manifest.json` — derived cache of pre-extracted PROJECT_CONFIG.md sections. The `.md` file concatenates every cached section block (anchors preserved); the manifest is written last as the completion marker. Regenerated on every `init` / `update` / `add` / `remove`; read by `context-minimizer` during bundle assembly instead of re-extracting. Never hand-edit. Contents are project-dependent — only sections present in PROJECT_CONFIG.md appear in the cache. The legacy fan-out layout (`domain-contexts/<tag>.md` + `_manifest.json`) is no longer written and gets removed on the next regeneration if present. See `skills/project-config-template/SKILL.md` → "Derived Context Cache".
- `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` — per-subtask artifact. Must exist before dispatching any non-exempt agent, or the `guard-subtask-skeleton` hook blocks the Task call.
- `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/summary.md` — per-subtask summary with diagnostics (telemetry, context manifest, dispatch bundle audit). Created by orchestrator alongside ai-work.md, finalized by Reviewer.
- `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/roles/<role>.md` — dispatch bundles written by orchestrator before each agent dispatch. Contain pre-curated role context (contract excerpts, config, governance, artifact input).
- `ai-workflow-data/tasks/<task_id>/orchestration-state.json` — **hot** orchestrator state (execution cursor: phase, current_subtask, pending_subtasks, blocked_gates, pending_user_actions, subtask_offsets). Read before every subtask transition.
- `ai-workflow-data/tasks/<task_id>/orchestration-history.json` — **history** orchestrator state (`completed_subtasks[]` with validated sections + `trigger_decisions{}`). Written once per subtask completion, read only at P2/P4 gates, resume, and post-task retrospective. Split from hot state so task-history growth doesn't inflate per-dispatch read cost. See `skills/orchestrator-state/SKILL.md`.

Run `/ai-agents-workflow:init` in a new consumer project (or natural language: "initialize project config") to generate `ai-workflow-data/config/PROJECT_CONFIG.md` and scaffold `ai-workflow-data/tasks/`. The full slash-command surface (`init` | `add` | `update` | `remove` | `task` | `continue`) is documented in `README.md` → **Usage**.

## Intake Classification

The `/ai-agents-workflow:task` command classifies requests into four paths (`direct-answer`, `plan-only`, `execution-simple`, `execution-full`) at Step 0 before entering the pipeline. Questions get direct answers with no artifacts; plan-only requests stop after delivery plan approval (resumable via `/continue`); simple tasks prefer lightweight execution paths; everything else runs the full pipeline. See `ai/agents/chief-orchestrator.md` → Intake Classification Protocol.

## Installation

See `README.md` for remote-marketplace install, local development install, and verification.

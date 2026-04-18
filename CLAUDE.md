# ai-agents-workflow — Claude Code Plugin

Portable multi-agent governance layer. Packages the orchestration, lead/executor, delivery-PM, design, reviewer, integration-checker, and init roles as a single installable plugin, plus fifteen governance skills and five hook scripts.

## Layout

- `.claude-plugin/plugin.json` — plugin manifest
- `.claude-plugin/marketplace.json` — local marketplace entry
- `agents/` — nine subagent definitions (orchestrator, lead, executor, delivery-pm, design-agent, reviewer, integration-checker, init, resume-orchestrator)
- `skills/` — fifteen governance skills: base eleven (task-packet, technical-execution-packet, delivery-plan, implementation-report, review-report, integration-check, telemetry-summary, context-minimizer, plan-addendum, blocker-escalation-report, reversal-packet) plus four project-config skills (project-discovery, project-config-template, project-config-review, project-config-mutate)
- `commands/` — six user-facing slash commands (`init`, `add`, `update`, `remove`, `task`, `continue`) that namespace as `/ai-agents-workflow:<command>`; thin entry-points dispatching the `init`, `chief-orchestrator`, or `resume-orchestrator` subagent
- `hooks/` — five Node.js hook scripts wired via `hooks/hooks.json`: `guard-subtask-skeleton` (blocking `Task` PreToolUse), `evaluate-triggers` (`Task` PreToolUse), `guard-agent-reads` (`Read` PreToolUse), `validate-artifact-chain` (`Write|Edit` PostToolUse), `validate-dispatch-bundle` (`Write|Edit` PostToolUse)
- `ai/core/PROJECT_CONSTITUTION.md` — workflow rules, Definition of Done
- `ai/governance/` — trigger rules, review checklist, artifact discipline, resolution policy (skills + plugins)
- `ai/playbooks/ORCHESTRATION.md` — default flow (Step 0 intake classification through Step 15 completion), dispatch bundles, orchestrator state, token-saving rules
- `ai/agents/` — canonical stack-agnostic role contracts (source of truth for `agents/` stubs)

## Paths inside this plugin

Agent stubs, role contracts, and skills reference plugin-internal docs via `${CLAUDE_PLUGIN_ROOT}/ai/...`. The Claude Code harness exports `CLAUDE_PLUGIN_ROOT` to tool subprocesses; agents resolve it by running `echo $CLAUDE_PLUGIN_ROOT` in Bash, then passing the absolute path to the `Read` tool.

## Consumer-repo expectations

The plugin reads files from the consumer repo (NOT from the plugin), under `ai-workflow-data/`:

- `ai-workflow-data/config/PROJECT_CONFIG.md` — per-project overlay: domains, baselines, cross-domain rules, quality gates, per-domain skills/plugins, `<!-- section:extra-trigger-keywords -->`. Generated and maintained by the `init` agent.
- `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` — per-subtask artifact. Must exist before dispatching any non-exempt agent, or the `guard-subtask-skeleton` hook blocks the Task call.
- `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/summary.md` — per-subtask summary with diagnostics (telemetry, context manifest, dispatch bundle audit). Created by orchestrator alongside ai-work.md, finalized by Reviewer.
- `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/roles/<role>.md` — dispatch bundles written by orchestrator before each agent dispatch. Contain pre-curated role context (contract excerpts, config, governance, artifact input).
- `ai-workflow-data/tasks/<task_id>/orchestration-state.json` — orchestrator state persistence between subtasks.

Run `/ai-agents-workflow:init` in a new consumer project (or natural language: "initialize project config") to generate `ai-workflow-data/config/PROJECT_CONFIG.md` and scaffold `ai-workflow-data/tasks/`. The full slash-command surface (`init` | `add` | `update` | `remove` | `task` | `continue`) is documented in `README.md` → **Usage**.

## Intake Classification

The `/ai-agents-workflow:task` command classifies requests into four paths (`direct-answer`, `plan-only`, `execution-simple`, `execution-full`) at Step 0 before entering the pipeline. Questions get direct answers with no artifacts; plan-only requests stop after delivery plan approval (resumable via `/continue`); simple tasks prefer lightweight execution paths; everything else runs the full pipeline. See `ai/agents/chief-orchestrator.md` → Intake Classification Protocol.

## Installation

See `README.md` for remote-marketplace install, local development install, and verification.

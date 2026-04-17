# ai-agents-workflow — Claude Code Plugin

Portable multi-agent governance layer. Packages the orchestration, lead/executor, delivery-PM, design, reviewer, integration-checker, and init roles as a single installable plugin, plus fifteen governance skills and three enforcement hooks.

## Layout

- `.claude-plugin/plugin.json` — plugin manifest
- `.claude-plugin/marketplace.json` — local marketplace entry
- `agents/` — eight subagent definitions (orchestrator, lead, executor, delivery-pm, design-agent, reviewer, integration-checker, init)
- `skills/` — fifteen governance skills: base eleven (task-packet, technical-execution-packet, delivery-plan, implementation-report, review-report, integration-check, telemetry-summary, context-minimizer, plan-addendum, blocker-escalation-report, reversal-packet) plus four project-config skills (project-discovery, project-config-template, project-config-review, project-config-mutate)
- `commands/` — five user-facing slash commands (`init`, `add`, `update`, `remove`, `task`) that namespace as `/ai-agents-workflow:<command>`; thin entry-points dispatching the `init` or `chief-orchestrator` subagent
- `hooks/` — three hooks with `hooks/hooks.json`: `guard-subtask-skeleton` (blocking PreToolUse), `evaluate-triggers` (observation PreToolUse), `validate-artifact-chain` (PostToolUse)
- `ai/core/PROJECT_CONSTITUTION.md` — workflow rules, Definition of Done
- `ai/governance/` — trigger rules, review checklist, artifact discipline, resolution policy (skills + plugins)
- `ai/playbooks/ORCHESTRATION.md` — default flow, telemetry, context manifest, token-saving rules
- `ai/agents/` — canonical stack-agnostic role contracts (source of truth for `agents/` stubs)

## Paths inside this plugin

Agent stubs, role contracts, and skills reference plugin-internal docs via `${CLAUDE_PLUGIN_ROOT}/ai/...`. The Claude Code harness exports `CLAUDE_PLUGIN_ROOT` to tool subprocesses; agents resolve it by running `echo $CLAUDE_PLUGIN_ROOT` in Bash, then passing the absolute path to the `Read` tool.

## Consumer-repo expectations

The plugin reads two files from the consumer repo (NOT from the plugin), both under `ai-workflow-data/`:

- `ai-workflow-data/config/PROJECT_CONFIG.md` — per-project overlay: domains, baselines, cross-domain rules, quality gates, per-domain skills/plugins, `<!-- section:extra-trigger-keywords -->`. Generated and maintained by the `init` agent.
- `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` — per-subtask artifact. Must exist before dispatching any non-exempt agent, or the `guard-subtask-skeleton` hook blocks the Task call.

Consumer repos should also keep a `.claude/plans/` directory so `evaluate-triggers` can scan the active plan for trigger keywords.

Run `/ai-agents-workflow:init` in a new consumer project (or natural language: "initialize project config") to generate `ai-workflow-data/config/PROJECT_CONFIG.md` and scaffold `ai-workflow-data/tasks/`. The full slash-command surface (`init` | `add` | `update` | `remove` | `task`) is documented in `README.md` → **Usage**.

## Installation

See `README.md` for local-marketplace install and verification.

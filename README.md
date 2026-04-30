# ai-agents-workflow

A Claude Code plugin that installs a portable multi-agent governance pipeline into any repo: chief-orchestrator, delivery-PM, lead, executor, design-agent, reviewer, integration-checker, init, plus fifteen governance skills and five hook scripts.

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

Five namespaced slash commands cover the plugin's surface:

| Command                                                           | Purpose                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `/ai-agents-workflow:init`                                        | Bootstrap `ai-workflow-data/config/PROJECT_CONFIG.md` |
| `/ai-agents-workflow:add <target-type> <value> [--domain <d>]`    | Add a config entry                                    |
| `/ai-agents-workflow:update`                                      | Refresh CLI-owned sections of the config              |
| `/ai-agents-workflow:remove <target-type> <value> [--domain <d>]` | Remove a config entry                                 |
| `/ai-agents-workflow:task <description>`                          | Classify and route a task (see Intake Classification) |
| `/ai-agents-workflow:continue [task_id]`                          | Resume an interrupted or in-progress task             |

Valid `<target-type>` values for `:add` / `:remove`: `domain`, `skill`, `plugin`, `baseline`, `validation-rule`, `forbidden-action`, `best-practice`, `cross-domain-rule`.

Natural-language invocations (e.g., "initialize project config") still work — the slash commands are a typed shortcut, not a replacement.

### Intake Classification

The `/ai-agents-workflow:task` command classifies each request before deciding how much of the pipeline to run:

| Classification | When | What happens |
|----------------|------|-------------|
| `direct-answer` | Question, explanation, advice, summary | Orchestrator answers inline — no artifacts, no agents |
| `plan-only` | User explicitly wants only a plan or proposal | Creates Task Packet + Delivery Plan, stops after approval. Resume later with `/continue` |
| `execution-simple` | Small, low-risk code change (single-file, no schema/API/auth change) | Runs the workflow with lightweight/ultra-light paths preferred |
| `execution-full` | Everything else (default) | Runs the full orchestration pipeline |

If the request is ambiguous, the orchestrator asks one clarifying question before proceeding. See `ai/agents/chief-orchestrator.md` → Intake Classification Protocol for the full heuristics.

## External sources

The plugin's governance catalog (`ai/governance/RESOLUTION_POLICY.md`) is authoritative for every skill or plugin a consumer project may reference. See `<!-- section:external-sources -->` for the supported source taxonomy: `mcp-server`, `claude-builtin`, `github-marketplace`, `consumer-marketplace`, `npx-skills-find`, `local-plugin`. A consumer project references plugins/skills by bare name in `ai-workflow-data/config/PROJECT_CONFIG.md`; the governance file resolves each name to its source. Names absent from the catalog are rejected by `project-config-mutate`.

Note: `source_ref` is not version-pinned. If a referenced MCP server or Claude built-in plugin changes behavior upstream, consumer projects may observe drift. Pin via the consumer's own `/plugin` state, not via this registry.

## Target-repo expectations

This plugin reads and writes files under `ai-workflow-data/` in the consumer repo. The main paths are:

1. `ai-workflow-data/config/PROJECT_CONFIG.md` — per-project overlay. Sections used by the pipeline:
   - `<!-- section:domains -->`
   - `<!-- section:<domain> -->` / `<!-- section:<domain>-baseline -->`
   - `<!-- section:api-baseline -->` and `<!-- section:auth-baseline -->` for BE
   - `<!-- section:project-best-practices -->`
   - `<!-- section:agent-best-practices -->`
   - `<!-- section:extra-trigger-keywords -->` (optional)
   - `<!-- section:cross-domain-rules -->` (read by delivery-pm)
   - `<!-- section:quality-gates -->` (read by reviewer and executor)
2. `ai-workflow-data/config/domain-contexts.cache.md` + `domain-contexts.cache.manifest.json` — **derived cache** of the pre-extracted sections above. The `.md` file is the concatenation of every cached section block (anchors preserved); the manifest is written last as the completion marker. Regenerated automatically by `init` / `update` / `add` / `remove`; never hand-edit. `context-minimizer` reads from this cache instead of grepping PROJECT_CONFIG.md on every agent dispatch. Contents are project-dependent — a Python-only backend repo's cache will not contain an `fe-baseline` block. The legacy fan-out layout (`domain-contexts/<tag>.md` + `_manifest.json`) is no longer written and gets removed on next regeneration if present. See `skills/project-config-template/SKILL.md` → "Derived Context Cache" for the exact format.
3. `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` — per-subtask artifact. The `guard-subtask-skeleton` hook blocks any non-exempt Task dispatch if this file is missing.
4. `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/summary.md` — per-subtask summary with diagnostics such as telemetry, context manifests, and dispatch-bundle audit details.
5. `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/roles/<role>.md` — dispatch bundles written before each agent handoff with pre-curated role context.
6. `ai-workflow-data/tasks/<task_id>/orchestration-state.json` — **hot** orchestrator state (current cursor: phase, current_subtask, pending_subtasks, blocked_gates, pending_user_actions, subtask_offsets). Read before every subtask transition.
7. `ai-workflow-data/tasks/<task_id>/orchestration-history.json` — **history** orchestrator state (`completed_subtasks[]` with validated sections, `trigger_decisions{}`). Written once per subtask completion; read only at P2/P4 gates, resume, and retrospective. Separated from hot state so task-history growth doesn't inflate per-dispatch read cost. See `skills/orchestrator-state/SKILL.md` for the schema.

The `evaluate-triggers` hook reads the subtask's `ai-work.md` spec section for trigger keyword matching. It does NOT scan `.claude/plans/`.

Run `/ai-agents-workflow:init` in a fresh consumer repo (or use natural language: "initialize project config") to generate `ai-workflow-data/config/PROJECT_CONFIG.md` and scaffold `ai-workflow-data/tasks/`. Modes: `init` | `update` | `add` | `remove`, each available as a corresponding `/ai-agents-workflow:<mode>` command.

## What's inside

- `agents/` — 9 subagent definitions (adds `init`, `resume-orchestrator`)
- `skills/` — 15 skills with SKILL.md each (adds `project-discovery`, `project-config-template`, `project-config-review`, `project-config-mutate`)
- `hooks/` — 5 Node.js hook scripts plus `hooks.json`
- `commands/` — 6 user-facing slash commands (`init`, `add`, `update`, `remove`, `task`, `continue`) namespaced as `/ai-agents-workflow:<command>`
- `ai/core/`, `ai/governance/`, `ai/playbooks/`, `ai/agents/` — canonical governance docs

See `CLAUDE.md` for the full layout and path conventions.

## Development

Plugin-internal paths use `${CLAUDE_PLUGIN_ROOT}` in markdown and hook configs, and `process.env.CLAUDE_PLUGIN_ROOT` in Node.js scripts. Test changes locally via `/plugin marketplace update` without reinstall.

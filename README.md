# ai-agents-workflow

A Claude Code plugin that installs a portable multi-agent governance pipeline into any repo: chief-orchestrator, delivery-PM, lead, executor, design-agent, reviewer, integration-checker, init, plus fifteen governance skills and three enforcement hooks.

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
```

## Install (local development)

If you have this repo cloned locally and want to iterate on the plugin itself:

```
/plugin marketplace add /User/ai-agents-workflow
/plugin install ai-agents-workflow@ai-agents-workflow
```

Pick up local edits via `/plugin marketplace update ai-agents-workflow` without reinstalling.

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
| `/ai-agents-workflow:task <description>`                          | Kick off a new task through the chief-orchestrator    |

Valid `<target-type>` values for `:add` / `:remove`: `domain`, `skill`, `plugin`, `baseline`, `validation-rule`, `forbidden-action`, `best-practice`, `cross-domain-rule`.

Natural-language invocations (e.g., "initialize project config") still work — the slash commands are a typed shortcut, not a replacement.

## External sources

The plugin's governance catalog (`ai/governance/RESOLUTION_POLICY.md`) is authoritative for every skill or plugin a consumer project may reference. See `<!-- section:external-sources -->` for the supported source taxonomy: `mcp-server`, `claude-builtin`, `github-marketplace`, `consumer-marketplace`, `npx-skills-find`, `local-plugin`. A consumer project references plugins/skills by bare name in `ai-workflow-data/config/PROJECT_CONFIG.md`; the governance file resolves each name to its source. Names absent from the catalog are rejected by `project-config-mutate`.

Note: `source_ref` is not version-pinned. If a referenced MCP server or Claude built-in plugin changes behavior upstream, consumer projects may observe drift. Pin via the consumer's own `/plugin` state, not via this registry.

## Target-repo expectations

This plugin reads two files from the consumer repo's working directory, both under `ai-workflow-data/`:

1. `ai-workflow-data/config/PROJECT_CONFIG.md` — per-project overlay. Sections used by the pipeline:
   - `<!-- section:domains -->`
   - `<!-- section:<domain> -->` / `<!-- section:<domain>-baseline -->`
   - `<!-- section:api-baseline -->` and `<!-- section:auth-baseline -->` for BE
   - `<!-- section:project-best-practices -->`
   - `<!-- section:agent-best-practices -->`
   - `<!-- section:extra-trigger-keywords -->` (optional)
   - `<!-- section:cross-domain-rules -->` (read by delivery-pm)
   - `<!-- section:quality-gates -->` (read by reviewer and executor)
2. `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` — per-subtask artifact. The `guard-subtask-skeleton` hook blocks any non-exempt Task dispatch if this file is missing.

The plugin also reads `.claude/plans/` (latest file by mtime) in the consumer repo to scan for trigger keywords.

Run `/ai-agents-workflow:init` in a fresh consumer repo (or use natural language: "initialize project config") to generate `ai-workflow-data/config/PROJECT_CONFIG.md` and scaffold `ai-workflow-data/tasks/`. Modes: `init` | `update` | `add` | `remove`, each available as a corresponding `/ai-agents-workflow:<mode>` command.

## What's inside

- `agents/` — 8 subagent definitions (adds `init`)
- `skills/` — 15 skills with SKILL.md each (adds `project-discovery`, `project-config-template`, `project-config-review`, `project-config-mutate`)
- `hooks/` — 3 Node.js hook scripts plus `hooks.json`
- `commands/` — 5 user-facing slash commands (`init`, `add`, `update`, `remove`, `task`) namespaced as `/ai-agents-workflow:<command>`
- `ai/core/`, `ai/governance/`, `ai/playbooks/`, `ai/agents/` — canonical governance docs

See `CLAUDE.md` for the full layout and path conventions.

## Development

Plugin-internal paths use `${CLAUDE_PLUGIN_ROOT}` in markdown and hook configs, and `process.env.CLAUDE_PLUGIN_ROOT` in Node.js scripts. Test changes locally via `/plugin marketplace update` without reinstall.

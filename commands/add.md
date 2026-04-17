---
description: Add an entry (skill, plugin, baseline, etc.) to ai-workflow-data/config/PROJECT_CONFIG.md.
argument-hint: "<target-type> <value> [--domain <d>]"
allowed-tools: Task, AskUserQuestion
---

Dispatch the `init` subagent in `add` mode.

If `$ARGUMENTS` is empty, first use `AskUserQuestion` to collect:

- `target-type` — one of: `domain`, `skill`, `plugin`, `baseline`, `validation-rule`, `forbidden-action`, `best-practice`, `cross-domain-rule`
- `value` — the entry to add
- optional `--domain <d>` — when the target-type is domain-scoped

Then dispatch via the Task tool with `subagent_type: ai-agents-workflow:init` and prompt:

```
add $ARGUMENTS
```

The init agent will validate the target-type against the catalog, compute a unified diff, run the `project-config-review` gate, and apply the mutation atomically via the `project-config-mutate` skill. Names absent from `${CLAUDE_PLUGIN_ROOT}/ai/governance/RESOLUTION_POLICY.md` are rejected.

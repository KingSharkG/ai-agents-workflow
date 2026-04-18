---
description: Remove an entry from ai-workflow-data/config/PROJECT_CONFIG.md.
argument-hint: "<target-type> <value> [--domain <d>]"
allowed-tools: Task, AskUserQuestion
---

Dispatch the `init` subagent in `remove` mode.

Pre-flight: if CWD does not contain `ai-workflow-data/` and does contain `.claude-plugin/plugin.json`, surface: "You appear to be in the plugin directory. Run this command from your project repo instead." and exit without dispatching.

If `$ARGUMENTS` is empty, first use `AskUserQuestion` to collect:

- `target-type` — one of: `domain`, `skill`, `plugin`, `baseline`, `validation-rule`, `forbidden-action`, `best-practice`, `cross-domain-rule`
- `value` — the entry to remove
- optional `--domain <d>` — when the target-type is domain-scoped

Then dispatch via the Task tool with `subagent_type: ai-agents-workflow:init` and prompt:

```
remove $ARGUMENTS
```

The init agent validates, diffs, runs the `project-config-review` gate, and applies via `project-config-mutate`. Never silently deletes user-authored content.

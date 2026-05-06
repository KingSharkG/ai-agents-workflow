---
description: Remove an entry from <artifact-root>/config/PROJECT_CONFIG.md.
argument-hint: "<target-type> <value> [--domain <d>]"
allowed-tools: Task, AskUserQuestion, Bash(node:*), Skill
---

Dispatch the `init` subagent in `remove` mode.

Pre-flight: invoke the `ai-agents-workflow:resolve-artifact-root` skill to obtain `ARTIFACT_ROOT` for the dispatch. On resolver failure, follow the skill's mutating-command branch (exit without dispatching after the surfaced diagnostic).

If `$ARGUMENTS` is empty, first use `AskUserQuestion` to collect:

- `target-type` — one of: `domain`, `skill`, `plugin`, `baseline`, `validation-rule`, `forbidden-action`, `best-practice`, `cross-domain-rule`
- `value` — the entry to remove
- optional `--domain <d>` — when the target-type is domain-scoped

Then dispatch via the Task tool with `subagent_type: ai-agents-workflow:init` and prompt:

```
remove $ARGUMENTS
```

The init agent validates, diffs, runs the `project-config-review` gate, and applies via `project-config-mutate`. Never silently deletes user-authored content.

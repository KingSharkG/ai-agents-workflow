---
description: Bootstrap ai-workflow-data/config/PROJECT_CONFIG.md for this repo via the init agent.
argument-hint: "[--force]"
allowed-tools: Task
---

Dispatch the `init` subagent to bootstrap the consumer repo's project configuration.

Use the Task tool with `subagent_type: ai-agents-workflow:init` and pass this prompt to the agent:

```
init $ARGUMENTS
```

The init agent will:

1. Run the `project-discovery` skill (non-mutating ecosystem scan).
2. Ask scoped multiple-choice questions via `AskUserQuestion` for any ambiguous classification.
3. Run the `project-config-review` review-and-comment loop.
4. Write `ai-workflow-data/config/PROJECT_CONFIG.md` and ensure `ai-workflow-data/tasks/.gitkeep` exists.

If the file already exists and `--force` was not passed, the agent will exit with `already initialized`.

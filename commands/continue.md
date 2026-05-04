---
description: Resume an in-progress task by task_id, or show a menu of resumable tasks.
argument-hint: "[task_id or subtask_id]"
allowed-tools: Task, AskUserQuestion, Read
---

Dispatch the `resume-orchestrator` subagent to resume an interrupted workflow task.

If `$ARGUMENTS` is empty, the resume-orchestrator will discover all in-progress tasks automatically and present a menu or auto-continue as appropriate.

If `$ARGUMENTS` is non-empty, pass it as the `task_id` directly to the resume-orchestrator.

Pre-flight:
1. If CWD does not contain `<artifact-root>/` and does contain `.claude-plugin/plugin.json`, surface: "You appear to be in the plugin directory. Run this command from your project repo instead." and exit without dispatching.
2. If `<artifact-root>/config/PROJECT_CONFIG.md` does not exist in the consumer repo, surface a one-line note suggesting the user run `/ai-agents-workflow:init` first, then proceed only if the user confirms.

Then dispatch via the Task tool with `subagent_type: ai-agents-workflow:resume-orchestrator`, passing the following prompt:

```
resume $ARGUMENTS
```

The resume-orchestrator will:

1. Scan `<artifact-root>/tasks/` for all tasks with non-complete orchestration state.
2. Determine which task to resume (direct by task_id, auto-continue if one found, menu if multiple, done-summary if none).
3. Reconstruct task context from `orchestration-state.json` and relevant artifact sections.
4. Present a brief resume summary to the user (task_id, phase, what was completed, what's next).
5. Confirm with the user, then hand off to `chief-orchestrator` with full task context.

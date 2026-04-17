---
description: Kick off a new task through the chief-orchestrator pipeline.
argument-hint: "<freeform task description>"
allowed-tools: Task, AskUserQuestion, Read
---

Dispatch the `chief-orchestrator` subagent with the task description.

If `$ARGUMENTS` is empty, use `AskUserQuestion` to collect a one-line task description (the user can use the "Other" affordance for free text).

Pre-flight: if `ai-workflow-data/config/PROJECT_CONFIG.md` does not exist in the consumer repo, surface a one-line note suggesting the user run `/ai-agents-workflow:init` first, then proceed only if the user confirms.

Then dispatch via the Task tool with `subagent_type: chief-orchestrator`, passing the task description verbatim as a new task. The orchestrator will:

1. Produce a Task Packet via the `task-packet` skill at `ai-workflow-data/tasks/<task_id>/task-data.md`.
2. Hand off to Delivery PM, Lead, Executor, Reviewer, and Integration Checker per `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION.md` → `<!-- section:default-flow -->`.
3. Finalize `ai-workflow-data/tasks/<task_id>/summary.md` when all subtasks complete.

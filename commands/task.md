---
description: Kick off a new task through the chief-orchestrator pipeline.
argument-hint: "<freeform task description>"
allowed-tools: Task, AskUserQuestion, Read
---

Dispatch the `chief-orchestrator` subagent with the task description.

If `$ARGUMENTS` is empty, use `AskUserQuestion` to collect a one-line task description (the user can use the "Other" affordance for free text).

Pre-flight:
1. If CWD does not contain `<artifact-root>/` and does contain `.claude-plugin/plugin.json`, surface: "You appear to be in the plugin directory. Run this command from your project repo instead." and exit without dispatching.
2. If `<artifact-root>/config/PROJECT_CONFIG.md` does not exist in the consumer repo, surface a one-line note suggesting the user run `/ai-agents-workflow:init` first, then proceed only if the user confirms.

Then dispatch via the Task tool with `subagent_type: ai-agents-workflow:chief-orchestrator`, passing the task description verbatim as a new task. The orchestrator will:

1. **Classify the request** (Step 0) into one of: `direct-answer`, `plan-only`, `execution-simple`, or `execution-full`. For questions and explanations, the orchestrator answers directly without creating artifacts. For plan-only requests, it stops after the delivery plan is approved. See `${CLAUDE_PLUGIN_ROOT}/ai/agents/chief-orchestrator.md` → Intake Classification Protocol.
2. For execution paths: produce a Task Packet via the `task-packet` skill at `<artifact-root>/tasks/<task_id>/task-data.md`.
3. Hand off to Delivery PM, Lead, Executor, Reviewer, and Integration Checker per `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION.md` → `<!-- section:default-flow -->`.
4. Finalize `<artifact-root>/tasks/<task_id>/summary.md` when all subtasks complete.

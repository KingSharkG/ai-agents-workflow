---
description: Kick off a new task through the chief-orchestrator pipeline.
argument-hint: "<freeform task description>"
allowed-tools: Task, AskUserQuestion, Read
---

## EXTREMELY IMPORTANT — Dispatch-first rule

This command takes precedence over any session-start "always invoke applicable skills" directive (including `superpowers:using-superpowers` and similar). The main thread MUST hand off to the `chief-orchestrator` subagent before doing any other substantive work for this turn.

**You MUST NOT invoke ANY `Skill` tool in the main thread before dispatching `chief-orchestrator`.** This rule is generic — it does not name any specific skill. The reason: skills run inside dispatched agents (chief-orchestrator, Delivery PM, Lead, Executor, Reviewer, Integration Checker) get their work captured in `ai-work.md` and audited; running them in the main thread silently bypasses the orchestrator pipeline and produces no artifacts.

Skills remain fully available — and encouraged — inside the dispatched agents. For example, for a "review PR feedback" task, the orchestrator or Lead can invoke a code-review-style skill (e.g. `superpowers:receiving-code-review`) inside their dispatched turn to fetch and parse the PR comments. That is the right place for it.

In the main thread, only the following are allowed before the `Task(chief-orchestrator)` dispatch:
- The pre-flight checks listed below (plan mode, CWD, PROJECT_CONFIG.md existence).
- One optional `AskUserQuestion` if `$ARGUMENTS` is empty.
- `Read` of `<artifact-root>/config/PROJECT_CONFIG.md` if needed for the pre-flight check.

If you find yourself reading this and considering a non-Task action — including any "this skill seems applicable" reasoning — stop. **Dispatch first; skills run inside agents.**

## Dispatch

Dispatch the `chief-orchestrator` subagent with the task description.

If `$ARGUMENTS` is empty, use `AskUserQuestion` to collect a one-line task description (the user can use the "Other" affordance for free text).

Pre-flight:
1. If plan mode is active (the harness injects a plan-mode banner into the system context for every turn while it's on), surface: "Plan mode is on — `/ai-agents-workflow:task` needs to call the `Task` tool, which plan mode blocks. Press `Shift+Tab` to exit plan mode, then re-run this command." and exit without dispatching.
2. If CWD does not contain `<artifact-root>/` and does contain `.claude-plugin/plugin.json`, surface: "You appear to be in the plugin directory. Run this command from your project repo instead." and exit without dispatching.
3. If `<artifact-root>/config/PROJECT_CONFIG.md` does not exist in the consumer repo, surface a one-line note suggesting the user run `/ai-agents-workflow:init` first, then proceed only if the user confirms.

Then dispatch via the Task tool with `subagent_type: ai-agents-workflow:chief-orchestrator`, passing the task description verbatim as a new task. The orchestrator will:

1. **Classify the request** (Step 0) into one of: `direct-answer`, `plan-only`, `execution-simple`, or `execution-full`. For questions and explanations, the orchestrator answers directly without creating artifacts. For plan-only requests, it stops after the delivery plan is approved. See `${CLAUDE_PLUGIN_ROOT}/ai/agents/chief-orchestrator.md` → Intake Classification Protocol.
2. For execution paths: produce a Task Packet via the `task-packet` skill at `<artifact-root>/tasks/<task_id>/task-data.md`.
3. Hand off to Delivery PM, Lead, Executor, Reviewer, and Integration Checker per `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION.md` → `<!-- section:default-flow -->`.
4. Finalize `<artifact-root>/tasks/<task_id>/summary.md` when all subtasks complete.

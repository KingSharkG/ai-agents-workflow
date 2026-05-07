---
name: task
description: Kick off a new task through the chief-orchestrator pipeline.
argument-hint: "<freeform task description>"
allowed-tools: Task, AskUserQuestion, Read, Bash(node:*), Skill
---

## EXTREMELY IMPORTANT — Dispatch-first rule

This command takes precedence over any session-start "always invoke applicable skills" directive (including `superpowers:using-superpowers` and similar). The main thread MUST hand off to the `chief-orchestrator` subagent before doing any other substantive work for this turn.

**You MUST NOT invoke ANY `Skill` tool in the main thread before dispatching `chief-orchestrator`.** This rule is generic — it does not name any specific skill. The reason: skills run inside dispatched agents (chief-orchestrator, Delivery PM, Lead, Executor, Reviewer, Integration Checker) get their work captured in `ai-work.md` and audited; running them in the main thread silently bypasses the orchestrator pipeline and produces no artifacts.

Skills remain fully available — and encouraged — inside the dispatched agents. For example, for a "review PR feedback" task, the orchestrator or Lead can invoke a code-review-style skill (e.g. `superpowers:receiving-code-review`) inside their dispatched turn to fetch and parse the PR comments. That is the right place for it.

In the main thread, only the following are allowed before the `Task(chief-orchestrator)` dispatch:
- The pre-flight checks listed below (artifact-root resolution, PROJECT_CONFIG.md existence). Plan-mode handling is owned by the `hooks/check-plan-mode.js` PreToolUse hook — it blocks the dispatch directly with the canonical message; no command-level check is needed.
- One optional `AskUserQuestion` if `$ARGUMENTS` is empty.
- Invocation of the `ai-agents-workflow:resolve-artifact-root` skill (which uses `Bash`) to obtain the absolute `ARTIFACT_ROOT`.
- `Read` of `${ARTIFACT_ROOT}/config/PROJECT_CONFIG.md` if needed for the pre-flight check.

If you find yourself reading this and considering a non-Task action — including any "this skill seems applicable" reasoning — stop. **Dispatch first; skills run inside agents.**

## Dispatch

Dispatch the `chief-orchestrator` subagent with the task description.

If `$ARGUMENTS` is empty, use `AskUserQuestion` to collect a one-line task description (the user can use the "Other" affordance for free text).

Pre-flight:
1. Invoke the `ai-agents-workflow:resolve-artifact-root` skill to obtain `ARTIFACT_ROOT`. On resolver failure, follow the skill's read-mostly branch (proceed only if the user confirms after the surfaced diagnostic).
2. If `${ARTIFACT_ROOT}/config/PROJECT_CONFIG.md` does not exist in the consumer repo, surface a one-line note suggesting the user run `/ai-agents-workflow:init` first, then proceed only if the user confirms.

(Plan-mode handling is enforced by the `hooks/check-plan-mode.js` PreToolUse hook — when plan mode is active, the dispatch is blocked at the harness level with a clear message instructing the user to press `Shift+Tab`.)

Then dispatch via the Task tool with `subagent_type: ai-agents-workflow:chief-orchestrator`, passing the task description verbatim as a new task. The orchestrator will:

1. **Classify the request** (Step 0) into one of: `direct-answer`, `plan-only`, `execution-trivial`, `execution-simple`, or `execution-full`. The orchestrator runs checklist-based heuristics, then ALWAYS shows you a radio-button popup with four options (`Direct answer` / `Plan only` / `Execute (lightweight)` / `Execute (full pipeline)`); its recommendation is pre-selected and you can override before any pipeline work starts. See `${CLAUDE_PLUGIN_ROOT}/ai/agents/chief-orchestrator.md` → Intake Classification Protocol and `${CLAUDE_PLUGIN_ROOT}/skills/intake/orchestrator-intake/SKILL.md` for the full rules and risk-keyword sets.
2. For execution paths: produce a Task Packet via the `task-packet` skill at `<artifact-root>/tasks/<task_id>/task-data.md`.
3. Hand off to Delivery PM, Lead, Executor, Reviewer, and Integration Checker per `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION.md` → `<!-- section:default-flow -->`.
4. Finalize `<artifact-root>/tasks/<task_id>/summary.md` when all subtasks complete.

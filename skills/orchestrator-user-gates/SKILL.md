---
name: orchestrator-user-gates
description: User interaction gates P1 (delivery-plan approval), P2 (phase boundary checkpoint), P4 (task completion review), and P5 (post-task retrospective). Use when reaching each checkpoint to pause for user input via AskUserQuestion.
---

# Orchestrator User Gates — P1 / P2 / P4 / P5

The orchestrator MUST pause for user input at these checkpoints. Use `AskUserQuestion` with the specified options.

## P1 — Delivery Plan Approval

**When:** After Delivery PM appends `<!-- section:delivery-plan -->` to `task-data.md`, before dispatching any subtask agent.

**Action:** Present a summary of the delivery plan (subtask count, phases, ordering, complexity sizing, integration gates) and ask via `AskUserQuestion`.

**Options depend on classification:**

- For `plan-only`:
  - `Approve plan and stop` — sets `phase: planned` in `orchestration-state.json` and exits; resumable via `/continue`
  - `Approve plan and execute` — overrides classification to `execution-simple` or `execution-full` (ask which if ambiguous), continues to Step 5
  - `Revise plan` — collect free-form notes, route revisions back to Delivery PM, re-present
  - `Abort task` — mark task as aborted

- For `execution-simple` / `execution-full`:
  - `Approve plan` — proceed to execution
  - `Revise plan` — collect notes, route revisions back to Delivery PM, re-present. Loop until approved
  - `Abort task` — mark task as aborted

**Hard constraint:** No subtask agent may be dispatched before P1 approval.

## P2 — Phase Boundary Checkpoint

**When:** All subtasks of phase N are closed in `orchestration-state.json` AND phase N+1 has pending subtasks.

**Action:** Present a phase summary (subtask outcomes, rework count, open issues) and ask via `AskUserQuestion` menu:

1. `Continue to Phase <N+1>` — proceed normally
2. `Run contract verification before continuing` — dispatch Integration Checker in "contract-only" mode against the foundation established in phase N, then re-present the checkpoint with IC results
3. `Adjust scope (add/remove/reorder subtasks)` — collect changes via follow-up `AskUserQuestion`, update delivery plan, re-present
4. `Pause and review artifacts` — halt orchestration; user reviews manually and resumes via `/ai-agents-workflow:continue`
5. `Abort task` — mark task as aborted

**Skip condition:** If the delivery plan has only one phase (no explicit phase boundaries), skip P2.

## P4 — Task Completion Review

**When:** All subtasks are closed, `blocked_gates` and `pending_user_actions` are empty, and the orchestrator is about to set `workflow_state: complete`.

**Artifact-chain validation.** Before presenting the summary, confirm each subtask's artifact chain is complete. Read `orchestration-history.json` once and for each `completed_subtasks[]` entry inspect its `sections[]` list. Compute the expected section set from the subtask's path:

- Standard subtask → `["spec", "tep", "implementation", "review"]`
- Ultra-light subtask (direct-executor, no TEP) → `["spec", "implementation", "review"]`
- Add `"plan-addendum"` when the trigger decision recorded `design_agent: required`.
- Add `"integration-check"` when the trigger decision recorded `integration_checker: required`.

If every `completed_subtasks[]` entry satisfies its expected set, the artifact chain is validated — proceed to the approval question without re-reading subtask files. This map-based validation replaces the prior pattern of re-opening every subtask's `ai-work.md` at P4 (which cost ~200–400 KB of reads on large tasks).

**Fallback.** If the map is incomplete — missing `sections` arrays (legacy pre-F5 history), missing entries for listed subtasks, or a subtask's actual `ai-work.md` contradicts the map — fall back to per-subtask grep: `grep -oE '<!-- section:[a-z0-9-]+ -->' <ai-work.md>` for each subtask. Record the fallback as a `cache_miss: artifact-chain-<subtask_id>` telemetry line in the task-level `summary.md` so retrospective captures repeated misses.

**Action:** Present the full task summary (subtask outcomes table, open items, blockers carried forward, deferred items) and ask via `AskUserQuestion`:

- `Approve completion` — set `workflow_state: complete`
- `Reopen subtask <id>` — collect the subtask ID and reason, create a reversal packet (via `reversal-packet` skill), re-enter the execution loop
- `Add follow-up task` — collect a brief description; note it in the task summary's `## Notes` section for future intake

## P5 — Post-Task Retrospective

**When:** After `workflow_state: complete` is set and the task summary is finalized.

- **Always run** for tasks with ≥3 subtasks or any subtask that hit a rework cycle.
- **Skip** for tasks with ≤2 subtasks where all subtasks were approved on the first review cycle (no rework).

**Action:** Invoke the `post-task-review` skill to generate a `## Retrospective` section (rework heat-map, artifact completeness audit, dispatch bundle coverage, telemetry gaps). Then ask via `AskUserQuestion`:

- `Any feedback on this task execution?` — collect free-form notes; save actionable items as a new entry in the task summary's `## Notes`
- `No feedback` — close the session

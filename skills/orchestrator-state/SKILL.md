---
name: orchestrator-state
description: Orchestrator state file schema, phase transitions, post-approval closure, and state management across subtask dispatches. Use on first state write, on every subtask transition, and at post-approval closure.
---

# Orchestrator State — Schema, Transitions, Closure

The orchestrator persists its state to `ai-workflow-data/tasks/<task_id>/orchestration-state.json` between subtask dispatches. This prevents unbounded context accumulation across sequential agent dispatches within the orchestrator's maxTurns window.

## State Management Rhythm

**After completing each subtask:**

1. Update `orchestration-state.json` with the completed subtask result (subtask_id, verdict, cycles, summary_path).
2. Extend task-level `summary.md` with subtask telemetry (via `telemetry-summary` skill).
3. Summarize dispatch bundle data (role, token ceiling used, sections included) into `<subtask_id>/summary.md`.

**Before starting the next subtask:**

1. Read `orchestration-state.json` for current task state (completed subtasks, pending subtasks, trigger decisions).
2. Read the next subtask's spec using targeted reading: use the `subtask_offsets` entry in `orchestration-state.json` to call `Read(task-data.md, offset=start_line, limit=end_line-start_line)`. Do NOT read the full `task-data.md` — it grows with every subtask and can exceed 40 KB.
3. Do NOT rely on in-context memory of prior subtasks' agent results, validation reads, or intermediate reasoning.

## State File Schema

```json
{
  "task_id": "<task_id>",
  "classification": "direct-answer | plan-only | execution-simple | execution-full",
  "mode": "normal | degraded-inline",
  "phase": "planning | planned | execution | blocked | answered | complete",
  "completed_subtasks": [
    { "subtask_id": "...", "verdict": "approved", "cycles": 1, "summary_path": "..." }
  ],
  "current_subtask": "<subtask_id> | null",
  "pending_subtasks": ["..."],
  "blocked_gates": ["integration-check:TP-042-E2"],
  "pending_user_actions": ["run yarn install in projects/frontend/mobile"],
  "trigger_decisions": {
    "<subtask_id>": { "design_agent": "skipped|required", "lead": "required|direct-executor", "integration_checker": "skipped|required|conditional" }
  },
  "subtask_offsets": {
    "<subtask_id>": { "start_line": 157, "end_line": 195 }
  },
  "task_summary_path": "ai-workflow-data/tasks/<task_id>/summary.md"
}
```

## Field Semantics

- **`subtask_offsets`** maps each subtask ID to the line range of its `<!-- section:delivery-subtask-<id> -->` block in `task-data.md`. Populated by the orchestrator immediately after the Delivery PM completes (before presenting the P1 gate). Enables targeted `Read(file, offset, limit)` calls instead of loading the full file on every turn.
- **`completed_subtasks[].verdict`** captures the review outcome for that subtask. Does NOT by itself imply the task is complete.
- **`blocked_gates`** tracks mandatory workflow gates that are still open (`integration-check`, missing reviewer summary, etc.).
- **`pending_user_actions`** tracks required external actions (dependency install, device QA run, credentials, approvals).
- **`phase: complete`** is valid only when `pending_subtasks`, `blocked_gates`, and `pending_user_actions` are all empty.
- **`current_subtask`** is set to the active subtask ID when the **first** agent for that subtask is dispatched (Design Agent, Lead, or Executor — whichever runs first). It persists through the entire subtask agent chain (Design Agent → Lead → Executor → Reviewer, including rework cycles) and is cleared to `null` only after the subtask reaches `approved` or `needs-replan` verdict. This field is the primary signal for `RESUME_SUBTASK` detection by the resume-orchestrator.
  - **Example lifecycle**: `null` → set to `"TP-042-E2"` when Lead is dispatched → remains `"TP-042-E2"` through Executor dispatch → remains through Reviewer cycle 1 → remains through Executor rework → remains through Reviewer cycle 2 (approved) → cleared to `null`.
- **`classification`** records the intake classification determined at Step 0. Set once during classification, immutable unless the user explicitly overrides it at a P1 gate (e.g., `plan-only` → "Approve plan and execute" promotes to `execution-simple` or `execution-full`).
- **`phase: planned`** is the terminal state for `plan-only` tasks that completed P1 approval without proceeding to execution. Tasks in this phase are resumable via `/continue` (resume code `EXECUTE_PLAN`).
- **`phase: answered`** is the terminal state for `direct-answer` tasks. Not resumable — no artifacts exist. Note: for `direct-answer`, the orchestrator does NOT create `orchestration-state.json` at all (zero-artifact path). This phase value exists only for documentation completeness; it will never appear in a persisted state file.

## Phase Transition Table

Only the following transitions are valid. Any transition not listed here is a protocol violation.

| From | To | Trigger |
|------|----|---------|
| `planning` | `planned` | P1 gate: user selects "Approve plan and stop" (plan-only tasks) |
| `planning` | `execution` | P1 gate: user approves plan for execution |
| `planned` | `execution` | `/continue` with `EXECUTE_PLAN`: user chooses to execute a previously planned task |
| `execution` | `execution` | Subtask completes, next subtask begins (no phase change needed) |
| `execution` | `blocked` | `blocked_gates` or `pending_user_actions` becomes non-empty |
| `execution` | `complete` | All subtasks approved, all gates closed, P4 approved |
| `blocked` | `execution` | All blocking conditions resolved (gates closed, user actions confirmed) |
| `blocked` | `complete` | Blocking condition was the last gate; resolution completes the task |

**Invalid transitions** (never allowed):

- `execution` → `planning` (cannot un-plan; use `needs-replan` verdict on the subtask instead)
- `execution` → `planned` (cannot revert to pre-execution state)
- `complete` → any (terminal state; follow-up work is a new task)
- `planned` → `planning` (plan was approved; to revise, use `/continue` then re-dispatch Delivery PM via `REPLAN`)

**Note:** `answered` is a conceptual phase for `direct-answer` tasks. It never appears in a persisted `orchestration-state.json` because `direct-answer` tasks create zero artifacts.

## Post-Approval Closure

When the Reviewer returns a closed review outcome (signalled by `<subtask_id>/summary.md` containing final `## Status` fields):

1. Read `<subtask_id>/summary.md` — pull `workflow_state`, `review_verdict`, `files changed`, `open gates`, and `notes` from it.
2. Extend `ai-workflow-data/tasks/<task_id>/summary.md` with the subtask row using the `telemetry-summary` skill.
3. Emit the task/subtask completion signal.
4. For **task-level completion** (all subtasks done and no pending gates / user actions remain):
   a. Read EVERY `<subtask_id>/summary.md` file and cross-reference against `orchestration-state.json` notes to populate the task-level summary. Do NOT reconstruct subtask descriptions from conversation context — always source from the written artifacts.
   b. Finalize `ai-workflow-data/tasks/<task_id>/summary.md` with aggregate totals and `Changes by Phase`.
   c. Execute the **P4 — Task Completion Review** gate (see `orchestrator-user-gates` skill) before setting `workflow_state: complete`.
   d. After P4 approval, optionally execute **P5 — Post-Task Retrospective** (see `orchestrator-user-gates` skill).
5. Do NOT spawn a separate Summary Agent. This step replaces it.

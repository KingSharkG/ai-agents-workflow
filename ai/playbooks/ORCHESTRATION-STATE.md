# ORCHESTRATION — Orchestrator State Management

<!-- section:orchestrator-state -->

## Orchestrator State Management

The orchestrator persists its state to `ai-workflow-data/tasks/<task_id>/orchestration-state.json` between subtask dispatches. This prevents unbounded context accumulation across sequential agent dispatches within the orchestrator's maxTurns window.

**After completing each subtask:**
1. Update `orchestration-state.json` with the completed subtask result.
2. Extend task-level `summary.md` with subtask telemetry.
3. Summarize dispatch bundle data into `<subtask_id>/summary.md`.

**Before starting the next subtask:**
1. Read `orchestration-state.json` for current task state.
2. Read the next subtask's spec using targeted reading: use the `subtask_offsets` entry in `orchestration-state.json` to call `Read(task-data.md, offset=start_line, limit=end_line-start_line)`. Do NOT read the full `task-data.md` — it grows with every subtask and can exceed 40 KB.
3. Do NOT rely on in-context memory of prior subtasks' results or reasoning.

**State file schema:**
```json
{
  "task_id": "<task_id>",
  "mode": "normal | degraded-inline",
  "phase": "planning | execution | blocked | complete",
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

**`subtask_offsets`** maps each subtask ID to the line range of its `<!-- section:delivery-subtask-<id> -->` block in `task-data.md`. Populated by the Delivery PM after writing the plan (or by the orchestrator after the Delivery PM completes). This enables targeted `Read(file, offset, limit)` calls instead of loading the full file on every turn.

**State semantics:**

- `completed_subtasks[].verdict` captures the review outcome for that subtask. It does NOT by itself imply the task is complete.
- `blocked_gates` tracks mandatory workflow gates that are still open (`integration-check`, missing reviewer summary, etc.).
- `pending_user_actions` tracks required external actions (dependency install, device QA run, credentials, approvals).
- `phase: complete` is valid only when `pending_subtasks`, `blocked_gates`, and `pending_user_actions` are all empty.
- `current_subtask` is set to the active subtask ID when an agent is dispatched and cleared to `null` only after the subtask reaches `approved` or `needs-replan` verdict. This field is the primary signal for `RESUME_SUBTASK` detection by the resume-orchestrator.

<!-- /section:orchestrator-state -->

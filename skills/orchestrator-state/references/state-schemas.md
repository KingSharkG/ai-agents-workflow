# State File Schemas

The orchestrator persists state across two files inside `ai-workflow-data/tasks/<task_id>/`. See SKILL.md → "State Management Rhythm" for when each is read/written.

## `orchestration-state.json` (hot state)

```json
{
  "task_id": "<task_id>",
  "classification": "direct-answer | plan-only | execution-simple | execution-full",
  "mode": "normal | degraded-inline",
  "phase": "planning | planned | execution | blocked | answered | complete",
  "current_subtask": "<subtask_id> | null",
  "pending_subtasks": ["..."],
  "blocked_gates": ["integration-check:TP-042-E2"],
  "pending_user_actions": ["run yarn install in projects/frontend/mobile"],
  "subtask_offsets": {
    "<subtask_id>": { "start_line": 157, "end_line": 195 }
  },
  "task_summary_path": "ai-workflow-data/tasks/<task_id>/summary.md"
}
```

## `orchestration-history.json` (history; written once per subtask completion)

```json
{
  "task_id": "<task_id>",
  "completed_subtasks": [
    {
      "subtask_id": "...",
      "verdict": "approved",
      "cycles": 1,
      "summary_path": "...",
      "sections": ["spec", "tep", "implementation", "review"]
    }
  ],
  "trigger_decisions": {
    "<subtask_id>": { "design_agent": "skipped|required", "lead": "required|direct-executor", "integration_checker": "skipped|required|conditional" }
  }
}
```

**`completed_subtasks[].sections`** — the list of `<!-- section:... -->` tag slugs (without the `section:` prefix) that the Artifact Gate verified non-empty in this subtask's `ai-work.md` at the moment of closure. Populated during Post-Approval Closure by greping the subtask's `ai-work.md` once, so P4 can validate the task-level artifact chain from the map instead of re-opening every subtask file. Valid values per stage are defined by `orchestrator-dispatch` skill → "Artifact Gate" stage-based section requirements. An ultra-light subtask records `["spec", "implementation", "review"]` (no TEP); a standard subtask records `["spec", "tep", "implementation", "review"]`; a cross-domain subtask with integration check adds `"integration-check"`. Escalation sections (`escalation-1`, `escalation-2`, ...) are appended when present.

`task_id` is duplicated across both files as a consistency key — when reading both at a gate, verify the two `task_id` values match; a mismatch signals corruption and should trigger a blocker escalation rather than silent proceed.

## Migration

On first read after upgrade, if `orchestration-history.json` is absent but `orchestration-state.json` contains `completed_subtasks` or `trigger_decisions`, split the state:

1. Read the current `orchestration-state.json`.
2. Extract `completed_subtasks` and `trigger_decisions` into a new `orchestration-history.json`; set `task_id` from the hot file.
3. Rewrite `orchestration-state.json` without those fields.
4. Both writes go through temp-file + rename for atomicity. The history file is written first, so a crash mid-migration leaves the hot file intact with the legacy fields (readers that see legacy fields in the hot file must tolerate them for one more dispatch cycle).

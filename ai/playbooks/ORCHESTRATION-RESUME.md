# ORCHESTRATION — Resume Entry Point

<!-- section:resume-entry -->

## Resume Entry Point

When the Chief Orchestrator receives a prompt beginning with the keyword `resume`, it MUST enter the Resume Entry Point flow instead of the normal default flow.

**Prompt format from resume-orchestrator:**

```
resume task_id=<task_id>
state=<routing-critical JSON>
resume_point=<REPLAN|RESUME_SUBTASK|NEXT_SUBTASK|BLOCKED|DONE>
interrupted_subtask_stage=<stage_code | null>
```

**State reload:** After reading the inline state for routing decisions, re-read `orchestration-state.json` from disk before making any writes. Disk is authoritative for writes.

**Resume entry by code:**

| Code | Chief Orchestrator action |
|---|---|
| `REPLAN` | Skip task-packet (already exists). Read `task-data.md`. Re-dispatch Delivery PM. Continue from Step 3 of default flow. |
| `RESUME_SUBTASK` | Skip to `current_subtask`. Read `trigger_decisions[current_subtask]` from state — do NOT re-evaluate triggers for the resumed subtask. Use `interrupted_subtask_stage` to dispatch the next agent. Continue subtask review loop normally. Validate `ai-work.md` section completeness before trusting `current_subtask` as still-interrupted. |
| `NEXT_SUBTASK` | Skip completed subtasks. Read `pending_subtasks[0]` from state. Use `subtask_offsets` for targeted `task-data.md` read. Begin subtask from Step 5 of default flow. |
| `VERIFY_COMPLETE` | All subtasks dequeued (`current_subtask: null`, `pending_subtasks: []`) but `phase` not yet `complete`. Re-run the task-completion check from Step 11 of default flow: read each subtask summary, confirm all verdicts are `approved`, confirm `blocked_gates` and `pending_user_actions` are empty, then write `phase: complete` to `orchestration-state.json` and finalize the task-level `summary.md`. |
| `BLOCKED` | Read `blocked_gates` and `pending_user_actions` from state. Workflow gates (`blocked_gates`) are treated as user-waived (resume-orchestrator already obtained confirmation). For `pending_user_actions`: these are external real-world actions — do NOT proceed to the next subtask without re-confirming each action is physically complete. Surface the list and ask the user to confirm before dispatching. |
| `EXECUTE_PLAN` | Task was classified as `plan-only` and completed P1 approval (`phase: planned`). Skip task-packet (exists), skip Delivery PM (plan exists), skip P1 (already approved). Ask the user via `AskUserQuestion`: "Execute with simple workflow?" / "Execute with full workflow?". Override `classification` in `orchestration-state.json` to the user's choice (`execution-simple` or `execution-full`), set `phase: execution`, and continue from Step 5 of the default flow. |
| `DONE` | Read `task_summary_path` from state. Print summary and exit. Also used for `phase: answered` (direct-answer tasks) — these have no artifacts to display; print a note and exit. |

**Context hygiene:** Do not re-run `task-packet` skill, re-dispatch Delivery PM (except `REPLAN`), or re-write skeletons for completed subtasks. Read `completed_subtasks` from state to skip those.

**Normal flow resumes:** Once the resume entry point determines where to re-enter, proceed with all normal flow rules (dispatch bundles, artifact gates, review loops, state updates) from that point forward.

<!-- /section:resume-entry -->

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

**Stage awareness (schema_version 3+).** Each resume code below targets a specific lifecycle stage. The orchestrator MUST verify the on-disk `state.stage` matches the implied stage before acting; mismatch indicates state corruption and should trigger a `blocker-escalation-report`. When a resume code transitions to a new stage (e.g., `EXECUTE_PLAN` moves `planning → execution`), follow the stage-write rule: close the prior `stage_history` entry with the appropriate `exit_reason`, append a new entry, update `previous_stage`. See `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/SKILL.md` → "Stage Discipline".

**Resume entry by code:**

| Code | Implied current stage | Chief Orchestrator action |
|---|---|---|
| `REPLAN` | `planning` (post-reopen) or `execution` (immediately rewinding) | Skip task-packet (already exists). Read `task-data.md`. If state is in `execution`, perform the soft-reopen stage transition first (`execution → planning`, `previous_stage="execution"`, `stage_reopen_count++`, snapshot signature). Re-dispatch Delivery PM. Continue from Step 3 of default flow. After return, run the auto-diff procedure to populate `pending_subtasks_needing_rereview[]`; on stage re-entry to `execution`, decide P1 re-fire vs silent based on signature comparison. |
| `RESUME_SUBTASK` | `execution` | Skip to `current_subtask`. Read `trigger_decisions[current_subtask]` from `orchestration-history.json` — do NOT re-evaluate triggers for the resumed subtask. Use `interrupted_subtask_stage` (this is the *dispatch-stage code* — Lead/Executor/Reviewer/etc., NOT the lifecycle `stage`) to dispatch the next agent. Continue subtask review loop normally. Validate `ai-work.md` section completeness before trusting `current_subtask` as still-interrupted. |
| `NEXT_SUBTASK` | `execution` | Skip completed subtasks. Read `pending_subtasks[0]` from state. Use `subtask_offsets` for targeted `task-data.md` read. Consult `pending_subtasks_needing_rereview[]` first — if non-empty, re-review listed subtasks before fresh subtasks. Begin subtask from Step 6 of default flow. |
| `VERIFY_COMPLETE` | `execution` (transitioning to `closure`) | All subtasks dequeued (`current_subtask: null`, `pending_subtasks: []`) but `phase` not yet `complete`. Transition stage `execution → closure` (`exit_reason: "all-subtasks-approved"`). Re-run the task-completion check from Step 15 of default flow: read each subtask summary, confirm all verdicts are `approved`, confirm `blocked_gates` and `pending_user_actions` are empty, then write `phase: complete` to `orchestration-state.json` and finalize the task-level `summary.md`. |
| `BLOCKED` | `execution` (sub-state `phase: blocked`) | Read `blocked_gates` and `pending_user_actions` from state. Workflow gates (`blocked_gates`) are treated as user-waived (resume-orchestrator already obtained confirmation). For `pending_user_actions` (external real-world actions), surface the list via `AskUserQuestion` and re-confirm each is physically complete; on full confirm, clear/transition per `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/SKILL.md` → "Phase transitions" (`pending_user_actions: []`, `phase: blocked → execution`) before dispatching. On any "not yet done" answer, leave state untouched. Stage stays `execution` throughout. |
| `EXECUTE_PLAN` | `planning` (`phase: planned`) transitioning to `execution` | Task was classified as `plan-only` and completed P1 approval. Skip task-packet (exists), skip Delivery PM (plan exists), skip P1 (already approved). Ask the user via `AskUserQuestion`: "Execute with simple workflow?" / "Execute with full workflow?". Override `classification` in `orchestration-state.json` to the user's choice, transition stage `planning → execution` (`exit_reason: "p1-approved-execute"`), set `phase: execution`, and continue from Step 6 of the default flow. |
| `REVERSAL` | `closure` (transitioning to `execution`) | Triggered by `reversal-packet` against a closed task. Transition stage `closure → execution` (`exit_reason: "reversal"`, `previous_stage="closure"`, `stage_reopen_count++`). Set `phase: execution`. Resume execution from the targeted subtask — no Delivery PM re-dispatch and no P1 re-fire (the reversal-packet itself carries the plan delta). |
| `DONE` | `closure` (terminal) | Read `task_summary_path` from state. Print summary and exit. Note: `direct-answer` tasks never persist a state file (`phase: answered` is conceptual only — see `orchestrator-state` SKILL → `phase: answered`), so the resume scan never lists them; this code is reached only via `phase: complete`. |

**Context hygiene:** Do not re-run `task-packet` skill, re-dispatch Delivery PM (except `REPLAN`), or re-write skeletons for completed subtasks. Read `completed_subtasks` from `orchestration-history.json` (post-F2-split location) to skip those; fall back to an empty list if the history file is absent.

**Normal flow resumes:** Once the resume entry point determines where to re-enter, proceed with all normal flow rules (dispatch bundles, artifact gates, review loops, state updates) from that point forward.

<!-- /section:resume-entry -->

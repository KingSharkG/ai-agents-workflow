# Stage Discipline + Phase Transition Table

Loaded by `orchestrator-state/SKILL.md`. Read on first stage transition or on first reopen evaluation per session. The procedures here are stable across tasks.

## Stage Discipline

The lifecycle stage is the coarse-grained "what part of the task are we in" signal. Stages are: `intake | planning | execution | closure`. They are orthogonal to `phase` — `stage` says *which lifecycle phase the task is in*, while `phase` says *what the execution cursor is doing*.

### Hard rule — every state mutation MUST set `stage` and append `stage_history` on transition

Whenever the orchestrator writes `orchestration-state.json`, it MUST:

1. **Always carry `stage`** — never write a state file without the `stage` field set to one of the four allowed values. (Schema_version 3 requires it; v3 readers assume it is present.)
2. **On a stage transition** (i.e., the new state's `stage` differs from the previous state's `stage`):
   - Close the prior `stage_history` entry by setting `exited_at` to the current ISO-8601 UTC timestamp and `exit_reason` to one of the values in the enum (`./state-schemas.md` → `stage_history[]`).
   - Append a new `stage_history` entry with the new `stage`, `entered_at` set to the same timestamp, and `exited_at` / `exit_reason` both `null`.
   - Set `previous_stage` to the prior `stage`.
3. **On a non-transition write** (same `stage` as before): do not touch `stage_history` or `previous_stage`. The current entry stays open.

Failing rule (1) means the runtime hook will silently no-op on the state file and downstream reads will hit `undefined` field errors. Failing rule (2) means the audit trail is incoherent and `resume-orchestrator` cannot reconstruct the lifecycle.

### Stage entry/exit triggers

The canonical map of stage transitions, their triggers, and the corresponding `exit_reason` values lives in the `Phase Transition Table` below.

### Reopen accounting

When a transition is a reopen, the orchestrator MUST also:

- Increment `stage_reopen_count` by 1 in the same write that sets the new stage.
- Snapshot the current normalized delivery-plan signature into `gates.p1_signature_at_stage_entry` on **every** entry to `planning` — initial intake → planning AND any execution → planning reopen — so a subsequent re-entry to execution can always decide whether P1 re-fires by comparing the new plan's signature against this baseline. (The earlier convention only snapshotted on reopens, which made the first execution-entry decision ambiguous; snapshotting on initial entry too keeps the comparison rule symmetric across the task's lifetime.)
- Run the auto-diff procedure (below) before resuming subtask work.

**Soft cap:** the cap check fires *before* incrementing — when `stage_reopen_count >= 3` and another reopen is about to happen (would-be 4th), the orchestrator emits a `blocker-escalation-report` AND surfaces a "Continue anyway / Abort task" P-gate via `AskUserQuestion`. The prompt MUST use the literal template below verbatim, substituting only the live `stage_reopen_count` value for `<N>`. Keeping the wording stable lets users recognize the cap on sight across tasks:

```text
question: "This task has already been reopened <N> times (soft cap = 3). Repeated reopens usually mean the plan needs a fundamental rethink rather than another revision cycle. How do you want to proceed?"
header:   "Reopen cap"
options:
  - label:       "Continue anyway"
    description: "Proceed with the reopen. Records exit_reason: overridden-continue for the prior stage. The counter still increments and this prompt re-fires on the next reopen."
  - label:       "Abort task"
    description: "Stop here. Task ends with the current state preserved."
```

User-overridden continuation increments the counter as normal and records `exit_reason: "overridden-continue"` for the prior stage.

### Auto-diff for affected subtasks

After a `delivery-pm` re-dispatch on a `needs-replan` or `p2-replan` reopen, the orchestrator runs the following procedure to populate `pending_subtasks_needing_rereview[]`:

1. Read the previous delivery-plan section bytes (the bytes that produced `gates.p1_signature_at_stage_entry`) and parse out the per-subtask blocks.
2. Read the new delivery-plan section bytes from `task-data.md`.
3. For each subtask present in either version, compute a per-subtask normalized signature over `description + dependencies[] + acceptance_signals[] + upstream_contracts[]`.
4. **Affected** = `(new ∖ old) ∪ (old ∖ new) ∪ { s : sig_old(s) ≠ sig_new(s) }` — i.e., new subtasks, removed subtasks, and subtasks whose normalized definition changed.
5. Subtasks that the PM **explicitly** tags with `re_review: true` in the revised section are also added (semantic ripple the diff cannot detect — e.g., a downstream subtask that depends on an upstream subtask whose contract changed but whose own text did not).
6. Write the union to `pending_subtasks_needing_rereview[]`. Already-approved subtasks not in this list keep their `verdict: approved` from `orchestration-history.json`.
7. For subtasks present in `old` but absent from `new` (removed/replaced by the revised plan), mark their `orchestration-history.json` `completed_subtasks[]` entry with `superseded: true` (additive field; `orchestration-history` schema is permissive — extra fields are ignored by readers that don't know about them).

The auto-diff procedure produces only the *list*. The actual re-review is driven by the normal subtask cycle — when the orchestrator picks the next subtask to dispatch, it consults `pending_subtasks_needing_rereview[]` first, dispatches Lead/Executor/Reviewer for each entry in the list, and then continues with the rest of `pending_subtasks` from the revised plan.

## Phase Transition Table

Only the following transitions are valid. Any transition not listed here is a protocol violation.

| From | To | Trigger |
|------|----|---------|
| `planning` | `planned` | P1 gate: user selects "Approve plan and stop" (plan-only tasks). Sets `gates.p1_approved: true`. |
| `planning` | `execution` | P1 gate: user approves plan for execution. Sets `gates.p1_approved: true` and records `p1_approved_at` + `p1_approved_signature`. |
| `planned` | `execution` | `/continue` with `EXECUTE_PLAN`: user chooses to execute a previously planned task |
| `execution` | `execution` | Subtask completes, next subtask begins (no phase change needed) |
| `execution` | `blocked` | `blocked_gates` or `pending_user_actions` becomes non-empty |
| `execution` | `complete` | All subtasks approved, all gates closed, P4 approved |
| `execution` | `planning` | **Soft reopen** (schema_version 3+). Reviewer `needs-replan` verdict on a subtask, OR P2 phase-boundary user-elected replan. The orchestrator MUST set `previous_stage="execution"`, increment `stage_reopen_count`, snapshot the current normalized delivery-plan signature into `gates.p1_signature_at_stage_entry`, and re-dispatch `delivery-pm`. Subject to the soft cap (≥ 3 reopens trigger a `blocker-escalation-report` plus a "Continue / Abort" override gate). See "Reopen accounting" above. |
| `blocked` | `execution` | All blocking conditions resolved (gates closed, user actions confirmed) |
| `blocked` | `complete` | Blocking condition was the last gate; resolution completes the task |
| `closure` | `execution` | **Reversal** (schema_version 3+). Triggered by `reversal-packet` to reopen approved work after task closure. The orchestrator MUST set `previous_stage="closure"`, increment `stage_reopen_count`, and resume execution from the targeted subtask (no `delivery-pm` re-dispatch — `reversal-packet` itself carries the plan delta). Subject to the same soft cap. Note: `closure` is the *stage* value; the corresponding *phase* is `complete`, but stage and phase are orthogonal — this row triggers off the stage transition, not the phase value. |

**Invalid transitions** (never allowed):

- `execution` → `planned` (cannot revert to pre-execution state — `planned` is the plan-only terminal phase)
- `closure` → `planning` (use the reversal transition above to reopen execution; planning is not re-entered for reversals)
- `planned` → `planning` (plan was approved; to revise, use `/continue` then re-dispatch Delivery PM via `REPLAN`)

**Note:** `answered` is a conceptual phase for `direct-answer` tasks. It never appears in a persisted `orchestration-state.json` because `direct-answer` tasks create zero artifacts.

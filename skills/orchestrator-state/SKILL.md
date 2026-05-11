---
name: orchestrator-state
description: Owns the orchestrator state files (`orchestration-state.json` hot + `orchestration-history.json` history) — schemas, field semantics, phase/stage transitions, history-consistency contract, and post-approval closure. Use before every subtask transition, on first state write, and at post-approval closure. Read by orchestrator-dispatch (pre-dispatch hot-state read) and orchestrator-user-gates (P4 history validation).
stage: shared
---

# Orchestrator State — Schema, Transitions, Closure

The orchestrator persists its state across two files inside `<artifact-root>/tasks/<task_id>/`:

- **`orchestration-state.json`** — hot state for the current execution cursor. Small (size bounded by `pending_subtasks` length, not by task history). Read at every subtask transition and written whenever `phase`, `current_subtask`, `pending_subtasks`, `blocked_gates`, or `pending_user_actions` changes.
- **`orchestration-history.json`** — grows with task history: `completed_subtasks[]` and `trigger_decisions{}`. Written once per subtask completion; read only at P2 / P4 gates, post-task retrospective, and resume. Not read during routine dispatch between subtasks.

Splitting the two prevents the history growth (O(N) in subtasks) from inflating the per-dispatch read/write cost.

## State Management Rhythm

**After completing each subtask (transactional sequence):**

1. **History file append** — append the completed subtask entry (with non-empty `sections[]`) to `completed_subtasks[]` and update `trigger_decisions[<subtask_id>]` in `orchestration-history.json`. Write atomically (temp-file + `fsync` + `rename`).
2. **Hot file update** — clear `current_subtask` to `null`, remove the completed subtask from `pending_subtasks`, increment `last_completed_seq` by 1, and update `phase` / `blocked_gates` / `pending_user_actions` as applicable. Write `orchestration-state.json` atomically.
3. Extend task-level `summary.md` with subtask telemetry (via `telemetry-summary` skill).
4. Summarize dispatch bundle data (role, token ceiling used, sections included) into `<subtask_id>/summary.md`.

**Order is load-bearing**: history is written *before* the hot-state increment of `last_completed_seq`. If the orchestrator crashes between step 1 and step 2, the next P4 consistency check will detect `history.length > state.last_completed_seq` and prompt for repair (see "History consistency contract" below). The reverse order would silently lose completion data — never write hot state first.

**Before starting the next subtask:**

1. Read `orchestration-state.json` only. It contains `pending_subtasks`, `current_subtask` (should be `null`), `phase`, `mode`, `blocked_gates`, `pending_user_actions`, and `subtask_offsets` — everything routine dispatch needs. Do NOT read `orchestration-history.json` unless you need prior completion data (rework audit, cycle-3 escalation lookup).
2. Read the next subtask's spec using targeted reading: use the `subtask_offsets` entry in `orchestration-state.json` to call `Read(task-data.md, offset=start_line, limit=end_line-start_line)`. Do NOT read the full `task-data.md` — it grows with every subtask and can exceed 40 KB.
3. Do NOT rely on in-context memory of prior subtasks' agent results, validation reads, or intermediate reasoning.

**When history IS needed:**

- **P2 phase-boundary gate** — read `orchestration-history.json` to enumerate completed subtasks in the current phase for the gate summary.
- **P4 task-completion gate** — read both files to produce the completion rollup.
- **Resume** — `resume-orchestrator` reads both to reconstruct context.
- **Rework audit** — when a reviewer cycle needs to reference a prior completion's verdict or trigger decision.

## State File Schemas

Both files use JSON. The exact schemas (hot state, history state, the `task_id` consistency-key rule, the `completed_subtasks[].sections` semantics, and the upgrade migration procedure) live at `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/references/state-schemas.md`. Read it when writing state for the first time in a session — the schemas are stable. Every field used by `## Field Semantics` below is defined there.

## Field Semantics

- **`subtask_offsets`** maps each subtask ID to the line range of its `<!-- section:delivery-subtask-<id> -->` block in `task-data.md`. Populated by the orchestrator immediately after the Delivery PM completes (before presenting the P1 gate). Enables targeted `Read(file, offset, limit)` calls instead of loading the full file on every turn.
- **`completed_subtasks[].verdict`** captures the review outcome for that subtask. Does NOT by itself imply the task is complete.
- **`blocked_gates`** tracks mandatory workflow gates that are still open (`integration-check`, missing reviewer summary, etc.).
- **`pending_user_actions`** tracks required external actions (dependency install, device QA run, credentials, approvals).
- **`phase: complete`** is valid only when `pending_subtasks`, `blocked_gates`, and `pending_user_actions` are all empty.
- **`current_subtask`** is set to the active subtask ID when the **first** agent for that subtask is dispatched (Design Agent, Lead, or Executor — whichever runs first). It persists through the entire subtask agent chain (Design Agent → Lead → Executor → Reviewer, including rework cycles) and is cleared to `null` only after the subtask reaches `approved` or `needs-replan` verdict. This field is the primary signal for `RESUME_SUBTASK` detection by the resume-orchestrator.
  - **Example lifecycle**: `null` → set to `"TP-042-E2"` when Lead is dispatched → remains `"TP-042-E2"` through Executor dispatch → remains through Reviewer cycle 1 → remains through Executor rework → remains through Reviewer cycle 2 (approved) → cleared to `null`.
- **`classification`** records the intake classification determined at Step 0. Set once during classification, immutable unless the user explicitly overrides it at a P1 gate (e.g., `plan-only` → "Approve plan and execute" promotes to `execution-simple` or `execution-full`).
- **`gates.p1_approved`** is the runtime-enforced "Delivery Plan approved" flag. Set to `true` only after the user picks `Approve plan` at the P1 gate; any `Revise plan` resets it to `false` along with `p1_approved_at` (cleared) and `p1_approved_signature` (cleared) before re-presenting the revised plan. The `hooks/pre-task-guard.js` blocking PreToolUse hook (Phase 3 — P1 gate) reads this field on every `Task` dispatch and refuses to allow `lead`, `executor`, `reviewer`, `design-agent`, or `integration-checker` invocations when it is not `true`. `delivery-pm`, `chief-orchestrator`, and `init` are explicitly allowed regardless. Tasks with `classification: "execution-trivial"` also bypass this gate (the orchestrator auto-records `p1_approved: true` with `signature: "trivial-path-auto"` when initializing state).
- **`gates.p1_approved_signature`** is a sha256 hex digest of the bytes the user actually saw and approved (the rendered Block 1 classification line + Block 2 subtasks table + Block 3 files-likely-to-change list, normalized). Recompute on every dispatch to detect "the plan changed since approval" — mismatch forces re-presenting the gate.
- **`gates.p1_revise_count`** is the cumulative count of `Revise plan` selections at P1 across the task's lifetime (resume-safe — incremented in state, not in memory). The `orchestrator-user-gates` skill enforces the 5-iteration revise cap from this field. Increment on every `Revise plan`; never reset on `Approve plan`. At `>= 5`, surface a continue-or-abort prompt before re-presenting.
- **`schema_version`** marks the state-file format version (currently `3`). v3 introduces the lifecycle stage fields (`stage`, `previous_stage`, `stage_history[]`, `stage_reopen_count`, `pending_subtasks_needing_rereview[]`, `gates.p1_signature_at_stage_entry`). There is **no migration path from v2 to v3** — see `references/state-schemas.md` → "Migration" → "v2 → v3" for the wipe-and-restart policy. The runtime hook (Phase 3.5 stage guard, landed in commit B) silently no-ops on state files lacking `stage`, so stale v2 files do not crash the hook but will misbehave under v3 orchestrator logic that assumes the new fields. Files lacking `schema_version` entirely are legacy v1 — see "v1 → v2" migration in the schemas reference.
- **`stage`** is the coarse-grained lifecycle tag of the task. One of `intake | planning | execution | closure`. It is set on initial state write and updated whenever the task transitions between lifecycle stages — see "Stage Discipline" below. `stage` and `phase` are independent but related: `phase` describes the execution cursor *inside* a stage; `stage` describes which stage the task is in.
- **`previous_stage`** records the immediately-prior stage. Used by the orchestrator to disambiguate reopens (e.g., distinguish a fresh execution from a re-entry after `needs-replan`). `null` on the very first stage entry.
- **`stage_history[]`** is an append-only list of stage-entry records, one per `stage` set. Each entry has `{ stage, entered_at, exited_at, exit_reason }`. Open entries (current stage, or terminal closure when P4 was skipped) have `exited_at: null, exit_reason: null`. Closed entries have both fields set. The `exit_reason` enum is documented in `references/state-schemas.md`.
- **`stage_reopen_count`** counts task lifecycle reopens (execution→planning rewinds and closure→execution reversals). Initialized to `0`; incremented after each successful reopen. The soft cap is `>= 3` — see "Stage Discipline" → "Reopen accounting".
- **`pending_subtasks_needing_rereview[]`** carries subtask IDs that must re-enter the review cycle after a reopen, populated by the auto-diff procedure below. Subtasks not in this list retain their prior `verdict: approved` status.
- **`gates.p1_signature_at_stage_entry`** is the sha256 hex digest of the normalized delivery-plan section bytes captured at the most recent execution-stage entry. After a `needs-replan` / `p2-replan` reopen, the orchestrator compares the freshly-revised plan's signature against this snapshot to decide whether the P1 gate must re-fire (mismatch) or the re-entry is silent (match).
- **`phase: planned`** is the terminal state for `plan-only` tasks that completed P1 approval without proceeding to execution. Tasks in this phase are resumable via `/continue` (resume code `EXECUTE_PLAN`).
- **`phase: answered`** is the terminal state for `direct-answer` tasks. Not resumable — no artifacts exist. Note: for `direct-answer`, the orchestrator does NOT create `orchestration-state.json` at all (zero-artifact path). This phase value exists only for documentation completeness; it will never appear in a persisted state file.
- **`last_completed_seq`** is a monotonically increasing integer that mirrors `orchestration-history.json` → `completed_subtasks.length`. Initialized to `0` when state is first written. Incremented by exactly 1 in step 2 of the post-subtask transactional sequence — *after* the history write succeeds. The P4 consistency check requires `state.last_completed_seq === history.completed_subtasks.length` and that every history entry has a non-empty `sections[]` array. A mismatch is NOT silently repaired — the orchestrator emits a `blocker-escalation-report` with `blocker_type: state-history-inconsistency` and prompts the user via `AskUserQuestion` to repair, reopen, or abort. See `orchestrator-user-gates` → P4 → "History consistency check". Legacy state without `last_completed_seq` (pre-F6) is allowed the silent fallback for one task lifecycle and emits a `legacy-history` telemetry line.

## History consistency contract

The contract between `orchestration-state.json` and `orchestration-history.json` has three invariants. P4 (and resume) MUST verify all three before honoring the history map:

1. **Length parity:** `state.last_completed_seq === history.completed_subtasks.length`.
2. **Sections completeness:** every entry in `history.completed_subtasks[]` has a non-empty `sections[]` array.
3. **Disjointness:** the set of `subtask_id`s in `history.completed_subtasks[]` is disjoint from `state.pending_subtasks[]` (a subtask cannot be both pending and completed).

A failure on any invariant is a real bug — the orchestrator either skipped a `subtask_complete` write, wrote partially, or duplicated. The `orchestrator-user-gates` P4 step does not silently fall back to per-subtask grep for tasks created under `schema_version >= 2`; it surfaces a recovery prompt. Legacy tasks (no `last_completed_seq` field at all) are the one exception — one-shot grep fallback is allowed and the migration debt is logged.

## Stage Discipline + Phase Transition Table

Stages: `intake | planning | execution | closure` — orthogonal to `phase` (stage = lifecycle position; phase = execution cursor inside that stage).

**Hard rule for every state write:** always carry `stage`; on transition close the prior `stage_history` entry (`exited_at`, `exit_reason`) and append a new entry with `entered_at`, `exited_at: null`. Set `previous_stage` only on transition.

The full procedure — reopen accounting (soft cap at `stage_reopen_count >= 3`), auto-diff for `pending_subtasks_needing_rereview[]` after a `needs-replan` / `p2-replan` reopen, and the complete Phase Transition Table with all valid edges and forbidden transitions — lives in `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/references/stage-discipline.md`. Read once per session before evaluating any reopen or stage transition.

## Post-Approval Closure

When the Reviewer returns a closed review outcome (signalled by `<subtask_id>/summary.md` containing final `## Status` fields):

1. Read `<subtask_id>/summary.md` — pull `workflow_state`, `review_verdict`, `files changed`, `open gates`, and `notes` from it.
2. **Update hot state** (`orchestration-state.json`): clear `current_subtask`, remove the subtask from `pending_subtasks`, refresh `blocked_gates` / `pending_user_actions`.
3. **Append to history** (`orchestration-history.json`): grep the subtask's `ai-work.md` for non-empty `<!-- section:<tag> -->` blocks once, collect the tag slugs into a `sections` array, and push the new `completed_subtasks[]` entry with `{subtask_id, verdict, cycles, summary_path, sections}`. Record `trigger_decisions[<subtask_id>]`. If the history file does not yet exist (first subtask completion), create it per the schema above.
4. Extend task-level `summary.md` with the subtask row using the `telemetry-summary` skill.
5. Emit the task/subtask completion signal.
6. For **task-level completion** (all subtasks done and no pending gates / user actions remain):
   a. Read `orchestration-history.json` plus EVERY `<subtask_id>/summary.md` file to populate the task-level summary. Do NOT reconstruct subtask descriptions from conversation context — always source from the written artifacts.
   b. Finalize `<artifact-root>/tasks/<task_id>/summary.md` with aggregate totals and `Changes by Phase`.
   c. Execute the **P4 — Task Completion Review** gate (see `orchestrator-user-gates` skill) before setting `workflow_state: complete`.
   d. After P4 approval, optionally execute **P5 — Post-Task Retrospective** (see `orchestrator-user-gates` skill).
7. Do NOT spawn a separate Summary Agent. This step replaces it.

## Related skills

- `orchestrator-dispatch` — Pre-Dispatch Checklist only checks the hot state file (`orchestration-state.json`). History is not required to be present before dispatch.
- `orchestrator-user-gates` — P4 task-completion gate reads `orchestration-history.json` → `completed_subtasks[].sections` to validate the artifact chain without re-reading every subtask's `ai-work.md`.
- `resume-orchestrator` — reads both hot state and history on resume; tolerates missing history (first-subtask or legacy pre-split tasks).
- `telemetry-summary` — consumes completions to refresh the task-level `summary.md` after each post-approval closure.

# ORCHESTRATION

The chief-orchestrator's lifecycle is organized into four explicit **stages**: `intake`, `planning`, `execution`, `closure`. Each stage owns a slice of the 15 procedural steps. The `stage` field in `orchestration-state.json` (schema_version 3) records which stage the task is in; the `pre-task-guard.js` Phase 3.5 hook blocks subagent dispatches that don't belong to the active stage.

This file groups the steps by stage. Step numbers are preserved as cross-reference anchors — older docs that say "Step 6" still resolve here.

<!-- section:default-flow -->

## Stage transition diagram

```
direct-answer:        intake ─(classified)─▶ (terminal — no state)
plan-only:            intake ─(classified)─▶ planning ─(p1-approved-stop)─▶ closure ─(terminal: phase=complete)
execution-trivial:    intake ─(classified)─▶ execution ─(all-subtasks-approved)─▶ closure ─(terminal)
execution-simple:     intake ─(classified)─▶ planning ─(p1-approved-execute)─▶ execution ─(all-subtasks-approved)─▶ closure ─(p4-approved)─▶ complete
execution-full:       intake ─(classified)─▶ planning ─(p1-approved-execute)─▶ execution ─(all-subtasks-approved)─▶ closure ─(p4-approved)─▶ complete

Reopens (schema_version 3+):
  execution ─(needs-replan or p2-replan)─▶ planning ─(p1-approved-execute or p1-signature-unchanged)─▶ execution
  closure   ─(reversal)─▶ execution ─(...)─▶ closure
```

Soft cap on reopens: `stage_reopen_count >= 3` triggers a `blocker-escalation-report` plus a "Continue / Abort" P-gate. See `${CLAUDE_PLUGIN_ROOT}/skills/shared/orchestrator-state/SKILL.md` → "Stage Discipline" for the full reopen protocol.

---

## Stage 1 — Intake

**Entry:** user runs `/ai-agents-workflow:task <request>`. Hook chain fires (`check-plan-mode.js` first, then `pre-task-guard.js`). On pass, chief-orchestrator is dispatched.

**Subagents legal in this stage:** `chief-orchestrator`, `delivery-pm`. (Delivery PM is whitelisted so the upcoming planning transition can dispatch it without a stage-mismatch race.)

### Steps

**Step 0 — Intake Classification.** Invoke the `orchestrator-intake` skill. The skill (a) runs an ambiguity check (Step 0a), asking ≤3 clarifying questions if signals fire; (b) applies checklist heuristics to produce a `heuristic_verdict`; (c) ALWAYS calls `AskUserQuestion` with four radio-button options (`Direct answer` / `Plan only` / `Execute (lightweight)` / `Execute (full pipeline)`) — the heuristic's pick is marked `(Recommended)`. The user's choice is the `final_path`.

- If `final_path = direct-answer`: write the minimal `<!-- section:intake-classification -->` block to `task-data.md` (when an `<artifact-root>` exists), respond inline, and write a compact `<task_id>/summary.md` per `telemetry-summary` → "Non-execution path summaries". No `orchestration-state.json` is created. Stage exit is conceptual; the task terminates here.
- If `final_path = execution-trivial`: follow the compressed flow in `<!-- section:trivial-flow -->` below.
- All other paths: continue to Step 1.

**Step 1 — Receive the task** (mechanical: derive `task_id`, allocate task directory).

**Step 2 — Initialize artifacts.** Create `task-data.md` with `<!-- section:intake-classification -->` + `<!-- section:task-packet -->` (via `task-packet` skill). Initialize `orchestration-state.json` with `schema_version: 3`, `stage: "intake"`, `previous_stage: null`, an open `stage_history[0]` entry, `stage_reopen_count: 0`, `pending_subtasks_needing_rereview: []`, and the existing v2 fields. Persist `classification`. For `execution-trivial`, set `gates.p1_approved: true` and `gates.p1_approved_signature: "trivial-path-auto"` in this initial write.

### Stage exit

Close the intake `stage_history` entry with `exit_reason: "classified"`, append the next entry, set `previous_stage: "intake"`. Transition by path:

| Path | Next stage |
|---|---|
| direct-answer | (terminal — no further state) |
| plan-only / execution-simple / execution-full | `planning` |
| execution-trivial | `execution` |

---

## Stage 2 — Planning

**Entry:** from `intake` after classification ∈ {plan-only, execution-simple, execution-full}, or from a reopen (`execution → planning` triggered by Reviewer `needs-replan` or P2 user-elected replan).

**Subagents legal in this stage:** `chief-orchestrator`, `delivery-pm`, `lead`, `design-agent`. (Lead and design-agent are listed for the planning→execution boundary; the orchestrator typically waits to dispatch them until `stage = "execution"`.)

### Steps

**Step 3 — Delivery PM.** Dispatch `Task(delivery-pm)`. PM appends `<!-- section:delivery-plan -->` to `task-data.md`. For `execution-simple`, the dispatch bundle includes a low-complexity hint. After return, the orchestrator populates `subtask_offsets` in `orchestration-state.json` (`orchestrator-state` skill).

**Step 4 — P1 — Delivery Plan Approval gate.** `orchestrator-user-gates` skill. Always fires for `plan-only`, `execution-simple`, `execution-full`. Skipped for `execution-trivial` (auto-approved at Step 2). For `plan-only`, after P1 records `phase: planned`, refresh `<task_id>/summary.md` via `telemetry-summary` ("Non-execution path summaries" schema) so the task has a rolled-up artifact even though no execution ran.

Enforced at runtime by `hooks/pre-task-guard.js` Phase 3: any `Task` dispatch with `subagent_type ∈ {lead, executor, reviewer, design-agent, integration-checker}` is blocked until `gates.p1_approved: true` is recorded.

**Step 5 — Determine `mode`** (`normal` vs `degraded-inline`) per `orchestrator-degraded` skill.

### Stage exit

Close the planning `stage_history` entry, append next, set `previous_stage: "planning"`. Transition by user choice at P1:

| Choice | Next stage | Exit reason |
|---|---|---|
| Approve plan and execute | `execution` | `p1-approved-execute` |
| Approve plan and stop (plan-only) | `closure` | `p1-approved-stop` |
| (Silent reopen re-entry — signature unchanged) | `execution` | `p1-signature-unchanged` |

---

## Stage 3 — Execution

**Entry:** from `planning` (after P1 approve & execute), from `intake` (execution-trivial), or from a reopen (`closure → execution` reversal).

**Subagents legal in this stage:** `chief-orchestrator`, `lead`, `executor`, `reviewer`, `design-agent`, `integration-checker`.

### Per-subtask procedure (loops over `pending_subtasks` in plan order)

**Step 6 — Pre-dispatch.** Before every agent dispatch: write state → `ai-work.md` skeleton → `summary.md` skeleton (with empty `<!-- section:dispatch-bundles -->` placeholder) → compose dispatch bundle in memory via `context-minimizer` → Pre-Dispatch Checklist → embed bundle inline in the Task prompt → after dispatch returns, append one-line audit entry to `summary.md` → `<!-- section:dispatch-bundles -->`.

**Step 7 — Domain-tagged routing.** Design Agent runs first when triggered; Lead receives addendum in `<!-- section:plan-addendum -->`. Triggers per `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md`.

**Step 8 — Lead.** Appends `<!-- section:tep -->`. For `complexity: low` without triggers, Lead may dispatch Executor directly with the spec as a lightweight TEP; ultra-light tier uses compact inline artifact format.

**Step 9 — Executor.** Executor MUST invoke `pr-lessons-check` before claiming complete (mandatory hard rule — see `skills/execution/implementation-report/SKILL.md`). Appends `<!-- section:implementation -->`.

**Step 10 — Integration Checker.** Runs per `TRIGGER_RULES.md` → `<!-- section:integration-trigger -->`. Report appended to `<!-- section:integration-check -->`. `verdict: NOT ok` → route fixes before Review.

**Step 11 — Reviewer.** Reviewer MUST invoke `pr-lessons-check` during review (mandatory — see `skills/execution/review-report/SKILL.md`). Appends `### Cycle N` to `<!-- section:review -->` and finalizes `<subtask_id>/summary.md`. Rework routing + delta bundles → `orchestrator-dispatch` skill → "Delta-review protocol". Rework cap → `TRIGGER_RULES.md` → `<!-- section:rework-cap -->`.

**Reviewer reopen detection:** if Reviewer returns `verdict: needs-replan`, run the reopen protocol in `orchestrator-dispatch` SKILL → "Reopen detection". This rewinds `stage` to `planning`, increments `stage_reopen_count`, snapshots the delivery-plan signature, dispatches `delivery-pm`, runs the auto-diff procedure, and either silently re-enters execution (signature unchanged) or re-fires P1 (signature changed).

**Step 12 — P2 — Phase Boundary Checkpoint** (`orchestrator-user-gates`). Skip if plan has only one phase. P2 menu may also elect a replan — same protocol as needs-replan, with `exit_reason: "p2-replan"`.

### Stage exit

When `pending_subtasks` empty AND last Reviewer verdict was `approved` AND `blocked_gates` empty AND `pending_user_actions` empty → close the execution `stage_history` entry with `exit_reason: "all-subtasks-approved"` and transition to `closure`. Reopen exits (`needs-replan`, `p2-replan`) transition target = `planning`.

---

## Stage 4 — Closure

**Entry:** from `execution` (all subtasks approved + state clean), from `planning` (plan-only after P1 approve-and-stop). Direct-answer terminates after intake and never enters closure.

**Subagents legal in this stage:** `chief-orchestrator` only. P5's `post-task-review` runs as a Skill (not a Task), so no subagent dispatch happens in closure on the happy path.

### Steps

**Step 13 — Post-approval state cleanup.** Orchestrator clears `current_subtask`, ensures `pending_subtasks`, `blocked_gates`, and `pending_user_actions` are all empty. Owned by `orchestrator-state` skill → "Post-Approval Closure".

**Step 13b — Task-level summary finalization.** `telemetry-summary` aggregates per-subtask `summary.md` files into `<artifact-root>/tasks/<task_id>/summary.md`.

**Step 14 — P4 — Task Completion Review** (`orchestrator-user-gates`): user picks Approve / Reopen subtask / Add follow-up / Run retrospective. Optionally **P5 — Post-Task Retrospective** via `post-task-review` skill.

**Step 15 — Final state transition.** Task is `complete` only when the task summary exists, `workflow_state: complete`, `open_gates` empty, `pending_user_actions` empty. **Before writing `phase: "complete"`, the task-level `summary.md` MUST already have a populated `## Status` section, an aggregate `## Changes by Phase` block, and per-subtask telemetry totals.** The `validate-artifact-chain` hook blocks `phase: "complete"` when the task-level summary is missing or has an empty `## Status`.

### Per-path closure variations

| Path | Closure activities |
|---|---|
| `plan-only` | `telemetry-summary` non-execution schema (records the approved plan). No P4. No P5. |
| `execution-trivial` | Steps 13, 13b, 15. **Skip P4 by default** (one-line completion message; user can request a full P4). **Skip P5.** |
| `execution-simple` | Full sequence (13 → 15). P5 optional based on user choice at P4. |
| `execution-full` | Full sequence. P5 strongly suggested at P4 if task had rework cycles or ≥3 subtasks. |

### Stage exit (terminal closure entry shape)

- **P4 fired and approved** → entry has `exited_at` set and `exit_reason: p4-approved`. Task is `complete`.
- **P4 skipped** (plan-only, trivial-default) → terminal entry stays open: `exited_at: null, exit_reason: null`. Task completion is signaled by `phase: complete`, not by closing the closure `stage_history` entry.
- **Reversal** (non-terminal exit from closure) → entry has `exited_at` set and `exit_reason: reversal`, then a fresh `execution` entry is appended with `previous_stage: "closure"`, `stage_reopen_count++`. See `orchestrator-dispatch` SKILL → "Reopen detection".

<!-- /section:default-flow -->

<!-- section:trivial-flow -->

## Compressed flow for `execution-trivial`

The trivial path bypasses Delivery PM, the P1 gate, and Lead. It is reserved for mechanical changes with zero design ambiguity (typo, single-string update, single-line bump). Bundle composition is the same as for any other path — composed in memory by `context-minimizer` and embedded inline in the Task prompt; trivial just skips the upstream stages. Steps:

1. **Step 0** — `orchestrator-intake` returns `execution-trivial` as `final_path` (heuristic verdict + user confirmation via the mandatory `AskUserQuestion` popup; user may have overridden a different heuristic verdict to land here).
2. **Step 1/2** — Create `task-data.md` with `<!-- section:intake-classification -->` recording the trivial classification. Skip `task-packet` content beyond what is needed for the artifact chain. Initialize `orchestration-state.json` with:
   - `schema_version: 3`
   - `classification: "execution-trivial"`
   - `stage: "execution"` (skips the planning stage entirely; intake's stage_history entry closes with `exit_reason: "classified"` and the execution entry opens)
   - `gates.p1_approved: true`
   - `gates.p1_approved_signature: "trivial-path-auto"`
   - `gates.p1_approved_at`: ISO-8601 UTC of write time
   - `phase: "execution"`
   - `pending_subtasks: ["<single-subtask-id>"]`
3. **Step 6** — Create the single subtask directory + `ai-work.md` skeleton + `summary.md` skeleton. Compose the dispatch bundle via `context-minimizer` and embed it inline in the Executor Task prompt (no role-bundle files are written for any classification).
4. **Step 9** — Dispatch Executor with the full TEP carried inline in the Task `prompt` parameter. The TEP must include: spec (verbatim user request), target_files (single path), context_bundle (only if non-trivial signatures are involved), acceptance_signals. Lead is not invoked. Executor still consults `pr-lessons-check` before claiming complete.
5. **Step 11** — Reviewer reads `ai-work.md` directly and appends `### Cycle 1` to `<!-- section:review -->`. If pass, finalize `summary.md`. If fail, normal Cycle N rework loop applies. Reviewer also consults `pr-lessons-check`.
6. **Closure** — Steps 13 + 13b + 15. **Skip P2** (single phase) and **skip P4** by default — present a one-line completion message instead. The user can request a full P4 review if desired. The closure `stage_history` entry stays open (`exited_at: null, exit_reason: null`); task completion is signaled by `phase: complete`.
7. **`orchestration-history.json` is not written** for trivial tasks — there is exactly one completed subtask and the hot state captures it.

Hook behavior on the trivial path:
- `pre-task-guard.js` Phase 3 (P1 gate) allows the dispatch on classification match.
- `pre-task-guard.js` Phase 3.5 (stage guard) allows Executor and Reviewer because the state's `stage` is `execution` from Step 2 onward.

If at any point during execution a trivial task reveals hidden complexity (Reviewer surfaces a design concern, Executor encounters API/schema risk), the orchestrator MUST stop, upgrade `classification` to `execution-simple`, and re-enter the normal flow at Step 3 (Delivery PM dispatch + P1 gate). This involves a stage rewind: append a `stage_history` entry transitioning `execution → planning` with `exit_reason: "needs-replan"` and `stage_reopen_count++`.

<!-- /section:trivial-flow -->

<!-- section:escalation -->

## Escalation

- unresolved blockers
- invalid artifact chain
- review failure after complexity-tied cycle cap
- missing context blocking safe execution
- reopen soft cap exceeded (`stage_reopen_count >= 3`)

<!-- /section:escalation -->

## Related playbooks

- `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION-RESUME.md` — resume entry point and resume codes (stage-aware)

## Related skills (post-folder-reorg paths)

- `intake/orchestrator-intake` — Step 0 classification
- `shared/orchestrator-dispatch` — bundle protocol, skeleton, checklist, artifact gate, token-saving, delta-review, **reopen detection**
- `shared/orchestrator-state` — state schema, **stage discipline**, phase transitions, post-approval closure, auto-diff procedure
- `shared/orchestrator-telemetry` — telemetry and context manifest rules
- `shared/orchestrator-degraded` — dispatch failure handling, degraded-inline mode
- `shared/orchestrator-user-gates` — P1 / P2 / P4 / P5
- `shared/pr-lessons-check` — consulted by Executor (mandatory) and Reviewer (mandatory); optionally by Lead

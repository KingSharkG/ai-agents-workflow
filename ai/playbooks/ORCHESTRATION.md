# ORCHESTRATION

The chief-orchestrator's lifecycle is organized into four explicit **stages**: `intake`, `planning`, `execution`, `closure`. Each stage owns a slice of the 15 procedural steps. The `stage` field in `orchestration-state.json` (schema_version 3) records which stage the task is in; the `pre-task-guard.js` Phase 3.5 hook blocks subagent dispatches that don't belong to the active stage.

This file groups the steps by stage. Step numbers are preserved as cross-reference anchors — older docs that say "Step 6" still resolve here.

<!-- section:default-flow -->

## Stage transition diagram

```
direct-answer:        intake ─(classified)─▶ (terminal — no state)
plan-only:            intake ─(classified)─▶ planning ─(p1-approved-stop)─▶ closure ─(terminal: phase=planned, resumable via /continue EXECUTE_PLAN)
execution-trivial:    intake ─(classified)─▶ execution ─(all-subtasks-approved)─▶ closure ─(terminal)
execution-simple:     intake ─(classified)─▶ planning ─(p1-approved-execute)─▶ execution ─(all-subtasks-approved)─▶ closure ─(p4-approved)─▶ complete
execution-full:       intake ─(classified)─▶ planning ─(p1-approved-execute)─▶ execution ─(all-subtasks-approved)─▶ closure ─(p4-approved)─▶ complete

Reopens (schema_version 3+):
  execution ─(needs-replan or p2-replan)─▶ planning ─(p1-approved-execute or p1-signature-unchanged)─▶ execution
  closure   ─(reversal)─▶ execution ─(...)─▶ closure
```

Soft cap on reopens: `stage_reopen_count >= 3` triggers a `blocker-escalation-report` plus a "Continue / Abort" P-gate. See `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/SKILL.md` → "Stage Discipline" for the full reopen protocol.

---

## Stage 1 — Intake

**Entry:** user runs `/ai-agents-workflow:task <request>`. The `pre-task-guard.js` PreToolUse hook fires (Phase 0 plan-mode check, then artifact-root + skeleton + P1 + stage gates). On pass, chief-orchestrator is dispatched.

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

**Step 9 — Executor.** Executor MUST invoke `pr-lessons-check` before claiming complete (mandatory hard rule — see `skills/implementation-report/SKILL.md`). Appends `<!-- section:implementation -->`.

**Step 10 — Integration Checker.** Runs per `TRIGGER_RULES.md` → `<!-- section:integration-trigger -->`. Report appended to `<!-- section:integration-check -->`. `verdict: NOT ok` → route fixes before Review.

**Step 11 — Reviewer.** Reviewer MUST invoke `pr-lessons-check` during review (mandatory — see `skills/review-report/SKILL.md`). Appends `### Cycle N` to `<!-- section:review -->` and finalizes `<subtask_id>/summary.md`. Rework routing + delta bundles → `orchestrator-dispatch` skill → "Delta-review protocol". Rework cap → `TRIGGER_RULES.md` → `<!-- section:rework-cap -->`.

**Reviewer reopen detection:** if Reviewer returns `verdict: needs-replan`, run the reopen protocol in `orchestrator-dispatch` SKILL → "Reopen detection". This rewinds `stage` to `planning`, increments `stage_reopen_count`, snapshots the delivery-plan signature, dispatches `delivery-pm`, runs the auto-diff procedure, and either silently re-enters execution (signature unchanged) or re-fires P1 (signature changed).

**Step 12 — P2 — Phase Boundary Checkpoint** (`orchestrator-user-gates`). Skip if plan has only one phase. P2 menu may also elect a replan — same protocol as needs-replan, with `exit_reason: "p2-replan"`.

**Step 12.5 — Stage transition `execution → closure` (MANDATORY before any closure step).** When `pending_subtasks` empty AND last Reviewer verdict was `approved` AND `blocked_gates` empty AND `pending_user_actions` empty, write `orchestration-state.json` in a single transition write:

- Set `stage: "closure"`, `previous_stage: "execution"`.
- Close the open execution `stage_history` entry with `exited_at` (ISO-8601 UTC) and `exit_reason: "all-subtasks-approved"`.
- Append a new `stage_history` entry with `stage: "closure"`, `entered_at` (same timestamp), `exited_at: null`.

This is the **only** legitimate way to enter the closure stage on a normal completion. Reopen exits (`needs-replan`, `p2-replan`) transition target = `planning` and do NOT pass through Step 12.5. The `validate-orchestration-state-write.js` hook blocks any subsequent `phase: "complete"` write when `stage !== "closure"` — treat that hook denial as your own protocol violation.

### Stage exit

Stage exit is the write performed in Step 12.5 above. The companion `closure` stage entry is what subsequent closure-stage steps (Step 13 onward) operate on.

---

## Stage 4 — Closure

**Entry:** from `execution` (all subtasks approved + state clean), from `planning` (plan-only after P1 approve-and-stop). Direct-answer terminates after intake and never enters closure.

**Subagents legal in this stage:** `chief-orchestrator` only. P5's `post-task-review` runs as a Skill (not a Task), so no subagent dispatch happens in closure on the happy path.

### Steps

**Step 13 — Post-approval state cleanup.** Prerequisite: Step 12.5 has already flipped `stage` to `closure`. Orchestrator clears `current_subtask`, ensures `pending_subtasks`, `blocked_gates`, and `pending_user_actions` are all empty. Owned by `orchestrator-state` skill → "Post-Approval Closure".

**Step 13b — Task-level summary finalization.** `telemetry-summary` aggregates per-subtask `summary.md` files into `<artifact-root>/tasks/<task_id>/summary.md`.

**Step 14 — P4 — Task Completion Review** (`orchestrator-user-gates`): user picks Approve / Reopen subtask / Add follow-up / Run retrospective. Optionally **P5 — Post-Task Retrospective** via `post-task-review` skill.

**Step 15 — Final state transition.** Task is `complete` only when ALL of the following hold (hook-enforced — `validate-orchestration-state-write.js` + `validate-artifact-chain.js` + `guard-chief-orchestrator-stop.js`):

1. `stage: "closure"` (Step 12.5 already ran).
2. The LAST `stage_history` entry has `stage: "closure"` AND is closed: `exited_at` set, `exit_reason ∈ {"p4-approved", "completed-without-p4"}`.
3. `phase: "complete"`. (`workflow_state` on hot state is OPTIONAL with enum `complete | done | blocked`; when present, validator C4 enforces phase agreement. Do NOT use `workflow_state` as a substitute for `phase`. The per-subtask `summary.md` `workflow_state` uses a different enum — `in-progress | approved | blocked-on-user | pending-integration-check | needs-replan` — and is namespaced to the subtask, not the task.)
4. `pending_subtasks: []`, `blocked_gates: []`, `pending_user_actions: []`, `current_subtask: null`.
5. `last_completed_seq` equals `orchestration-history.json.completed_subtasks.length`.
6. Task-level `<artifact-root>/tasks/<task_id>/summary.md` exists with **populated body content** under the canonical `telemetry-summary` template headings: `## Task Status`, `## Changes by Phase`, `## Detail`, `## Totals`, `## Dispatch Bundles`, `## Context Breakdown`. Empty headings (heading present, body whitespace-only) fail the check. The trivial path is relaxed to require only `## Task Status` (matches `validateRequiredHeadings`'s trivial relaxation).

Treat any hook denial as your own protocol violation, never as an obstacle to bypass.

### Per-path closure variations

| Path | Closure activities |
|---|---|
| `plan-only` | Closure stage is entered directly from `planning` at the P1 gate (`planning → closure` with `exit_reason: "p1-approved-stop"`) — this is **not** Step 12.5, which is `execution → closure`. The closure `stage_history` entry stays **OPEN** (`exited_at: null`, `exit_reason: null`) and the state's `phase` is set to `"planned"` — terminal-but-resumable via `/continue EXECUTE_PLAN`. Then `telemetry-summary` runs in its non-execution schema (records the approved plan). No P4. No P5. The task is NOT marked `phase: "complete"` — that only happens if a future `/continue` chooses to skip execution (a path not currently surfaced in the resume menu; if the user wants to discard a planned task, they delete it manually). |
| `execution-trivial` | Steps 12.5 → 13 → 13b → 15. **Skip P4 by default** (one-line completion message; user can request a full P4). **Skip P5.** |
| `execution-simple` | Full sequence (12.5 → 13 → 13b → 14 → 15). P5 optional based on user choice at P4. |
| `execution-full` | Full sequence (12.5 → 13 → 13b → 14 → 15). P5 strongly suggested at P4 if task had rework cycles or ≥3 subtasks. |

### Stage exit (terminal closure entry shape)

- **P4 fired and approved** → entry has `exited_at` set and `exit_reason: p4-approved`. Task is `complete`.
- **P4 skipped — trivial-default** → close the closure entry with `exited_at` set to the closure-completion timestamp and `exit_reason: completed-without-p4`, AND set `phase: "complete"`. Task completion is signaled by both `phase: complete` AND the closed terminal entry.
- **P4 skipped — plan-only** (different from trivial): the closure entry is left **OPEN** (`exited_at: null`) and `phase: "planned"` (not `complete`). The task is terminal-but-resumable; the `guard-chief-orchestrator-stop.js` hook accepts this as a legitimate stop when `classification: "plan-only"`. Readers MUST special-case `phase: "planned"` — it is NOT a stale open entry.
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
   - `mode: "normal"` — required by `validate-artifact-chain.js` whenever `stage !== "intake"`. Trivial skips Step 5 (where non-trivial paths compute mode via the degraded-inline check), so the value is hardcoded.
   - `task_summary_path: "<artifact-root>/tasks/<task_id>/summary.md"` — also required by `validate-artifact-chain.js` for non-intake stages.
   - `last_completed_seq: 0` — required for `schema_version >= 2` on non-intake writes; incremented to `1` after the single subtask closes.
   - `current_subtask: null`, `blocked_gates: []`, `pending_user_actions: []`, `pending_subtasks_needing_rereview: []`, `stage_reopen_count: 0`, `previous_stage: "intake"`.
   - `stage_history[]` with TWO entries on this initial write: the closed `intake` entry (`exited_at` set, `exit_reason: "classified"`) and the open `execution` entry (`exited_at: null`).
3. **Step 6** — Create the single subtask directory + `ai-work.md` skeleton + `summary.md` skeleton. Compose the dispatch bundle via `context-minimizer` and embed it inline in the Executor Task prompt (no role-bundle files are written for any classification).

   **Context guard (trivial path).** Between Step 6 (skeleton) and Step 9 (executor dispatch), do NOT re-invoke `orchestrator-state` or `orchestrator-telemetry` (or any other skill). State is already fresh from Step 2 and telemetry formatting happens post-dispatch. Compose the dispatch bundle via `context-minimizer` and dispatch immediately. This keeps context consumption minimal so the executor has maximum budget.
4. **Step 9** — Dispatch Executor with the full TEP carried inline in the Task `prompt` parameter. The TEP must include: spec (verbatim user request), target_files (single path), context_bundle (only if non-trivial signatures are involved), acceptance_signals. Lead is not invoked. Executor still consults `pr-lessons-check` before claiming complete. **Executor MUST invoke the `implementation-report` skill and append its output to `<!-- section:implementation -->` in `ai-work.md` before returning** — an empty section is a contract violation that `guard-chief-orchestrator-stop` will block. This applies to the trivial path identically to simple/full; the trivial compression skips the *upstream* stages, not the artifact write.
5. **Step 11** — Reviewer reads `ai-work.md` directly and appends `### Cycle 1` to `<!-- section:review -->`. If pass, finalize `summary.md`. If fail, normal Cycle N rework loop applies. Reviewer also consults `pr-lessons-check`.
6. **Closure** — Steps **12.5** → 13 → 13b → 15. **Step 12.5 is mandatory even on the trivial path** — chief MUST flip `stage` to `closure` before writing `phase: "complete"`, or the `validate-orchestration-state-write` hook will block. **Skip P2** (single phase) and **skip P4** by default — present a one-line completion message instead. The user can request a full P4 review by replying with "review" / "run P4" in the same turn; if they do, fire P4 normally. The closure `stage_history` entry closes with `exited_at` set and `exit_reason: completed-without-p4` (the previously-documented "leave open with null" behavior is superseded by this exit reason).
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

## Related skills

(Plugin uses a flat skill layout — paths are `skills/<name>/SKILL.md`, not `skills/<stage>/<name>/SKILL.md`. The `stage:` frontmatter on each SKILL.md records its conceptual grouping. See `${CLAUDE_PLUGIN_ROOT}/CLAUDE.md` → "Layout" for the rationale and the conceptual-group breakdown.)

- `orchestrator-intake` — Step 0 classification
- `orchestrator-dispatch` — bundle protocol, skeleton, checklist, artifact gate, token-saving, delta-review, **reopen detection**
- `orchestrator-state` — state schema, **stage discipline**, phase transitions, post-approval closure, auto-diff procedure
- `orchestrator-telemetry` — telemetry and context manifest rules
- `orchestrator-degraded` — dispatch failure handling, degraded-inline mode
- `orchestrator-user-gates` — P1 / P2 / P4 / P5
- `pr-lessons-check` — consulted by Executor (mandatory) and Reviewer (mandatory); optionally by Lead

# ORCHESTRATION

<!-- section:default-flow -->

## Default flow (15-step outline)

Each step cites the skill that owns the procedural detail. Full step content lives in the skills — this file is a quick-reference outline.

0. **Intake Classification** → `orchestrator-intake` skill. The skill runs checklist-based heuristics, then ALWAYS calls `AskUserQuestion` with four radio-button options (`Direct answer` / `Plan only` / `Execute (lightweight)` / `Execute (full pipeline)`) — the heuristic's pick is marked `(Recommended)` as the default. The user's choice is the `final_path`. If `final_path = direct-answer`, write the minimal `<!-- section:intake-classification -->` block to `task-data.md` (when an `<artifact-root>` exists) and respond inline. If `final_path = execution-trivial`, follow the compressed flow in `<!-- section:trivial-flow -->` below.
1. Chief Orchestrator receives the task.
2. Create `task-data.md` with `<!-- section:intake-classification -->` then task-packet → `task-packet` skill. Persist `classification` to `orchestration-state.json`.
3. Delivery PM appends `<!-- section:delivery-plan -->` → `delivery-plan` skill. For `execution-simple`, bundle includes a low-complexity hint. Orchestrator then populates `subtask_offsets` in `orchestration-state.json` → `orchestrator-state` skill.
4. **P1 — Delivery Plan Approval** → `orchestrator-user-gates` skill (menu varies by classification). **Always fires** for `plan-only`, `execution-simple`, and `execution-full`. **Skipped for `execution-trivial`** — the orchestrator auto-records `gates.p1_approved: true` with `signature: "trivial-path-auto"` because there is no plan to approve. Enforced at runtime by `hooks/pre-task-guard.js` (Phase 3): any `Task` dispatch with `subagent_type ∈ {lead, executor, reviewer, design-agent, integration-checker}` is blocked until `gates.p1_approved: true` is recorded (or classification is `execution-trivial`).
5. Determine and persist `mode` (`normal` vs `degraded-inline`) → `orchestrator-degraded` skill.
6. Before every agent dispatch: write state → ai-work.md skeleton → summary.md skeleton (with empty `<!-- section:dispatch-bundles -->` placeholder) → compose dispatch bundle in memory via `context-minimizer` → Pre-Dispatch Checklist → embed bundle inline in the Task prompt → after dispatch returns, append one-line audit entry to `summary.md` → `<!-- section:dispatch-bundles -->`.
7. Domain-tagged routing: Design Agent runs first when triggered; Lead receives addendum in `<!-- section:plan-addendum -->`. Triggers per `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md`.
8. Lead appends `<!-- section:tep -->`. `complexity: low` without triggers may dispatch Executor directly with spec as lightweight TEP; ultra-light tier uses compact inline artifact format.
9. Executor appends `<!-- section:implementation -->`.
10. Integration Checker runs per `TRIGGER_RULES.md` → `<!-- section:integration-trigger -->`. Report appended to `<!-- section:integration-check -->`. `verdict: NOT ok` → route fixes before Review.
11. Reviewer appends `### Cycle N` to `<!-- section:review -->` and finalizes `<subtask_id>/summary.md`. Rework routing + delta bundles → `orchestrator-dispatch` skill. Rework cap → `TRIGGER_RULES.md` → `<!-- section:rework-cap -->`.
12. **P2 — Phase Boundary Checkpoint** → `orchestrator-user-gates` skill. Skip if plan has only one phase.
13. Post-approval closure → `orchestrator-state` skill → refresh task-level summary via `telemetry-summary` skill.
14. **P4 — Task Completion Review** and optionally **P5 — Post-Task Retrospective** → `orchestrator-user-gates` skill (P5 body via `post-task-review`).
15. Task is `complete` only when task summary exists, `workflow_state: complete`, `open_gates` empty, `pending_user_actions` empty.

<!-- /section:default-flow -->

<!-- section:trivial-flow -->

## Compressed flow for `execution-trivial`

The trivial path bypasses Delivery PM, the P1 gate, and Lead. It is reserved for mechanical changes with zero design ambiguity (typo, single-string update, single-line bump). Bundle composition is the same as for any other path — composed in memory by `context-minimizer` and embedded inline in the Task prompt; trivial just skips the upstream stages. Steps:

1. **Step 0** — `orchestrator-intake` returns `execution-trivial` as `final_path` (heuristic verdict + user confirmation via the mandatory `AskUserQuestion` popup; user may have overridden a different heuristic verdict to land here).
2. **Step 1** — Create `task-data.md` with `<!-- section:intake-classification -->` recording the trivial classification. Skip `task-packet` content beyond what is needed for the artifact chain.
3. **Step 2** — Write initial `orchestration-state.json` with:
   - `classification: "execution-trivial"`
   - `gates.p1_approved: true`
   - `gates.p1_approved_signature: "trivial-path-auto"`
   - `gates.p1_approved_at`: ISO-8601 UTC of write time
   - `phase: "execution"`
   - `pending_subtasks: ["<single-subtask-id>"]`
4. **Step 3** — Create the single subtask directory + `ai-work.md` skeleton + `summary.md` skeleton. Compose the dispatch bundle via `context-minimizer` and embed it inline in the Executor Task prompt (no role-bundle files are written for any classification).
5. **Step 4** — Dispatch Executor with the full TEP carried inline in the Task `prompt` parameter. The TEP must include: spec (verbatim user request), target_files (single path), context_bundle (only if non-trivial signatures are involved), acceptance_signals. Lead is not invoked.
6. **Step 5** — Executor implements and appends `<!-- section:implementation -->` to `ai-work.md`.
7. **Step 6** — Compose Reviewer dispatch bundle via `context-minimizer` and embed it inline in the Task prompt (same pattern as every dispatch). Reviewer reads `ai-work.md` directly and appends `### Cycle 1` to `<!-- section:review -->`. If pass, finalize `summary.md`. If fail, normal Cycle N rework loop applies.
8. **Step 7** — Closure: refresh task-level summary via `telemetry-summary`. **Skip P2** (single phase) and **skip P4** by default — present a one-line completion message instead. The user can request a full P4 review if desired.
9. **`orchestration-history.json` is not written** for trivial tasks — there is exactly one completed subtask and the hot state captures it.

Hook behavior on the trivial path:
- `pre-task-guard.js` Phase 3 (P1 gate) allows the dispatch on classification match.
- `pre-task-guard.js` Phase 2 (skeleton check) does not test for any `roles/<role>.md` file regardless of classification — bundles are inline. The `ai-work.md` skeleton check still applies.

If at any point during execution a trivial task reveals hidden complexity (Reviewer surfaces a design concern, Executor encounters API/schema risk), the orchestrator MUST stop, upgrade `classification` to `execution-simple`, and re-enter the normal flow at Step 3 (Delivery PM dispatch + P1 gate).

<!-- /section:trivial-flow -->

<!-- section:escalation -->

## Escalation

- unresolved blockers
- invalid artifact chain
- review failure after complexity-tied cycle cap
- missing context blocking safe execution

<!-- /section:escalation -->

## Related playbooks

- `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION-RESUME.md` — resume entry point and resume codes

## Related skills

- `orchestrator-intake` — Step 0 classification
- `orchestrator-dispatch` — bundle protocol, skeleton, checklist, artifact gate, token-saving, delta-review
- `orchestrator-state` — state schema, phase transitions, post-approval closure
- `orchestrator-telemetry` — telemetry and context manifest rules
- `orchestrator-degraded` — dispatch failure handling, degraded-inline mode
- `orchestrator-user-gates` — P1 / P2 / P4 / P5

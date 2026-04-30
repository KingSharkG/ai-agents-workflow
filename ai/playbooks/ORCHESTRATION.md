# ORCHESTRATION

<!-- section:default-flow -->

## Default flow (15-step outline)

Each step cites the skill that owns the procedural detail. Full step content lives in the skills — this file is a quick-reference outline.

0. **Intake Classification** → `orchestrator-intake` skill. If `direct-answer`, respond inline and exit with zero artifacts.
1. Chief Orchestrator receives the task.
2. Create `task-data.md` with `<!-- section:intake-classification -->` then task-packet → `task-packet` skill. Persist `classification` to `orchestration-state.json`.
3. Delivery PM appends `<!-- section:delivery-plan -->` → `delivery-plan` skill. For `execution-simple`, bundle includes a low-complexity hint. Orchestrator then populates `subtask_offsets` in `orchestration-state.json` → `orchestrator-state` skill.
4. **P1 — Delivery Plan Approval** → `orchestrator-user-gates` skill (menu varies by classification). **Always fires** for `plan-only`, `execution-simple`, and `execution-full` — there is no shortcut path. Enforced at runtime by `hooks/guard-pre-dispatch-p1.js`: any `Task` dispatch with `subagent_type ∈ {lead, executor, reviewer, design-agent, integration-checker}` is blocked until `gates.p1_approved: true` is recorded in `orchestration-state.json`.
5. Determine and persist `mode` (`normal` vs `degraded-inline`) → `orchestrator-degraded` skill.
6. Before every agent dispatch: write state → ai-work.md skeleton → summary.md skeleton → dispatch bundle → Pre-Dispatch Checklist → `orchestrator-dispatch` skill (bundle contents assembled via `context-minimizer`).
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

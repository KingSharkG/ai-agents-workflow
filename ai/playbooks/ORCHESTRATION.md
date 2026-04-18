# ORCHESTRATION

<!-- section:default-flow -->

## Default flow

1. Chief Orchestrator receives the task.
2. Create `task-data.md` at `ai-workflow-data/tasks/<task_id>/task-data.md` using the `task-packet` skill. The task-packet content lives inside `<!-- section:task-packet -->`.
3. Delivery PM appends the Delivery Plan section to `task-data.md` using the `delivery-plan` skill. The delivery-plan content lives inside `<!-- section:delivery-plan -->` (with nested `<!-- section:delivery-subtask-* -->` IDs unchanged). After the Delivery PM completes, the orchestrator populates `subtask_offsets` in `orchestration-state.json` with the line range of each `<!-- section:delivery-subtask-<id> -->` block — this enables targeted reads later (see `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION-STATE.md`).
4. **User Gate P1 — Delivery Plan Approval.** After the Delivery PM completes step 3, the orchestrator presents the delivery plan summary (subtask count, phases, ordering, complexity sizing, integration gates) and asks the user via `AskUserQuestion`: `Approve plan` / `Revise plan` / `Abort task`. If `Revise plan`: collect notes, route back to Delivery PM, re-present. Loop until approved. No subtask agent may be dispatched before P1 approval.
5. Before any role-owned step, the Chief Orchestrator MUST determine the workflow mode and persist it to `orchestration-state.json`:
   - `mode: normal` — agent dispatch is available. Dispatch bundles, role separation, and normal gates apply.
   - `mode: degraded-inline` — agent dispatch is unavailable or blocked. The orchestrator MUST record the blocker, request explicit user waiver before continuing, and MUST NOT fabricate Delivery PM / Lead / Executor / Reviewer / Integration Checker execution, dispatch bundles, or approvals. In this mode, only intake artifacts, blocker records, pending gate records, and explicitly user-waived inline work may be written.
6. Before dispatching any agent for a subtask, the Chief Orchestrator MUST write both:
   - The `ai-work.md` skeleton at `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` using the template from `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:ai-work-skeleton -->`. The `<!-- section:spec -->` is populated by copying the exact content of the matching `<!-- section:delivery-subtask-<id> -->` from `task-data.md`.
   - The `summary.md` skeleton at `<subtask_id>/summary.md` with placeholder sections for Status, Acceptance Signals, Files Changed, Dispatch Bundles, Telemetry, Context Manifest, Notes, and Open Gates. Each agent appends its diagnostics here; the Reviewer finalizes it.
7. Every subtask in the Delivery Plan carries a `domain` tag (assigned by Delivery PM from `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:domains -->`) that rides along with dispatch. For subtasks whose domain is in `design_hook_domains`, trigger Design Agent only if rules require it. When both Design Agent and Lead are triggered for the same subtask, Design Agent MUST run first and Lead MUST receive the addendum as input — they are sequential, not parallel. The Design Review Addendum is appended to `<!-- section:plan-addendum -->` in `ai-work.md`. Lead reads this section when creating the TEP. Domain validation is absorbed by the Lead for the subtask's domain — no separate Domain Agent exists.
8. Lead appends the Technical Execution Packet to `<!-- section:tep -->` in `ai-work.md` (merges former Tech Prep + Lead validation into one step). For `complexity: low` subtasks where no Lead / Design Agent trigger fires, the orchestrator may dispatch the executor directly using `<!-- section:spec -->` from `ai-work.md` as a lightweight TEP. If the subtask additionally qualifies for the ultra-light tier (`complexity: low` + single-file diff + no endpoint/schema/auth change), use the compact inline artifact format — see `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:ultra-light-tier -->`.
9. Executor appends implementation work to `<!-- section:implementation -->` in `ai-work.md`.
10. Run Integration Checker when paired fe+be subtasks belong to the same feature (mandatory in that case — see `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:domains -->` `decomposition_rule`), when request/response contracts, auth expectations, or field/nullability alignment may have drifted across the domain boundary, or when the Delivery Plan marks `integration_gate: required`. The IC report is appended to `<!-- section:integration-check -->` in the fe subtask's `ai-work.md` (or the changed side's `ai-work.md` when only one side changed). If `verdict: NOT ok`, Orchestrator routes fix to `fix_owner` executor(s) from the IC report before proceeding to Review (see `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:integration-trigger -->`). If the IC gate is required and the IC has not yet returned `verdict: ok`, the subtask's `workflow_state` remains `pending-integration-check` even if review findings are otherwise closed.
11. Reviewer appends `### Cycle N` block to `<!-- section:review -->` in `ai-work.md` AND finalizes `<subtask_id>/summary.md`. If changes requested, return to executor with focused rework only when `cycle_count` < complexity-tied cap (see `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:rework-cap -->`). Otherwise auto-downgrade the subtask to `needs-replan` and escalate to Delivery PM via `blocker-escalation-report`. **If any finding is severity `High` and touches logic defined in the TEP** (not a style fix, not a standalone utility), the Executor's rework MUST route back through the Lead for re-validation before the Reviewer receives the next cycle. Findings of severity `Medium` or `Low` only → Executor goes directly back to Reviewer. **Rework dispatch bundles use the delta-review protocol** (see `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION-DISPATCH.md` → `<!-- section:token-saving -->`).
12. **User Gate P2 — Phase Boundary Checkpoint.** When all subtasks of a delivery-plan phase are closed AND the next phase has pending subtasks, the orchestrator presents a phase summary (subtask outcomes, rework count, open issues) and asks the user via `AskUserQuestion` with a menu: `1. Continue to Phase <N+1>` / `2. Run contract verification before continuing` / `3. Adjust scope (add/remove/reorder subtasks)` / `4. Pause and review artifacts` / `5. Abort task`. Option 2 dispatches Integration Checker in "contract-only" mode against the foundation from the completed phase, then re-presents the checkpoint. Option 3 collects changes via a follow-up question and routes to Delivery PM. **Skip P2** if the delivery plan has no explicit phase boundaries.
13. Orchestrator reads `<subtask_id>/summary.md` (written by Reviewer) and refreshes the task-level `ai-workflow-data/tasks/<task_id>/summary.md` using the `telemetry-summary` skill.
14. **User Gate P4 — Task Completion Review.** When all subtasks are closed, `blocked_gates` and `pending_user_actions` are empty, the orchestrator presents the full task summary and asks the user via `AskUserQuestion`: `Approve completion` / `Reopen subtask <id>` / `Add follow-up task`. Task `workflow_state` is set to `complete` only after P4 approval. After P4, optionally invoke the `post-task-review` skill (P5) for a retrospective.
15. Task completion is determined by the task summary's `workflow_state`, not by the file merely existing. A task is `complete` only when the task summary exists, its `workflow_state` is `complete`, and both `open_gates` and `pending_user_actions` are empty.

<!-- /section:default-flow -->

<!-- section:escalation -->

## Escalation

- unresolved blockers
- invalid artifact chain
- review failure after complexity-tied cycle cap
- missing context blocking safe execution

<!-- /section:escalation -->

## Related playbooks

- `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION-STATE.md` — orchestrator state schema and management
- `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION-RESUME.md` — resume entry point and resume codes
- `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION-DISPATCH.md` — dispatch bundle model and token-saving rules
- `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION-TELEMETRY.md` — telemetry and context manifest rules

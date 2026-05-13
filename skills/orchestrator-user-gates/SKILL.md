---
name: orchestrator-user-gates
description: Pauses for user input at four orchestration gates via AskUserQuestion. **P1** — fires after Delivery PM appends `<!-- section:delivery-plan -->` and before any subtask agent dispatch (hard-blocked by `pre-task-guard.js`). **P2** — fires when phase-N subtasks are all closed and phase-N+1 has pending work. **P4** — fires when all subtasks closed, gates empty, before setting `phase: complete`. **P5** — fires after completion for retrospective (skipped for ≤2-subtask all-first-cycle tasks). Use when reaching any of these checkpoints.
stage: shared
---

# Orchestrator User Gates — P1 / P2 / P4 / P5

The orchestrator MUST pause for user input at these checkpoints. Use `AskUserQuestion` with the specified options.

## Test-Mode Auto-Approve (E2E only)

When the originating task prompt contains the literal marker `[E2E_AUTO_APPROVE_MODE]` (typically injected by `/aiaw-e2e-test auto`), every gate in this skill auto-approves with an honest audit trail instead of popping `AskUserQuestion`. This branch exists only to make full e2e regression auditable without manual clicks. Production paths MUST always present the popup.

For each gate that fires under auto-approve mode:

| Gate | Auto-pick | State / artifact effect | Required audit line |
|---|---|---|---|
| **P1** | `Approve plan and execute` | `gates.p1_approved: true`, `gates.p1_approved_signature: "e2e-auto-approve"`, `gates.p1_approved_at: <ISO-8601>`, `gates.p1_approved_by: "e2e-auto"` | `<!-- e2e-gate-reached: P1 -->` appended to `<artifact-root>/tasks/<task_id>/task-data.md` |
| **P2** | `Continue to Phase <N+1>` | record decision in stage history; do NOT run integration verification, scope adjustment, or pause | `<!-- e2e-gate-reached: P2-phase-<N>-to-<N+1> -->` appended to `<artifact-root>/tasks/<task_id>/summary.md` |
| **P4** | `Approve completion` | proceed to `phase: complete`; honor the artifact-chain + history-consistency checks (do not bypass them) | `<!-- e2e-gate-reached: P4 -->` appended to `<artifact-root>/tasks/<task_id>/summary.md` |
| **P5** | `No feedback` | skip retrospective free-text collection but still run `post-task-review` skill if it would normally run | `<!-- e2e-gate-reached: P5 -->` appended to `<artifact-root>/tasks/<task_id>/summary.md` |

**Discipline:**

- The audit lines are non-negotiable. The verifier (`/aiaw-e2e-test verify-auto`) asserts the right set of `e2e-gate-reached` lines for each classification.
- The pre-flight invariants for each gate (artifact-chain validation at P4, history-consistency check, single-phase skip at P2) STILL run in auto mode. Auto-approve only replaces the `AskUserQuestion` step — never the prerequisite checks. A failing invariant must still emit a `blocker-escalation-report` even in auto mode.
- The signature `"e2e-auto-approve"` is distinct from `"trivial-path-auto"` (which is the production-mode auto-approve for `execution-trivial`). Do not conflate them; the verifier matches each by signature.

## P1 — Delivery Plan Approval

**When:** After Delivery PM appends `<!-- section:delivery-plan -->` to `task-data.md`, before dispatching any subtask agent.

**Hard constraint:** No subtask agent may be dispatched before P1 approval. Applies to **plan-only**, **execution-simple**, AND **execution-full** — there is no shortcut path that skips P1. (`execution-trivial` is the lone exception — it skips P1 by design and the orchestrator auto-records `gates.p1_approved: true` with `signature: "trivial-path-auto"`.) The blocking PreToolUse hook `hooks/pre-task-guard.js` (Phase 3) enforces this at runtime: any `Task` dispatch with `subagent_type ∈ {lead, executor, reviewer, design-agent, integration-checker}` is refused unless the active task's `orchestration-state.json` has `gates.p1_approved: true` (or `classification: "execution-trivial"`). Treat hook denial as an orchestration defect, not an obstacle to work around.

### Presentation format (4 blocks, in order)

Render the gate as a single message containing these four blocks before invoking `AskUserQuestion`. Mirror the structure of `project-config-review` (change summary → preview → approval question → comment loop).

**Block 1 — Classification line (one line):**

```
Classified as: <execution-simple | execution-full | plan-only> (confidence: <high | medium | low>)
```

Pull the values from `orchestration-state.json.classification` and the confidence the intake skill recorded. This makes the routing decision visible — users have reported execution starting without ever seeing what path was chosen.

**Block 2 — Subtasks table (one row per subtask):**

```
| id | title | domain | complexity | phase | depends_on |
|----|-------|--------|------------|-------|------------|
| TP-042-A1 | add login screen | fe | medium | A | none |
| TP-042-A2 | wire auth endpoint | be | medium | A | none |
| TP-042-B1 | session cookie storage | be | low | B | TP-042-A2 |
```

Source from `<!-- section:delivery-subtask-* -->` blocks in `task-data.md`. Keep the title to the heading text only — do not unfold `summary` here.

**Block 3 — Files likely to change (flat de-duplicated list):**

```
Files likely to change (best-effort, refined at TEP time):
- apps/web/src/screens/login/LoginScreen.tsx
- apps/web/src/api/auth.ts
- services/api/src/routes/auth/session.ts
```

Pull from each subtask's `target_files` field in the delivery plan and de-duplicate. If a subtask's `target_files` is empty, omit it. If **every** subtask has empty `target_files`, render a single line: `Files likely to change: (determined at TEP time)`. Lead refines exact files in the TEP regardless — this block is purposefully best-effort.

**Block 4 — Approval menu** (`AskUserQuestion`). The full option set, signature hashing rule, and 5-iteration loop cap live in `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-user-gates/references/p1-gate-rules.md`. Read once per session.

## P2 — Phase Boundary Checkpoint

**When:** All subtasks of phase N are closed in `orchestration-state.json` AND phase N+1 has pending subtasks.

**Action:** Present a phase summary (subtask outcomes, rework count, open issues) and ask via `AskUserQuestion` menu:

1. `Continue to Phase <N+1>` — proceed normally
2. `Run contract verification before continuing` — dispatch Integration Checker in "contract-only" mode against the foundation established in phase N, then re-present the checkpoint with IC results
3. `Adjust scope (add/remove/reorder subtasks)` — collect changes via follow-up `AskUserQuestion`, update delivery plan, re-present
4. `Replan from this phase boundary` — rewind to `stage: "planning"` (close the open execution `stage_history` entry with `exit_reason: "p2-replan"`, append a fresh planning entry, increment `stage_reopen_count`), re-run Delivery PM, re-present P1 with the revised plan, then re-enter execution per the auto-diff procedure in `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/references/stage-discipline.md`
5. `Pause and review artifacts` — halt orchestration; user reviews manually and resumes via `/ai-agents-workflow:continue`
6. `Abort task` — mark task as aborted

**Skip condition:** If the delivery plan has only one phase (no explicit phase boundaries), skip P2.

## P4 — Task Completion Review

**When:** All subtasks are closed, `blocked_gates` and `pending_user_actions` are empty, and the orchestrator is about to set `phase: complete`.

**Artifact-chain validation.** Before presenting the summary, confirm each subtask's artifact chain is complete. Read `orchestration-history.json` once and for each `completed_subtasks[]` entry inspect its `sections[]` list. Compute the expected section set from the subtask's path:

- Standard subtask → `["spec", "tep", "implementation", "review"]`
- Ultra-light subtask (direct-executor, no TEP) → `["spec", "implementation", "review"]`
- Add `"plan-addendum"` when the trigger decision recorded `design_agent: required`.
- Add `"integration-check"` when the trigger decision recorded `integration_checker: required`.

If every `completed_subtasks[]` entry satisfies its expected set, the artifact chain is validated — proceed to the approval question without re-reading subtask files. This map-based validation replaces the prior pattern of re-opening every subtask's `ai-work.md` at P4 (which cost ~200–400 KB of reads on large tasks).

**History consistency check.** Cross-check `orchestration-history.json` against `orchestration-state.json` before reading the map:

- `history.completed_subtasks.length` MUST equal `state.last_completed_seq` (see `orchestrator-state` skill → "History consistency contract").
- Every entry in `history.completed_subtasks[]` MUST have a non-empty `sections` array.
- The set of `subtask_id` values in `history.completed_subtasks[]` MUST be disjoint from `state.pending_subtasks[]`.

If ANY of those checks fail, do NOT silently fall back to per-subtask grep. The history file is the authoritative completion record; an inconsistency means the orchestrator skipped a `subtask_complete` write or wrote a partial entry — either way, P4 cannot honestly say the task is complete. Emit a `blocker-escalation-report` with `blocker_type: state-history-inconsistency` naming the missing/malformed entries and present a **recovery prompt** to the user via `AskUserQuestion`:

- `Repair history from ai-work.md` — re-derive the missing `sections` arrays by re-grepping the surviving subtask `ai-work.md` files, write them back to history, then re-run the consistency check
- `Reopen the unfinished subtask <id>` — treat the inconsistency as evidence the subtask never actually closed; re-enter the execution loop
- `Abort task` — leave the task in an inconsistent state for manual cleanup

Legacy pre-F5 history (no `last_completed_seq` in state, no `sections` arrays in history) is the one allowed silent path: fall back to per-subtask grep `grep -oE '<!-- section:[a-z0-9-]+ -->' <ai-work.md>` for each subtask AND emit a `legacy-history` telemetry line in `summary.md` so retrospective captures the migration debt. New tasks (state with `schema_version >= 2`) MUST satisfy the consistency contract — there is no silent fallback for them.

**Action:** Present the full task summary (subtask outcomes table, open items, blockers carried forward, deferred items) and ask via `AskUserQuestion`:

- `Approve completion` — write `phase: "complete"` and close the closure `stage_history` entry with `exit_reason: "p4-approved"`. (`workflow_state` is a per-subtask-summary field with its own enum — do not write it on task-level state to mean "task done"; `phase: "complete"` is the canonical signal.)
- `Reopen subtask <id>` — collect the subtask ID and reason, create a reversal packet (via `reversal-packet` skill), follow the State Rewrite Recipe in `${CLAUDE_PLUGIN_ROOT}/skills/reversal-packet/SKILL.md` → "State Rewrite Recipe", re-enter the execution loop.
- `Add follow-up task` — collect a brief description; note it in the task summary's `## Notes` section for future intake. Then re-present this gate.
- `Abort task` — task did not produce acceptable outcomes and the user does not want to keep iterating. Close the closure `stage_history` entry with `exit_reason: "completed-without-p4"` and set `phase: "blocked"` with a populated `pending_user_actions` entry naming the abort reason. This preserves the artifact chain while making it clear the task did not reach approval. (Hard abort with `phase: "complete"` is intentionally NOT offered — `phase: complete` is reserved for approved work.)

## P5 — Post-Task Retrospective

**When:** After `phase: complete` is set and the task summary is finalized.

- **Always run** for tasks with ≥3 subtasks or any subtask that hit a rework cycle.
- **Skip** for tasks with ≤2 subtasks where all subtasks were approved on the first review cycle (no rework).

**Action:** Invoke the `post-task-review` skill to generate a `## Retrospective` section (rework heat-map, artifact completeness audit, dispatch bundle coverage, telemetry gaps). Then ask via `AskUserQuestion`:

- `Any feedback on this task execution?` — collect free-form notes; save actionable items as a new entry in the task summary's `## Notes`
- `No feedback` — close the session

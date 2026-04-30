---
name: orchestrator-user-gates
description: User interaction gates P1 (delivery-plan approval), P2 (phase boundary checkpoint), P4 (task completion review), and P5 (post-task retrospective). Use when reaching each checkpoint to pause for user input via AskUserQuestion.
---

# Orchestrator User Gates — P1 / P2 / P4 / P5

The orchestrator MUST pause for user input at these checkpoints. Use `AskUserQuestion` with the specified options.

## P1 — Delivery Plan Approval

**When:** After Delivery PM appends `<!-- section:delivery-plan -->` to `task-data.md`, before dispatching any subtask agent.

**Hard constraint:** No subtask agent may be dispatched before P1 approval. Applies to **plan-only**, **execution-simple**, AND **execution-full** — there is no shortcut path that skips P1. The blocking PreToolUse hook `hooks/guard-pre-dispatch-p1.js` enforces this at runtime: any `Task` dispatch with `subagent_type ∈ {lead, executor, reviewer, design-agent, integration-checker}` is refused unless the active task's `orchestration-state.json` has `gates.p1_approved: true`. Treat hook denial as an orchestration defect, not an obstacle to work around.

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

**Block 4 — Approval menu** (`AskUserQuestion`, options below).

### Options depend on classification

- For `plan-only`:
  - `Approve plan and stop` — sets `phase: planned`, `gates.p1_approved: true`, records `gates.p1_approved_at` and `gates.p1_approved_signature` in `orchestration-state.json`, then exits; resumable via `/continue`. Leave `gates.p1_revise_count` untouched (it is a lifetime counter, not a consecutive one).
  - `Approve plan and execute` — overrides classification to `execution-simple` or `execution-full` (ask which if ambiguous), sets `gates.p1_approved: true`, records timestamp + signature, continues to Step 5.
  - `Revise plan` — collect free-form notes via a follow-up `AskUserQuestion`, reset `gates.p1_approved: false` (clear timestamp + signature), increment `gates.p1_revise_count` by 1, route notes back to Delivery PM, re-present.
  - `Abort task` — mark task as aborted.

- For `execution-simple` / `execution-full`:
  - `Approve plan` — set `gates.p1_approved: true`, record `gates.p1_approved_at: <ISO-8601 UTC>` and `gates.p1_approved_signature: <sha256 of normalized Block 1 + Block 2 + Block 3 bytes>`, then proceed to execution. Leave `gates.p1_revise_count` untouched.
  - `Revise plan` — collect notes via a follow-up `AskUserQuestion`, reset `gates.p1_approved: false` (clear timestamp + signature), increment `gates.p1_revise_count` by 1, route notes back to Delivery PM, re-present. Loop until approved.
  - `Abort task` — mark task as aborted.

### Signature semantics

Compute `gates.p1_approved_signature` as the sha256 hex digest of the concatenated bytes the user just saw and approved: Block 1 line + Block 2 markdown table + Block 3 file list, normalized (trim trailing whitespace per line, single `\n` line separators, no trailing blank line). Persist alongside `gates.p1_approved_at`. Before any subtask dispatch, the orchestrator recomputes the signature against the current delivery plan; mismatch means the plan was revised after approval and the gate must be re-presented (reset `gates.p1_approved: false` and loop).

### Loop cap (5 iterations)

Mirror the cap in `project-config-review`, but persist the counter in state so it survives `/continue` resumes. The orchestrator reads `gates.p1_revise_count` from `orchestration-state.json` before presenting Block 4; if the value is `>= 5`, replace the standard menu with a continue-or-abort prompt:

- `Continue iterating` — re-present the standard Approve / Revise / Abort menu (each subsequent `Revise plan` continues to increment the counter; the prompt repeats every 5 cycles).
- `Abort task` — mark task as aborted.

`gates.p1_revise_count` is incremented on every `Revise plan` and never reset by `Approve plan` (the cap bounds total churn, not just consecutive cycles). Defaults to `0` for new tasks; legacy v1 tasks upgrade to `0` per `orchestrator-state` → "Migration".

## P2 — Phase Boundary Checkpoint

**When:** All subtasks of phase N are closed in `orchestration-state.json` AND phase N+1 has pending subtasks.

**Action:** Present a phase summary (subtask outcomes, rework count, open issues) and ask via `AskUserQuestion` menu:

1. `Continue to Phase <N+1>` — proceed normally
2. `Run contract verification before continuing` — dispatch Integration Checker in "contract-only" mode against the foundation established in phase N, then re-present the checkpoint with IC results
3. `Adjust scope (add/remove/reorder subtasks)` — collect changes via follow-up `AskUserQuestion`, update delivery plan, re-present
4. `Pause and review artifacts` — halt orchestration; user reviews manually and resumes via `/ai-agents-workflow:continue`
5. `Abort task` — mark task as aborted

**Skip condition:** If the delivery plan has only one phase (no explicit phase boundaries), skip P2.

## P4 — Task Completion Review

**When:** All subtasks are closed, `blocked_gates` and `pending_user_actions` are empty, and the orchestrator is about to set `workflow_state: complete`.

**Artifact-chain validation.** Before presenting the summary, confirm each subtask's artifact chain is complete. Read `orchestration-history.json` once and for each `completed_subtasks[]` entry inspect its `sections[]` list. Compute the expected section set from the subtask's path:

- Standard subtask → `["spec", "tep", "implementation", "review"]`
- Ultra-light subtask (direct-executor, no TEP) → `["spec", "implementation", "review"]`
- Add `"plan-addendum"` when the trigger decision recorded `design_agent: required`.
- Add `"integration-check"` when the trigger decision recorded `integration_checker: required`.

If every `completed_subtasks[]` entry satisfies its expected set, the artifact chain is validated — proceed to the approval question without re-reading subtask files. This map-based validation replaces the prior pattern of re-opening every subtask's `ai-work.md` at P4 (which cost ~200–400 KB of reads on large tasks).

**Fallback.** If the map is incomplete — missing `sections` arrays (legacy pre-F5 history), missing entries for listed subtasks, or a subtask's actual `ai-work.md` contradicts the map — fall back to per-subtask grep: `grep -oE '<!-- section:[a-z0-9-]+ -->' <ai-work.md>` for each subtask. Record the fallback as a `cache_miss: artifact-chain-<subtask_id>` telemetry line in the task-level `summary.md` so retrospective captures repeated misses.

**Action:** Present the full task summary (subtask outcomes table, open items, blockers carried forward, deferred items) and ask via `AskUserQuestion`:

- `Approve completion` — set `workflow_state: complete`
- `Reopen subtask <id>` — collect the subtask ID and reason, create a reversal packet (via `reversal-packet` skill), re-enter the execution loop
- `Add follow-up task` — collect a brief description; note it in the task summary's `## Notes` section for future intake

## P5 — Post-Task Retrospective

**When:** After `workflow_state: complete` is set and the task summary is finalized.

- **Always run** for tasks with ≥3 subtasks or any subtask that hit a rework cycle.
- **Skip** for tasks with ≤2 subtasks where all subtasks were approved on the first review cycle (no rework).

**Action:** Invoke the `post-task-review` skill to generate a `## Retrospective` section (rework heat-map, artifact completeness audit, dispatch bundle coverage, telemetry gaps). Then ask via `AskUserQuestion`:

- `Any feedback on this task execution?` — collect free-form notes; save actionable items as a new entry in the task summary's `## Notes`
- `No feedback` — close the session

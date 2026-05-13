---
name: reversal-packet
description: Produce a structured Reversal Packet when a previously-approved subtask must be reopened (bug surfaced later, regression, incorrect approval). Use when the normal review loop has already closed and work is approved, but the outcome needs to be revisited.
stage: shared
---

# Reversal Packet

Use this skill to reopen an already-approved subtask in a controlled way. A Reversal Packet is the single valid entry point for re-work against closed subtasks — never "reopen" ad-hoc.

## When to Use

- A bug or regression is discovered against an approved subtask after its Review Report closed.
- An architectural decision from an approved subtask must be revised due to later learnings.
- An approved subtask was closed on incorrect acceptance signals and needs re-scoping.

Do **not** use when:

- The original review cycle is still active — use Blocker Escalation Report instead.
- The work is new — create a new Task Packet.

## Output Format

Write to `<artifact-root>/tasks/<task_id>/reversal-<subtask_id>-<NN>.md`:

```markdown
# Reversal Packet

<!-- section:reversal-metadata -->
## Metadata
- **task_id**: <original Task Packet id>
- **original_subtask_id**: <id from the closed Delivery Plan subtask>
- **original_review_report**: <path to the approved Review Report being reversed>
- **reopened_by**: <agent or user>
- **timestamp**: <ISO 8601 UTC>
<!-- /section:reversal-metadata -->

<!-- section:reversal-reason -->
## Reason
<!-- One paragraph: what surfaced, when, and why the approved outcome is no longer acceptable. Include observable evidence (error, regression, metric). -->
<!-- /section:reversal-reason -->

<!-- section:reversal-scope -->
## Scope of Reversal
- **files_affected**: <list or "unknown — needs Lead triage">
- **contracts_affected**: <list or "none">
- **downstream_subtasks_at_risk**: <list of subtask ids or "none">
<!-- /section:reversal-scope -->

<!-- section:reversal-proposed-action -->
## Proposed Action
<!-- Select one: -->
- [ ] re-open original subtask with focused rework (new TEP, fresh cycle_count=0)
- [ ] create follow-up subtask in the same Delivery Plan
- [ ] escalate to Delivery PM for scope / approach revision
<!-- /section:reversal-proposed-action -->

<!-- section:reversal-context-manifest -->
## Context Manifest
*(no files read; all context received via prompt)*
Totals: governance 0 | artifact 0 | source 0 | schema 0 | docs 0
<!-- /section:reversal-context-manifest -->

<!-- section:reversal-telemetry -->
## Telemetry
<turns_used>/<turns_budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>
<!-- /section:reversal-telemetry -->
```

## Rules

- A Reversal Packet is a terminal artifact for its cycle; the Chief Orchestrator then routes to the Lead (focused rework) or Delivery PM (scope revision).
- Never silently edit an approved artifact in-place to "correct" it. The Reversal Packet is the audit trail.
- After a Reversal Packet closes, the resulting work produces its own TEP + Implementation Report + Review Report chain — do not reuse the reversed artifacts.
- Include `## Context Manifest` and `## Telemetry` like any terminal artifact; the orchestrator's Artifact Gate still applies.

## State Rewrite Recipe (closure → execution)

Writing the Reversal Packet alone does NOT change `orchestration-state.json`. The Chief Orchestrator MUST follow this recipe immediately AFTER the Reversal Packet is written, in a single state-file write so the closure→execution transition is atomic:

1. **Rewrite the terminal closure `stage_history` entry.** Reversal is only legal from `phase: "complete"` + `stage: "closure"`, which means the terminal closure entry is already CLOSED (C5 required `exit_reason ∈ {p4-approved, completed-without-p4}` for the prior phase=complete write). Change that entry's `exit_reason` to `"reversal"` and refresh its `exited_at` to the current ISO-8601 UTC timestamp (or keep the original — either passes the validator, but refreshing better reflects when the reversal actually happened).
2. **Append a fresh `execution` `stage_history` entry** in the SAME write. `stage: "execution"`, `entered_at` set to the same timestamp as the closure entry's refreshed `exited_at`, `exited_at: null`, `exit_reason: null`. After this two-edit write the validator sees: a properly-closed closure entry with `exit_reason: "reversal"` (no longer the LAST entry, so C5's `VALID_CLOSURE_EXIT_REASONS` constraint doesn't apply) followed by a fresh open execution entry, which matches the `closure:execution` row in `validate-orchestration-state-write.js → VALID_STAGE_TRANSITIONS`.
3. **Set `stage: "execution"`, `previous_stage: "closure"`.**
4. **Increment `stage_reopen_count`.** This is a reopen and counts toward the soft cap (≥3 triggers the cap popup — see `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/references/stage-discipline.md` → "Reopen accounting").
5. **Reset `phase` from `"complete"` to `"execution"`.** Closure invariants (C1–C5) only fire on `phase: complete` writes, so reverting phase is what unlocks the reopened subtask work. **Delete the `workflow_state` field** (or set it to a value other than `"complete"`/`"done"`/`"blocked"` — the validator only constrains the terminal trio; `"in-progress"` is documented for per-subtask `summary.md` only, not for task-level state). The two MUST agree (C4): `workflow_state: "complete"` while `phase: "execution"` is rejected.
6. **Repopulate `pending_subtasks[]` with the reopened subtask IDs** named in `<!-- section:reversal-scope -->` → `downstream_subtasks_at_risk`. The originally-targeted `original_subtask_id` from `<!-- section:reversal-metadata -->` is included unless the proposed action elected a follow-up subtask instead. Do **NOT** use `pending_subtasks_needing_rereview[]` — that list is reserved for the `needs-replan` / `p2-replan` auto-diff procedure (`stage-discipline.md` → "Auto-diff for affected subtasks"); reversal uses the regular `pending_subtasks[]` because the reopened work is treated as fresh execution, not as a re-review of already-approved work.
7. **Set `current_subtask: null`.** It will be re-set when the first agent for the reopened subtask is dispatched.
8. **Keep `pending_subtasks_needing_rereview: []`.** This array is now a closure invariant (`validate-orchestration-state-write.js` C2 at schema_version ≥ 3) — leaving stale entries here would block the next phase=complete write at the end of the reversal cycle. Reversal never populates it; only `delivery-pm` re-dispatch on `needs-replan` does.
9. **Leave `last_completed_seq` untouched.** The historical completion count is preserved — the `orchestration-history.json` entries for the reversed subtask(s) gain `superseded: true` (additive field per the auto-diff procedure) but are NOT removed.

After this write, Phase 3.5 of `pre-task-guard.js` will let `lead` / `executor` / `reviewer` dispatches through because `stage === "execution"`. Skipping any of the above steps will either (a) be rejected by `validate-orchestration-state-write.js` (e.g., non-empty pending arrays still present on a phase-still-complete write), or (b) silently leave the task in an inconsistent state where Phase 3.5 blocks every subsequent gated dispatch.

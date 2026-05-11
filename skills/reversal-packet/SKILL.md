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

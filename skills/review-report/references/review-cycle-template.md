# Review cycle template

Append a `### Cycle <N>` block inside `<!-- section:review -->` in the subtask's `ai-work.md` using this template:

```markdown
### Cycle <N>

<!-- section:review-metadata -->
#### Metadata
- **task_id**: <from implementation section>
- **subtask_id**: <from implementation section>
- **reviewer**: reviewer
- **cycle_count**: <N>
- **cycle_kind**: rework | continuation  <!-- "continuation" iff this cycle is reviewing a PARTIAL Executor return (context-budget split, not rework). Continuation cycles are excluded from the rework cap by the orchestrator. Default: rework. -->
- **created_at**: <ISO 8601 UTC>
<!-- /section:review-metadata -->

<!-- section:review-verdict -->
#### Verdict
approved | changes_requested | needs-replan
<!-- /section:review-verdict -->

<!-- section:review-findings -->
#### Findings

Confidence-filtered — only findings with `confidence >= 75` appear here. Lower-confidence observations go under `section:review-low-confidence` and do NOT trigger rework.

Finding IDs are stable across cycles for the same subtask — see "Stable Finding IDs" under Rules. On Cycle N > 1, every finding that also appeared in Cycle N-1 keeps the **same ID** and gains a `status` field; genuinely new findings get the next unused ID.

##### <F-001> — <short title>
- **severity**: high | medium | low
- **confidence**: <integer 0–100; must be ≥ 75 for this section>
- **root_cause_category**: spec-gap | impl-bug | test-gap | review-noise
- **status**: new | persisted | regressed  <!-- only required on Cycle N > 1; omit or set "new" on Cycle 1 -->
- **affected_subtask**: <subtask_id>
- **location**: `<file>:<line>` or `<module>`
- **description**: <specific observation — quote code or field names>
- **rework_direction**: <exact action required to resolve>

<!-- repeat for each finding -->
<!-- /section:review-findings -->

<!-- section:review-resolved -->
#### Resolved in this cycle (Cycle N > 1 only)
Optional — present only on Cycle N > 1 when the prior cycle had findings the Executor has now resolved. One line per resolved ID, referencing the Cycle where it first appeared. This is an audit trail so the Executor's rework bundle in the next cycle (if one occurs) knows which IDs are already closed and not to be re-sent.

- **F-001** — resolved (first raised Cycle 1)
- **F-003** — resolved (first raised Cycle 1)
<!-- /section:review-resolved -->

<!-- section:review-low-confidence -->
#### Low-Confidence Observations (not rework-eligible)
Optional — include only when real observations with `confidence < 75` exist. These are recorded for audit and for pattern detection across subtasks; they do NOT route to Executor and do NOT count toward the rework cap.

##### <OBSERVATION-001> — <short title>
- **severity**: high | medium | low
- **confidence**: <integer 0–74>
- **location**: `<file>:<line>` or `<module>`
- **description**: <specific observation>
- **why_uncertain**: <one line: what additional evidence would promote this to a rework-eligible finding>
<!-- /section:review-low-confidence -->

<!-- section:review-summary -->
#### Summary
<1–3 sentences: overall quality assessment>
<!-- /section:review-summary -->

<!-- section:review-completion-summary -->
#### Completion Summary
<only when verdict = approved: 1–3 sentences the orchestrator can copy into `summary.md`; otherwise write "n/a">
<!-- /section:review-completion-summary -->
```

After appending the cycle block, write the diagnostics footer (role: `reviewer`) per `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-telemetry/references/artifact-footer-protocol.md`. Then replace any placeholder or skeleton text in `## Status`, `## Acceptance Signals`, `## Notes`, and `## Open Gates` rather than leaving stale draft content above the final result (these finalization fields are Reviewer-owned and NOT part of the shared footer protocol).

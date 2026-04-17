---
name: review-report
description: Generate a structured Review Report with severity-tagged findings. Use after code and architecture review.
---

# Review Report Skill

Produce this report after reviewing an Implementation Report (and Integration Check Report if available). Be specific — vague findings do not unblock rework.

## Output Target

> **SECTION NAME IS MANDATORY**: Write review content inside `<!-- section:review -->` / `<!-- /section:review -->`.
> Do NOT use `section:review-report`, `section:review-cycle*`, or any other variant.
> Close ALL sections with `<!-- /section:X -->` — never `<!-- end:X -->`.

**Two outputs in the same turn (both mandatory):**

1. **First action**: Write the `<subtask_id>/summary.md` skeleton (verdict TBD) — this file must exist before appending to `ai-work.md`.
2. **Append** `### Cycle N` block to `<!-- section:review -->` in the subtask's `ai-work.md`. Also append one `### reviewer` subsection to `<!-- section:context-manifest -->` and one line to `<!-- section:telemetry -->`.
3. **Last action**: Finalize `summary.md` with actual verdict, files, telemetry aggregate, and notes.

**Ultra-light path:** Append the compact `review-ultra` block inside `<!-- section:review -->` in `ai-work.md`. Still write `summary.md`.

## Output Template

### 1. summary.md

Write to `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/summary.md`:

```markdown
# Subtask Summary — <subtask_id>

## Verdict
approved | approved-with-notes | needs-replan

## Cycles
<N> review cycles

## Files Changed
[list from impl-files-changed in section:implementation]

## Telemetry
[aggregated from section:telemetry lines in ai-work.md for this subtask]

## Notes
[completion_summary text — 1–3 sentences describing what was delivered]
```

### 2. Append inside `<!-- section:review -->`

```markdown
### Cycle <N>

<!-- section:review-metadata -->
#### Metadata
- **task_id**: <from implementation section>
- **subtask_id**: <from implementation section>
- **reviewer**: reviewer
- **cycle_count**: <N>
- **created_at**: <ISO 8601 UTC>
<!-- /section:review-metadata -->

<!-- section:review-verdict -->
#### Verdict
approved | changes_requested
<!-- /section:review-verdict -->

<!-- section:review-findings -->
#### Findings

##### <FINDING-001> — <short title>
- **severity**: high | medium | low
- **root_cause_category**: spec-gap | impl-bug | test-gap | review-noise
- **affected_subtask**: <subtask_id>
- **location**: `<file>:<line>` or `<module>`
- **description**: <specific observation — quote code or field names>
- **rework_direction**: <exact action required to resolve>

<!-- repeat for each finding -->
<!-- /section:review-findings -->

<!-- section:review-summary -->
#### Summary
<1–3 sentences: overall quality assessment>
<!-- /section:review-summary -->

<!-- section:review-completion-summary -->
#### Completion Summary
<only when verdict = approved: 1–3 sentences the orchestrator can copy into `summary.md`; otherwise write "n/a">
<!-- /section:review-completion-summary -->
```

Then append to `<!-- section:context-manifest -->`:

```markdown
### reviewer
| path | bucket | bytes |
| ---- | ------ | ----- |
| ... | ... | ... |
Totals: governance 0 | artifact 0 | source 0 | schema 0 | docs 0
```

Then append to `<!-- section:telemetry -->`:

```
reviewer | <turns_used>/<turns_budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>
```

## Rules
- `verdict` must be `approved` only when zero high/medium findings remain.
- `cycle_count` must be read from the previous `### Cycle N` subsection — do not reset or invent it.
- `rework_direction` must be specific enough that the executor can act without asking follow-up questions.
- Every finding must carry a `root_cause_category`.
- If `cycle_count` reaches the complexity-tied cap and findings remain, use `blocker-escalation-report` instead.
- Do not write findings for issues outside the approved subtask scope.
- When `verdict = approved`, `completion_summary` must be filled; write it into both `section:review-completion-summary` and `summary.md`.
- `summary.md` is MANDATORY — write it even for ultra-light subtasks.

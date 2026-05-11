# PR Lessons Consultation Protocol

Canonical, non-negotiable rules for invoking `pr-lessons-check` during execution and review. Both Executor and Reviewer link here so the requirement does not drift between the two skills.

## Who consults, when

| Actor | Skill | Trigger | Deadline |
| --- | --- | --- | --- |
| Executor | `implementation-report` | After producing the subtask diff | BEFORE writing the `<!-- /section:implementation -->` close tag |
| Reviewer | `review-report` | After reading the diff under review | BEFORE writing the cycle's `verdict` line |

Skipping the consultation is a protocol violation — Reviewer flags missing Executor consultations as a finding with `root_cause_category: process` and `confidence: 90`.

## What to invoke

`pr-lessons-check` skill against the subtask diff (not the whole branch).

## What to record

### Executor side

In `<!-- section:impl-dynamic-skills -->`, write exactly one of:

- `pr-lessons-check — consulted; <N> matches`
- `pr-lessons-check — consulted; no matches`

If matches surface:
- Address them in code, OR
- Document under `<!-- section:impl-unresolved-issues -->` with explicit rationale for deferral.

### Reviewer side

In the reviewer's context-manifest subsection inside `summary.md`, record the consultation.

For each match:
- **High / medium confidence** → MUST become a finding in `<!-- section:review-findings -->` with `root_cause_category: pr-lesson` and the lesson reference quoted in `description`.
- **Lower confidence** → record in `<!-- section:review-low-confidence -->` for audit only.

Also verify the Executor's `impl-dynamic-skills` line is present. Missing record → finding (`root_cause_category: process`, `confidence: 90`).

## Output line format (visible audit signal)

When invoked, `pr-lessons-check` MUST emit a one-line summary even when the lessons file is empty or no matches surface, e.g.:

```
PR Lessons: 12 loaded, 0 matches
```

The `0 matches` / `0 loaded` cases are not silent — observers need confirmation the check actually ran.

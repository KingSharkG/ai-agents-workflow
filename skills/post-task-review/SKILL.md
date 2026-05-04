---
name: post-task-review
description: Produce a structured Retrospective Report after task completion — rework heat-map, artifact-completeness audit, dispatch-bundle coverage, telemetry gaps, and user feedback prompt. Use after `phase: complete` is set.
---

# Post-Task Review Skill

Produce a structured Retrospective Report after a task reaches `phase: complete`. The retrospective is appended as a `## Retrospective` section to the existing task-level `<artifact-root>/tasks/<task_id>/summary.md`. It synthesizes rework patterns, artifact completeness, dispatch-bundle coverage, telemetry gaps, and actionable recommendations.

## When to Use

- After the chief-orchestrator sets `phase: complete` on a task
- When the user requests a post-task retrospective or analysis
- Optionally: automatically triggered as a final step before closing the orchestration session

## Input

- `<artifact-root>/tasks/<task_id>/orchestration-state.json` — subtask ledger
- `<artifact-root>/tasks/<task_id>/summary.md` — task-level telemetry
- Each `<subtask_id>/summary.md` — per-subtask telemetry, context manifest, and `<!-- section:dispatch-bundles -->` audit lines (one per dispatch — bundles themselves are inline in the Task prompt and not persisted)

## Output

Append a `## Retrospective` section to the task-level `summary.md` (do not create a separate file). The section contains:

### Rework Heat-Map

A table showing which subtasks required rework and root causes:

```
| Subtask | Cycles | Root Cause Category | Impact |
| ------- | ------ | ------------------- | ------ |
```

Root cause categories: `contract-gap`, `pre-existing-code`, `cross-subtask-consistency`, `spec-misalignment`, `review-miss`, `other`

### Artifact Completeness Audit

Check each subtask for:

- ai-work.md exists and has all expected sections filled (not placeholder)
- summary.md exists with verdict, telemetry, context manifest, and `<!-- section:dispatch-bundles -->` audit lines

Report: `<subtask_id>: <complete | missing: [list of missing artifacts]>`

### Dispatch Bundle Coverage

- Count of expected dispatches (Lead, Executor, Reviewer per cycle, plus Design Agent / Integration Checker when triggered)
- Count of audit lines found across each `<subtask_id>/summary.md` → `<!-- section:dispatch-bundles -->`
- Coverage percentage
- List of dispatches missing an audit entry (these indicate the orchestrator skipped the `context-minimizer` invocation)

### Telemetry Gaps

- Check each subtask summary.md for telemetry lines
- Report subtasks missing per-agent telemetry
- Report subtasks missing context manifest subsections
- If model attribution is present, summarize token usage by model

### Recommendations

- Top 3 actionable improvements based on the analysis
- Specific to THIS task's patterns, not generic advice

## Rules

- **Do NOT create a separate file** — append to existing task-level `summary.md`.
- **Append-only**: the retrospective section must not modify prior content in `summary.md`.
- **Evidence-based**: every recommendation must cite a specific finding from the audit.
- **Tables over prose**: keep the output concise; prefer tabular format for structured data.
- **Section placement**: the `## Retrospective` heading goes after `## Context Breakdown` (last section before retrospective).

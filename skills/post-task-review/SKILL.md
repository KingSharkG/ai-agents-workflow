---
name: post-task-review
description: Produce a structured Retrospective Report after task completion — rework heat-map, artifact-completeness audit, dispatch-bundle coverage, telemetry gaps, and user feedback prompt. Use after `phase: complete` is set.
stage: closure
---

# Post-Task Review Skill

Produce a structured Retrospective Report after a task reaches `phase: complete`. The retrospective is appended as a `## Retrospective` section to the existing task-level `<artifact-root>/tasks/<task_id>/summary.md`. It synthesizes rework patterns, artifact completeness, dispatch-bundle coverage, telemetry gaps, and actionable recommendations.

## When to Use

- After the chief-orchestrator sets `phase: complete` on a task
- When the user requests a post-task retrospective or analysis
- Optionally: automatically triggered as a final step before closing the orchestration session

## Input

- `<artifact-root>/tasks/<task_id>/orchestration-state.json` — hot state (cursor + gates)
- `<artifact-root>/tasks/<task_id>/orchestration-history.json` — `completed_subtasks[]` (with `cycles`, `verdict`, `sections`) and `trigger_decisions{}`. **Required** for the Rework Heat-Map and Dispatch Bundle Coverage sections — those facts live in history, not hot state. Tolerate a missing history file the same way `resume-orchestrator` does (legacy pre-split tasks); when absent, derive completion counts from per-subtask `summary.md` files and emit a `legacy-history` note in the Recommendations section.
- `<artifact-root>/tasks/<task_id>/summary.md` — task-level telemetry
- Each `<subtask_id>/summary.md` — per-subtask telemetry, context manifest, and `<!-- section:dispatch-bundles -->` audit lines (one per dispatch — bundles themselves are inline in the Task prompt and not persisted)

## Output Target

**Append** a `## Retrospective` section to the task-level `summary.md` at `<artifact-root>/tasks/<task_id>/summary.md` (do not create a separate file). If that `summary.md` does not exist, escalate via `blocker-escalation-report` — the Reviewer was responsible for creating it during execution closure.

The Retrospective section contains:

### Rework Heat-Map

A table showing which subtasks required rework and root causes:

```
| Subtask | Cycles | Root Cause Category | Impact |
| ------- | ------ | ------------------- | ------ |
```

Root cause categories: `contract-gap`, `pre-existing-code`, `cross-subtask-consistency`, `spec-misalignment`, `review-miss`, `other`.

These are the **retrospective-scope** categories (one per subtask rework cycle). They are intentionally narrower than the per-finding `root_cause_category` in `${CLAUDE_PLUGIN_ROOT}/skills/review-report/SKILL.md` (`spec-gap | impl-bug | test-gap | review-noise`). Mapping rubric: aggregate the per-finding categories from each Cycle N review block in the subtask's `ai-work.md` and pick the dominant theme:

| Per-finding (review-report) → | Retrospective (this skill) |
|---|---|
| `spec-gap` dominant across multiple findings | `spec-misalignment` |
| `impl-bug` with no upstream signal | `pre-existing-code` (if the bug existed before) or `contract-gap` (if downstream module exposed missing contract) |
| `test-gap` flagged late | `review-miss` |
| Findings span ≥2 subtasks with shared root | `cross-subtask-consistency` |
| Doesn't fit any of the above | `other` (include a 1-line note explaining) |

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

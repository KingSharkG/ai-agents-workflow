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

1. **First action**: The orchestrator creates `<subtask_id>/summary.md` skeleton alongside ai-work.md (with diagnostic section placeholders and earlier agents' telemetry/manifest already appended). Verify it exists before appending to `ai-work.md`.
2. **Append** `### Cycle N` block to `<!-- section:review -->` in the subtask's `ai-work.md`.
3. **Last action**: Finalize `summary.md` with actual verdict, files, your telemetry line, your context manifest subsection, and notes.

**Ultra-light path:** Append the compact `review-ultra` block inside `<!-- section:review -->` in `ai-work.md`. Still finalize `summary.md`.

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

## Dispatch Bundles
| Role | Token Ceiling | Sections Included |
|------|--------------|-------------------|
| lead | 1800 | spec, fe-baseline, project-best-practices, lead-best-practices |
| executor | 1500 | tep, fe-baseline, DoD |
| reviewer | 2400 | implementation, spec, review-checklist, fe-baseline, DoD |

## Telemetry
lead | 3/4 turns | tokens: ~2400/~800 | skills: low | plugins: low | ok
executor | 5/6 turns | tokens: ~1800/~1200 | skills: medium | plugins: low | ok
reviewer | 2/3 turns | tokens: ~1600/~600 | skills: low | plugins: low | ok

## Context Manifest
### lead
| path | bucket | bytes |
| ---- | ------ | ----- |
| roles/lead.md (dispatch bundle) | governance | 1240 |
| ai-work.md (section:spec) | artifact | 890 |

Totals: governance 1240 | artifact 890 | source 0 | schema 0 | docs 0

### executor
| path | bucket | bytes |
| ---- | ------ | ----- |
| roles/executor.md (dispatch bundle) | governance | 1100 |
| ai-work.md (section:tep) | artifact | 2400 |
| src/components/Auth.tsx | source | 3200 |

Totals: governance 1100 | artifact 2400 | source 3200 | schema 0 | docs 0

### reviewer
| path | bucket | bytes |
| ---- | ------ | ----- |
| roles/reviewer.md (dispatch bundle) | governance | 2100 |
| ai-work.md (section:implementation) | artifact | 1500 |

Totals: governance 2100 | artifact 1500 | source 0 | schema 0 | docs 0

## Notes
[completion_summary text — 1–3 sentences describing what was delivered]
```

The orchestrator creates this skeleton (with empty placeholders for Dispatch Bundles, Telemetry, Context Manifest) alongside the ai-work.md skeleton. Each agent appends its telemetry line and context manifest subsection. The orchestrator populates the Dispatch Bundles table after each agent dispatch. The Reviewer finalizes with Verdict, Cycles, Files Changed, and Notes.

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

Then write diagnostics to `<subtask_id>/summary.md`:

- Append your telemetry line under `## Telemetry`
- Append your `### reviewer` context manifest subsection under `## Context Manifest`

## Rules
- `verdict` must be `approved` only when zero high/medium findings remain.
- `cycle_count` must be read from the previous `### Cycle N` subsection — do not reset or invent it.
- `rework_direction` must be specific enough that the executor can act without asking follow-up questions.
- Every finding must carry a `root_cause_category`.
- If `cycle_count` reaches the complexity-tied cap and findings remain, use `blocker-escalation-report` instead.
- Do not write findings for issues outside the approved subtask scope.
- When `verdict = approved`, `completion_summary` must be filled; write it into both `section:review-completion-summary` and `summary.md`.
- `summary.md` is MANDATORY — write it even for ultra-light subtasks.

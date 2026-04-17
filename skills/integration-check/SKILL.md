---
name: integration-check
description: Compare FE and BE contract surfaces for likely incompatibilities. Use for changed request/response contracts, auth expectations, field names, or nullability.
---

# Integration Check Skill

Run a narrow compatibility pass and emit an **Integration Check Report** artifact.

## Check

- endpoint paths and methods
- request and response field names
- response envelope shape
- nullability assumptions
- auth header expectations
- status codes and error shape handling

## Output Template

```markdown
# Integration Check Report

<!-- section:integration-metadata -->
## Metadata
- **task_id**: <from FE/BE Implementation Reports>
- **subtask_id**: <subtask id, phase label, or "cross-subtask">
- **checker**: integration-checker
- **created_at**: <ISO 8601 UTC>
<!-- /section:integration-metadata -->

<!-- section:integration-fe-surface -->
## FE Surface
- **fe_artifact**: <path to FE implementation report or FE contract source> <!-- optional audit traceability -->
- **fe_scope**: <short summary of the FE expectations being compared>
<!-- /section:integration-fe-surface -->

<!-- section:integration-be-surface -->
## BE Surface
- **be_artifact**: <path to BE implementation report or BE contract source> <!-- optional audit traceability -->
- **be_scope**: <short summary of the BE behavior being compared>
<!-- /section:integration-be-surface -->

<!-- section:integration-verdict -->
## Verdict
compatible | mismatches_found
<!-- /section:integration-verdict -->

<!-- section:integration-findings -->
## Findings

### <IC-001> — <short title>
- **severity**: high | medium | low
- **surface**: endpoint | payload | field | nullability | auth | status-code | error-shape
- **location**: `<fe file>` / `<be file>` / `<contract>`
- **description**: <specific mismatch or alignment note>
- **recommended_fix**: <narrowest safe fix>

<!-- repeat as needed, or write "none" -->
<!-- /section:integration-findings -->

<!-- section:integration-recommended-fixes -->
## Recommended Fixes
- <fix or "none">
<!-- /section:integration-recommended-fixes -->

<!-- section:integration-context-manifest -->
## Context Manifest
*(no files read; all context received via prompt)*
Totals: governance 0 | artifact 0 | source 0 | schema 0 | docs 0
<!-- /section:integration-context-manifest -->

<!-- section:integration-telemetry -->
## Telemetry
<turns_used>/<turns_budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>
<!-- /section:integration-telemetry -->
```

## Rules

- Keep the pass narrow: compare only the changed contract surfaces relevant to the current cycle.
- `fe_artifact` and `be_artifact` are optional audit traceability. The workflow-driving sections are FE Surface, BE Surface, Verdict, Findings, and Recommended Fixes.
- If no mismatches are found, set `Verdict` to `compatible`, write `none` under `Findings`, and keep `Recommended Fixes` as `none`.
- If one or more mismatches are found, set `Verdict` to `mismatches_found` and make each `recommended_fix` narrow and executable.
- Do not redesign architecture or reopen scope beyond the compared FE/BE surfaces.
- Always include `## Context Manifest` with a totals line immediately before `## Telemetry`.

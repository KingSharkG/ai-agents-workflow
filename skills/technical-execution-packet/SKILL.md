---
name: technical-execution-packet
description: Build a precise Technical Execution Packet for FE or BE implementation. Use when a subtask is ready for technical shaping.
---

# Technical Execution Packet Skill

Convert a Delivery Plan subtask into a precise TEP. The TEP is the executor's **single source of context** — an executor receiving only this section plus governance excerpts should be able to complete the work without reading arbitrary repo files.

## Definition of Ready
A TEP is dispatchable only when all are true:
- `target_files` verified to exist
- `context_bundle` populated (executor needs no other files)
- `complexity` and `turns_budget` copied from the Delivery Plan
- `acceptance_signals` present and observable

## Output Target

**Append** to `<!-- section:tep -->` in the subtask's `ai-work.md`. The section placeholder MUST already exist — if absent, raise a Blocker Escalation Report. Also write diagnostics (telemetry line + context manifest subsection) to `<subtask_id>/summary.md`.

## Output Template

Append inside `<!-- section:tep -->`:

```markdown
<!-- section:tep-metadata -->
## Metadata
- **task_id**: <from Delivery Plan>
- **subtask_id**: <from Delivery Plan>
- **source_phase**: <phase label from Delivery Plan, e.g. A or C> <!-- optional audit traceability -->
- **source_delivery_section**: <e.g. delivery-subtask-a-004>
- **domain**: frontend | backend
- **complexity**: low | medium | hard  <!-- carried forward, do not re-derive -->
- **turns_budget**: <carried from Delivery Plan>
- **created_at**: <ISO 8601 UTC>
<!-- /section:tep-metadata -->

<!-- section:tep-goal -->
## Technical Goal
<one sentence — what must be true after this subtask is complete>
<!-- /section:tep-goal -->

<!-- section:tep-target-files -->
## Target Files
- `<path>` — <reason it is in scope> <!-- each path MUST be verified to exist -->
<!-- /section:tep-target-files -->

<!-- section:tep-non-goals -->
## Non-Goals (Out of Scope)
- <what this subtask must NOT touch — mirrors Delivery Plan out_of_scope>
<!-- /section:tep-non-goals -->

<!-- section:tep-expected-contract -->
## Expected Contract
<API endpoint, data shape, or module interface that this subtask must produce or consume>
<!-- /section:tep-expected-contract -->

<!-- section:tep-context-bundle -->
## Context Bundle
<!-- produced via context-minimizer skill. Paste the verbatim excerpts the executor
     needs: function signatures, type defs, relevant API contract, schema lines.
     This replaces "go read these files." -->
```ts
// frontend/src/features/auth/api.ts
export type LoginResponse = { accessToken: string; refreshToken: string };
```
<!-- /section:tep-context-bundle -->

<!-- section:tep-implementation-steps -->
## Implementation Steps
1. <step>
2. <step>
<!-- /section:tep-implementation-steps -->

<!-- section:tep-risks -->
## Risks & Edge Cases
- <risk or "none">
<!-- /section:tep-risks -->

<!-- section:tep-acceptance-signals -->
## Acceptance Signals
- <observable outcome — carried from Delivery Plan>
<!-- /section:tep-acceptance-signals -->

<!-- section:tep-recommended-tests -->
## Recommended Commands / Tests
```bash
yarn test --filter <module>
```
<!-- /section:tep-recommended-tests -->

<!-- section:tep-recommended-skills -->
## Recommended Skills
- <skill name> — <why>
<!-- /section:tep-recommended-skills -->
```

Then write diagnostics to `<subtask_id>/summary.md`:

- Append your telemetry line under `## Telemetry`
- Append your `### lead` context manifest subsection under `## Context Manifest`

## Length Budget

Target line counts per complexity tier (TEP section only):

- **low**: ≤ 150 lines
- **medium**: ≤ 250 lines
- **hard**: ≤ 350 lines

## Rules
- All `target_files` paths must be verified to exist before writing the TEP — use filesystem tools.
- `complexity` and `turns_budget` are copied from the Delivery Plan, never re-derived.
- `source_delivery_section` is the exact `delivery-subtask-*` tag from `task-data.md`.
- `context_bundle` must contain the exact signatures/types/contracts the executor needs; if the executor would still need to open a non-target file, add it here.
- **No duplication across sections.** Each fact appears exactly once.
- `implementation_steps` must be concrete enough that an executor can follow them without further clarification.
- If a required file path cannot be confirmed, raise a blocker via `blocker-escalation-report`.

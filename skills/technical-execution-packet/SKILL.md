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
- **complexity**: low | medium | hard
- **turns_budget**: <carried from Delivery Plan>
- **shared_artifacts**: true | false  <!-- see Rules below; when unsure, set true -->

- **created_at**: <ISO 8601 UTC>
<!-- /section:tep-metadata -->

<!-- section:tep-goal -->
## Technical Goal
<one sentence — what must be true after this subtask is complete>
<!-- /section:tep-goal -->

<!-- section:tep-target-files -->
## Target Files
- `<path>` — <reason it is in scope>
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
<!-- Verbatim excerpts the executor needs (signatures, types, contracts) — replaces "go read these files." -->
```ts
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

<!-- section:tep-clarifying-questions -->
## Clarifying Questions (optional — appears only when Lead identifies ambiguity)
Each question MUST be specific, actionable, and unresolvable from the Delivery Plan alone. Omit the section entirely when there are no questions — do NOT emit placeholder text.

1. **<question>** — why it matters: <one line>; impact if unanswered: <one line>.
2. **<question>** — why it matters: <one line>; impact if unanswered: <one line>.
<!-- /section:tep-clarifying-questions -->
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

- All `target_files` paths must be verified to exist before writing the TEP. If a path can't be confirmed, raise a blocker via `blocker-escalation-report`.
- `complexity`, `turns_budget`, and `source_delivery_section` are copied from the Delivery Plan — never re-derived.
- `shared_artifacts: true` when the subtask introduces or modifies any of: shared constants / config keys (storage keys, flags, env vars), shared types / interfaces, dependency manifest entries (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, `pyproject.toml`), or any contract surface consumed by sibling subtasks. `false` only when scope is demonstrably self-contained (e.g., private helpers inside one file). When uncertain, set `true` — the reviewer's consistency check is cheap relative to missing a real break.
- `context_bundle` must carry every signature / type / contract the executor needs; if the executor would still need to open a non-target file, add it here. **No duplication across sections** — each fact appears once.
- `implementation_steps` must be concrete enough for the executor to follow without further clarification.
- When `<!-- section:exploration-notes -->` exists for this subtask, every `target_files` entry MUST be among `exploration-key-files`.
- Emit `<!-- section:tep-clarifying-questions -->` ONLY for real ambiguity. The orchestrator treats a non-empty block as a hold — Executor dispatch pauses until the user answers. Do NOT use it for design discussion, wishlists, or deferring Lead decisions. Rationale belongs in `tep-risks` or the step itself.

## Related

- Reviewer role contract → "Skip clause (ultra-light subtasks)" — consumes `shared_artifacts`.
- `context-minimizer` → "Ultra-light subtask bundle adjustment" — omits the cross-subtask scan from the reviewer bundle when skip-eligible.
- `codebase-exploration`, `multi-approach-architecture` — pre-TEP skills whose output often determines `shared_artifacts`.

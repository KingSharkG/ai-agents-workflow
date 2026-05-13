# ARTIFACT_DISCIPLINE

<!-- section:produce-artifact-first -->

## Produce-Artifact-First Rule

Every agent whose output is a structured artifact MUST work in this order, without exception:

1. **First action**: `Write` the artifact skeleton at the target path with all required sections as placeholders. Empty tables and `TBD` values are acceptable; the file must exist before any other work begins.
2. **Then** iterate: read inputs, map the codebase or plan, make decisions, and `Edit` the skeleton in place as findings land. The artifact grows from skeleton to final deliverable progressively.
3. **Last action before returning**: write diagnostics (telemetry line + context manifest) to `<subtask_id>/summary.md` (the orchestrator creates the summary.md skeleton alongside ai-work.md).

**Target paths under the new task structure:**

| Agent | Artifact | Target path |
|-------|----------|-------------|
| Chief Orchestrator (task intake) | task-data.md (task-packet section) | `<artifact-root>/tasks/<task_id>/task-data.md` — create |
| Delivery PM | task-data.md (delivery-plan section) | `<artifact-root>/tasks/<task_id>/task-data.md` — append |
| Chief Orchestrator (skeleton) | ai-work.md skeleton | `<artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` — create |
| Design Agent | plan-addendum section | `ai-work.md` → append to `<!-- section:plan-addendum -->` |
| Lead | tep section | `ai-work.md` → append to `<!-- section:tep -->` |
| Executor | implementation section | `ai-work.md` → append to `<!-- section:implementation -->` |
| Reviewer | review section + summary | `ai-work.md` → append to `<!-- section:review -->` AND write `<subtask_id>/summary.md` |
| Integration Checker | integration-check section | `ai-work.md` (FE subtask, or changed side) → append to `<!-- section:integration-check -->` |
| Escalating agent | escalation section | `ai-work.md` → append to `<!-- section:escalation-N -->` (N assigned by orchestrator) |

**Degraded-inline guard:** When `orchestration-state.json` says `mode: degraded-inline`, the Chief Orchestrator MAY write intake artifacts, blocker records, and structured pending-gate / user-action records only. It MUST NOT fabricate role-owned sections, dispatch bundles, or approval artifacts as if Lead / Executor / Reviewer / Integration Checker had run.

**Append rule:** For agents appending to `ai-work.md`, the target section placeholder MUST already exist in the file. If the placeholder is absent, the agent MUST raise a Blocker Escalation rather than creating a new file. A partially-filled section is strictly better than no section.

Returning without writing to the target path is a **protocol violation**, even if reasoning is complete. If you are about to return mid-investigation, `Edit` your current findings into the skeleton *first*, then return.

<!-- /section:produce-artifact-first -->

<!-- section:ultra-light-tier -->

## Ultra-Light Tier

Applies when a subtask meets **all** of the following:

- `complexity: low`
- diff is confined to a single file
- no new endpoint, schema change, auth change, or migration
- no Lead / Design Agent trigger fired

### Implementation → compact block in ai-work.md

Instead of a full implementation section, the executor appends a compact block inside `<!-- section:implementation -->` in `ai-work.md`:

```
<!-- impl-ultra: <subtask_id> -->
- changed: <path/to/file.ts>
- tests: <test file or "none">
- result: <pass | skip>
<!-- /impl-ultra -->
```

### Review → compact verdict in ai-work.md

Instead of a full review section, the Reviewer appends a compact verdict inside `<!-- section:review -->` in `ai-work.md`:

```
<!-- review-ultra: <subtask_id> -->
- verdict: approved | changes_requested
- cycle: <N>
- note: <one-line rationale if changes_requested, or "ok" if approved>
<!-- /review-ultra -->
```

The Reviewer still writes `<subtask_id>/summary.md` — even for ultra-light subtasks.

**Note:** `task-data.md` delivery-plan section is **never mutated** after creation. Ultra-light blocks go into `ai-work.md`, not into `task-data.md`.

### Discovery index

For tasks with ≥3 ultra-light subtasks, the Orchestrator MUST append an `<!-- ultra-light-index -->` block to the `<!-- section:delivery-plan -->` in `task-data.md` (after the last subtask section) listing all ultra-light subtask IDs and their final verdict:

```
<!-- ultra-light-index -->
| subtask_id | verdict  | cycle |
| ---------- | -------- | ----- |
| ul-001     | approved | 1     |
| ul-002     | approved | 1     |
| ul-003     | approved | 1     |
<!-- /ultra-light-index -->
```

### Ultra-light eligibility timing

The orchestrator evaluates ultra-light eligibility at **skeleton creation time** (Step 6 of the default flow), not during Delivery PM planning. The Delivery PM may flag `complexity: low` but does not determine ultra-light status — that requires the orchestrator to also verify no Lead/Design Agent trigger fired and no endpoint/schema/auth change is involved. The ultra-light index (for ≥3 ultra-light subtasks) is appended to the delivery-plan section after all subtasks are complete, during the P4 gate. This is an explicit rollup-append exception to the "planning artifacts immutable after P1" rule: the orchestrator is recording aggregate outcomes, not mutating the plan itself. No other agent may append to `<!-- section:delivery-plan -->` post-P1.

### Constraints

- Ultra-light does **not** apply if the single-file diff touches auth, migrations, contract types, or shared utilities with multiple callers.
- Rework cap remains 1 cycle (consistent with `complexity: low` — see `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:rework-cap -->`).
- The orchestrator records the ultra-light outcome in `<artifact-root>/tasks/<task_id>/summary.md` as a `ul:` prefix row rather than a full agent row.
- Telemetry lines are still required — the executor and reviewer each write their telemetry to `<subtask_id>/summary.md`.

<!-- /section:ultra-light-tier -->

<!-- section:ai-work-skeleton -->

## ai-work.md Skeleton Templates

The Chief Orchestrator MUST write the `ai-work.md` skeleton before dispatching any agent for a subtask. The skeleton is written at `<artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md`. The `<!-- section:spec -->` is populated by copying the exact content of `<!-- section:delivery-subtask-<id> -->` from `task-data.md`.

### Standard skeleton (Lead path — Lead triggered)

```markdown
# AI Work — <subtask_id>

<!-- section:spec -->
[COPIED: exact content of delivery-subtask-<id> section from task-data.md]
<!-- /section:spec -->

<!-- section:plan-addendum -->
<!-- placeholder: populated by design-agent if triggered -->
<!-- /section:plan-addendum -->

<!-- section:exploration-notes -->
<!-- placeholder: populated by lead via codebase-exploration skill (optional on complexity: low; mandatory on medium/hard unless reusing a sibling subtask's exploration) -->
<!-- /section:exploration-notes -->

<!-- section:architecture-options -->
<!-- placeholder: populated by lead via multi-approach-architecture skill when complexity is medium/hard AND the approach is non-trivial -->
<!-- /section:architecture-options -->

<!-- section:tep -->
<!-- placeholder: populated by lead -->
<!-- /section:tep -->

<!-- section:implementation -->
<!-- placeholder: populated by executor -->
<!-- /section:implementation -->

<!-- section:review -->
<!-- placeholder: populated by reviewer (### Cycle N subsection per cycle) -->
<!-- /section:review -->

<!-- section:integration-check -->
<!-- placeholder: populated by integration-checker if triggered (integration-* markers) -->
<!-- /section:integration-check -->
```

Diagnostic data (telemetry, context manifest) is written to `<subtask_id>/summary.md`, NOT to `ai-work.md`. The orchestrator creates the summary.md skeleton alongside ai-work.md.

### Ultra-light skeleton (complexity: low, no Lead trigger)

```markdown
# AI Work — <subtask_id> [ultra-light]

<!-- section:spec -->
[COPIED: exact content of delivery-subtask-<id> section from task-data.md]
<!-- /section:spec -->

<!-- section:implementation -->
<!-- placeholder: populated by executor in compact impl-ultra format -->
<!-- /section:implementation -->

<!-- section:review -->
<!-- placeholder: populated by reviewer (compact review-ultra format) -->
<!-- /section:review -->
```

Diagnostic data (telemetry, context manifest) is written to `<subtask_id>/summary.md`, NOT to `ai-work.md`.

### Escalation section (appended by orchestrator on demand)

When a blocker is raised within a subtask, the orchestrator appends the following before the escalating agent's turn. `N` increments per escalation event.

```markdown
<!-- section:escalation-N -->
<!-- placeholder: populated by escalating agent -->
<!-- /section:escalation-N -->
```

### Diagnostic data location

Telemetry and context manifest data are written to `<subtask_id>/summary.md` (NOT to `ai-work.md`). The orchestrator creates the summary.md skeleton alongside the ai-work.md skeleton. Each agent appends its diagnostics to summary.md. See the `review-report` skill for the canonical summary.md template.

`ai-work.md` MUST NOT contain `<!-- section:telemetry -->` or `<!-- section:context-manifest -->`. These diagnostics belong exclusively in `summary.md`; validation hooks reject them when written into `ai-work.md`.

<!-- /section:ai-work-skeleton -->

<!-- section:summary-skeleton -->

## summary.md Skeleton Template

The Chief Orchestrator MUST create `<subtask_id>/summary.md` alongside `ai-work.md` before any agent runs. The skeleton is later finalized by the Reviewer.

```markdown
# Subtask Summary — <subtask_id>

## Status
- **workflow_state**: in-progress | approved | blocked-on-user | pending-integration-check | needs-replan
- **review_verdict**: pending | approved | changes_requested | needs-replan
- **cycle_count**: 0
- **updated_at**: <ISO 8601 UTC>

## Acceptance Signals
| Signal | State | Evidence | Notes |
| ------ | ----- | -------- | ----- |
| <signal text> | pending | pending | tbd |

## Files Changed
- none yet

## Dispatch Bundles
<!-- section:dispatch-bundles -->
<!-- One line per dispatch (orchestrator appends after each successful dispatch):
- <role> for <subtask_id> (cycle <n>): <token_count> tokens; sections: <list>; cache_misses: <list-or-none>
-->
<!-- /section:dispatch-bundles -->

## Telemetry
<!-- one line per agent -->

## Context Manifest
<!-- one ### <role> subsection per agent -->

## Notes
placeholder

## Open Gates
- none
```

Rules:

- `workflow_state` is the subtask lifecycle state. It remains `blocked-on-user` or `pending-integration-check` until those gates are closed, even if `review_verdict: approved`.
- `Acceptance Signals` must record both `State` (`pass | fail | deferred | blocked | pending`) and `Evidence` (`executed | inspected | deferred | blocked | pending`).
- Placeholder text must be replaced on finalization; do not leave "skeleton" or "reviewer fills this later" text in the final file.

<!-- /section:summary-skeleton -->

<!-- section:summary-minimum-schema -->

## Minimum Summary Content (Reviewer Finalization Checklist)

When the Reviewer finalizes `<subtask_id>/summary.md`, ALL of the following fields MUST be present and non-placeholder. A summary missing any of these is rejected by the orchestrator's artifact gate.

| Field | Section | Required Content |
|-------|---------|-----------------|
| `workflow_state` | `## Status` | One of: `approved`, `blocked-on-user`, `pending-integration-check`, `needs-replan` |
| `review_verdict` | `## Status` | One of: `approved`, `changes_requested`, `needs-replan` |
| `cycle_count` | `## Status` | Integer ≥ 1 |
| `updated_at` | `## Status` | ISO 8601 UTC timestamp |
| Acceptance signals table | `## Acceptance Signals` | All rows with `State` and `Evidence` filled (not `pending`) |
| Files changed list | `## Files Changed` | At least one entry, or `- none (audit-only subtask)` with rationale |
| Dispatch bundle audit | `## Dispatch Bundles` → `<!-- section:dispatch-bundles -->` | One audit line per agent dispatch in format: `- <role> for <subtask_id> (cycle <n>): <token_count> tokens; sections: <list>; cache_misses: <list-or-none>` |
| Telemetry lines | `## Telemetry` | One line per agent in format: `<role> \| <model> \| <turns>/<budget> turns \| tokens: ~<in>/~<out> \| skills: <bucket> \| plugins: <bucket> \| <status>` |
| Context manifest | `## Context Manifest` | One `### <role>` subsection per agent with bucket totals |
| Findings taxonomy | `## Notes` | Summary of findings by severity: `H:<n> M:<n> L:<n> N:<n> I:<n>` (may be `H:0 M:0 L:0 N:0 I:0` for clean passes) |
| Next steps | `## Notes` | One-liner describing what this subtask unblocks, or `- none (terminal subtask)` |

The `validate-artifact-chain` hook BLOCKS subtask `summary.md` writes whose `review_verdict=approved` lacks a populated `## Telemetry` line, a non-empty `## Dispatch Bundles` body, or a `## Context Manifest` with at least one `### ` subsection. (The previously non-blocking `validate-summary-telemetry` hook was retired; its checks live here, now blocking.) The orchestrator's artifact gate (chief-orchestrator step 13) enforces the full schema on top of the hook.

<!-- /section:summary-minimum-schema -->

<!-- section:verdict-taxonomy -->

## Verdict Taxonomy

Verdicts are used in three contexts with distinct allowed values. Agents and hooks MUST use these exact values — no synonyms, no casing variants.

### Review Verdict (`review_verdict` in summary.md)

| Value | Meaning |
|-------|---------|
| `pending` | Review has not started (skeleton default) |
| `approved` | Implementation meets acceptance criteria; no unresolved high/medium findings |
| `changes_requested` | Rework required; findings listed in `review-findings` |
| `needs-replan` | Rework cap exhausted with unresolved high/medium findings; subtask returns to Delivery PM via a soft `execution → planning` stage reopen (see `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/references/stage-discipline.md`). Delivery PM re-scopes; the chief-orchestrator re-fires P1 if the resulting plan signature differs from `gates.p1_signature_at_stage_entry`. |

### Integration Verdict (`verdict` in `<!-- section:integration-check -->`)

| Value | Meaning |
|-------|---------|
| `ok` | FE/BE contract surfaces are compatible; no mismatches found |
| `not-ok` | Mismatches found; `fix_owner` (fe / be / both) identifies who must fix |

### Orchestration Verdict (`completed_subtasks[].verdict` in orchestration-history.json)

| Value | Meaning |
|-------|---------|
| `approved` | Reviewer approved; subtask is done |
| `needs-replan` | Subtask could not be completed within rework cap; Delivery PM must re-scope |

### Workflow State (`workflow_state` in summary.md)

| Value | Meaning |
|-------|---------|
| `in-progress` | Subtask is actively being worked on |
| `approved` | Subtask completed and approved |
| `blocked-on-user` | Waiting for external user action |
| `pending-integration-check` | IC gate required but IC has not returned `verdict: ok` yet |
| `needs-replan` | Rework cap exhausted; awaiting Delivery PM re-scope |

<!-- /section:verdict-taxonomy -->

<!-- section:escalation-routing -->

## Escalation Routing Table

When an agent raises a Blocker Escalation Report, the `route_to` field directs the orchestrator where to send it. All agents use the same routing options:

| route_to | Meaning | When to use |
|----------|---------|-------------|
| `lead` | Route back to Lead for re-validation or approach revision | TEP-defined logic is infeasible, design conflict discovered, target files missing |
| `delivery-pm` | Route to Delivery PM for re-scoping | Rework cap exhausted, requirements ambiguous, subtask needs decomposition |
| `user` | Surface to user for decision | Missing credentials, external dependency unavailable, policy question |

The orchestrator reads `route_to` and dispatches accordingly. If `route_to: user`, the orchestrator presents the blocker via `AskUserQuestion` and pauses until resolved.

<!-- /section:escalation-routing -->

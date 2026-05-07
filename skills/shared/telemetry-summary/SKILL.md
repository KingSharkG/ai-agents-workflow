---
name: telemetry-summary
description: Assemble and update `<artifact-root>/tasks/<task_id>/summary.md` — the rolled-up per-task tracker for turns, tokens, context-bucket totals, and delivered changes. Use after each subtask closes (append Detail row, refresh Context Breakdown and Totals) and at task completion (populate Changes by Phase, set workflow_state). Consumes the per-agent telemetry and Context Manifest formats defined by orchestrator-telemetry.
stage: shared
---

# Telemetry Summary Skill

Maintain `<artifact-root>/tasks/<task_id>/summary.md` as the single source of truth for agent resource consumption and delivered changes across a task's lifecycle. The chief-orchestrator invokes this skill after each subtask completes and at task-level completion.

## When to Use

- After each subtask is approved (Reviewer has written `<subtask_id>/summary.md`)
- At task-level completion to finalize totals and write the Changes by Phase section
- When the orchestrator needs a snapshot of resource consumption mid-task

## Collection Protocol

After each subtask completes, read these sections from `<subtask_id>/summary.md`:

1. `## Telemetry` — one line per agent, format `<role> | <model> | <turns>/<budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>`.
2. `## Context Manifest` → `### <role>` subsections — per-agent bucket totals.
3. `## Status` and `## Open Gates` — closed / blocked-on-user / pending-integration.
4. `## Notes` — completion one-liner for Changes by Phase.
5. `## Dispatch Bundles` — bundle audit data.

Then append rows to Detail, update Context Breakdown, and recalculate Totals. At task completion, populate Changes by Phase and set `workflow_state: complete` (status-driven, not file-presence-driven).

## Output Template

```markdown
# Task Summary — <task_id>

## Metadata

- **task_id**: <TP-NNN>
- **created_at**: <ISO 8601 UTC — when first subtask started>
- **updated_at**: <ISO 8601 UTC — last update>

## Task Status

- **workflow_state**: active | blocked-on-user | pending-integration-check | complete
- **open_gate_count**: <N>
- **pending_user_action_count**: <N>

## Changes by Phase

### Phase A

- <subtask_id>: <one-liner from subtask summary.md Notes field>
- <subtask_id>: <one-liner>

<!-- repeat per phase -->

## Open Gates

- none

## Pending User Actions

- none

## Pipeline

<agent_1> <turns>t ~<tokens>tok → <agent_2> <turns>t ~<tokens>tok → ...

## Detail

| #   | Agent  | Model   | Subtask           | Turns           | Tokens (in/out) | Skills | Plugins | Status |
| --- | ------ | ------- | ----------------- | --------------- | --------------- | ------ | ------- | ------ | ------- | ---------- |
| 1   | <role> | <model> | <subtask_id or —> | <used>/<budget> | ~<in>/~<out>    | <low>  | <low>   | <ok    | warning | escalated> |

## Totals

- **Total turns**: <sum used>/<sum budget>
- **Total tokens**: ~<sum in> in / ~<sum out> out
- **Rework cycles**: <count>
- **By model**:
  - <model-id-1>: ~<in> in / ~<out> out (<N> invocations)
  - <model-id-2>: ~<in> in / ~<out> out (<N> invocations)

## Context Breakdown

| Agent  | Governance | Artifact | Source  | Schema  | Docs    | Total |
| ------ | ---------- | -------- | ------- | ------- | ------- | ----- |
| <role> | <bytes>    | <bytes>  | <bytes> | <bytes> | <bytes> | <sum> |

- **Task totals**: governance <sum> | artifact <sum> | source <sum> | schema <sum> | docs <sum>
- **Repeat reads**: <path> read by <N> agents | none

## Dispatch Bundles

<!-- section:dispatch-bundles -->
<!-- Task-level audit. Delivery-pm bundle (task-level dispatch) is recorded here directly.
     Subtask-level bundles (lead/executor/reviewer/design-agent/integration-checker) live in each
     <subtask_id>/summary.md → <!-- section:dispatch-bundles -->; this skill aggregates a one-line

     summary per subtask after closure rather than copying every audit line.
     Format per line:
       - <role> for <id> (cycle <n>): <token_count> tokens; sections: <list>; cache_misses: <list-or-none>

-->

<!-- /section:dispatch-bundles -->
```

## Rules

- **File location**: `<artifact-root>/tasks/<task_id>/summary.md`. Only the chief-orchestrator writes it.
- **Append-only** for Detail and Context Breakdown — one row per agent invocation (rework cycles are separate rows). Never rewrite or remove rows.
- **Tokens are approximate** (~20% variance ok); trend visibility, not accounting.
- **Status values**: `ok` (within budget) | `warning` (exceeded turns) | `escalated` (blocker) | `ul:approved` (ultra-light).
- **Skills / Plugins columns**: copy cost buckets from the telemetry line verbatim.
- **Rework cycles**: count reviewer→executor loops only, not normal progression.
- **Model attribution**: Detail's Model column records the model per invocation; Totals → By model aggregates tokens per model ID. Missing model field → record as `unknown`.
- **Pipeline one-liner**: shorthand. >5 subtasks → phase-level aggregation; full detail stays in Detail.
- **Changes by Phase** is populated at task completion from each subtask's `## Notes`.
- **Context Breakdown is mandatory** on every update — refresh per-agent buckets, task totals, and Repeat reads from each subtask's `## Context Manifest`.
- **Repeat reads**: any path in ≥2 agents' manifests for this task. Write `none` when empty.
- **Task Status / Pending User Actions are mandatory**: derive Status from subtask workflow_state + open gates; list user actions as flat bullets or `- none` (the count is derived from this list).
- **Completion semantics**: complete only when `workflow_state: complete` AND `open_gate_count: 0` AND `pending_user_action_count: 0`. If any subtask is blocked, the task summary must reflect that blocked state — never overstate completion.

## Non-execution path summaries

For classifications that produce no agent telemetry (`direct-answer`, `plan-only`), the orchestrator still writes a task-level `summary.md` so every task has a rolled-up artifact. These summaries omit Pipeline / Detail / Context Breakdown / Totals (no agent invocations to record) and use the compact schema below.

### `direct-answer` schema

Written immediately after the inline answer, when `<artifact-root>` exists. Skipped silently when no artifact root is initialized — the inline answer is the deliverable.

```markdown
# Task Summary — <task_id>

## Metadata
- **task_id**: <TP-NNN>
- **classification**: direct-answer
- **created_at**: <ISO 8601 UTC>

## Task Status
- **workflow_state**: complete
- **open_gate_count**: 0
- **pending_user_action_count**: 0

## Request
<verbatim user question, ≤2 lines>

## Answer Recap
<3–5 line summary of the inline answer — key points, not the full text>

<!-- section:intake-classification -->
<copied verbatim from task-data.md>
<!-- /section:intake-classification -->
```

### `plan-only` schema

Written after P1 records `phase: planned`. The orchestrator refreshes this summary before exiting so the task has closure even though no execution ran.

```markdown
# Task Summary — <task_id>

## Metadata
- **task_id**: <TP-NNN>
- **classification**: plan-only
- **created_at**: <ISO 8601 UTC>
- **updated_at**: <ISO 8601 UTC>

## Task Status
- **workflow_state**: planned
- **open_gate_count**: 0
- **pending_user_action_count**: <0 or 1 — 1 if user can resume via /continue>

## Request
<verbatim user request, ≤3 lines>

## Plan Reference
- Delivery Plan: `<artifact-root>/tasks/<task_id>/task-data.md` → `<!-- section:delivery-plan -->`
- Phase: planned (no execution dispatched)
- Resume: `/ai-agents-workflow:continue <task_id>` to approve and execute

<!-- section:intake-classification -->
<copied verbatim from task-data.md>
<!-- /section:intake-classification -->
```

These compact schemas are produced by the orchestrator directly, not by aggregating subtask telemetry. They MUST NOT be written for execution paths — those use the full template above. If a `plan-only` task is later resumed and executes, the summary is rewritten using the full template at task completion.

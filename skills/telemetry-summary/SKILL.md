---
name: telemetry-summary
description: Maintain a per-task summary tracking turns, token usage, and delivered changes for each agent in the pipeline. Use after each subtask completes and at task-level completion.
---

# Telemetry Summary Skill

Maintain `ai-workflow-data/tasks/<task_id>/summary.md` as the single source of truth for agent resource consumption and delivered changes across a task's lifecycle. The chief-orchestrator invokes this skill after each subtask completes and at task-level completion.

## When to Use

- After each subtask is approved (Reviewer has written `<subtask_id>/summary.md`)
- At task-level completion to finalize totals and write the Changes by Phase section
- When the orchestrator needs a snapshot of resource consumption mid-task

## Collection Protocol

1. After each subtask completes, read `<!-- section:telemetry -->` lines from the subtask's `ai-work.md` — one line per agent, format: `<role> | <turns>/<budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>`.
2. Read `### <role>` subsections from `<!-- section:context-manifest -->` in `ai-work.md` to get per-agent bucket totals.
3. Read `<subtask_id>/summary.md` for the completion one-liner (used in Changes by Phase).
4. Append rows to the Detail table, update Context Breakdown, and recalculate Totals.
5. At task completion, populate the Changes by Phase section — the existence of the finalized `ai-workflow-data/tasks/<task_id>/summary.md` marks the task complete.

## Output Template

```markdown
# Task Summary — <task_id>

## Metadata

- **task_id**: <TP-NNN>
- **created_at**: <ISO 8601 UTC — when first subtask started>
- **updated_at**: <ISO 8601 UTC — last update>

## Changes by Phase

### Phase A
- <subtask_id>: <one-liner from subtask summary.md Notes field>
- <subtask_id>: <one-liner>

<!-- repeat per phase -->

## Pipeline

<agent_1> <turns>t ~<tokens>tok → <agent_2> <turns>t ~<tokens>tok → ...

## Detail

| #   | Agent  | Subtask           | Turns           | Tokens (in/out) | Skills | Plugins | Status                       |
| --- | ------ | ----------------- | --------------- | --------------- | ------ | ------- | ---------------------------- |
| 1   | <role> | <subtask_id or —> | <used>/<budget> | ~<in>/~<out>    | <low>  | <low>   | <ok | warning | escalated> |

## Totals

- **Total turns**: <sum used>/<sum budget>
- **Total tokens**: ~<sum in> in / ~<sum out> out
- **Rework cycles**: <count>

## Context Breakdown

| Agent  | Governance | Artifact | Source | Schema | Docs | Total |
| ------ | ---------- | -------- | ------ | ------ | ---- | ----- |
| <role> | <bytes>    | <bytes>  | <bytes>| <bytes>| <bytes> | <sum> |

- **Task totals**: governance <sum> | artifact <sum> | source <sum> | schema <sum> | docs <sum>
- **Repeat reads**: <path> read by <N> agents | none
```

## Rules

- **File location**: always `ai-workflow-data/tasks/<task_id>/summary.md` (replaces the old `telemetry_summary.md`).
- **Append-only** for Detail table and Context Breakdown: never rewrite or remove previous rows. Only add new rows and recalculate totals.
- **One row per agent invocation** in Detail: if an executor does rework (cycle 2), that is a separate row.
- **Changes by Phase** is populated at task completion from `<subtask_id>/summary.md` Notes fields.
- **Pipeline one-liner**: use shorthand. For tasks with >5 subtasks, show phase-level aggregation in the one-liner; full detail stays in the table.
- **Tokens are approximate**: accept ~20% variance. The goal is trend visibility, not accounting.
- **Status values**: `ok` (within budget), `warning` (exceeded turns budget), `escalated` (blocker raised), `ul:approved` (ultra-light approved).
- **Skills / Plugins columns**: copy the cost buckets from the telemetry line exactly.
- **Rework cycles**: count only reviewer→executor rework loops, not normal pipeline progression.
- **Creator**: only the chief-orchestrator creates or updates this file.
- **Context Breakdown is mandatory**: every update must refresh per-agent bucket totals, task totals, and Repeat reads from `<!-- section:context-manifest -->` subsections in each subtask's `ai-work.md`.
- **Repeat reads**: list any path appearing in at least 2 agents' manifests for the same task; write `none` when none exist yet.

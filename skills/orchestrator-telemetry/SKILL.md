---
name: orchestrator-telemetry
description: Telemetry line format and Context Manifest rules that every dispatched agent must follow, plus the orchestrator's per-task aggregation procedure. Use when specifying agent output requirements, when auditing dispatch returns, and when rolling subtask manifests into the task-level summary.
---

# Orchestrator Telemetry — Per-Agent Requirements & Aggregation

## Telemetry

Every agent MUST write one telemetry line to the subtask's `<subtask_id>/summary.md` (under the `## Telemetry` section):

```
<role> | <model> | <turns_used>/<turns_budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>
```

- **role** = agent role name (e.g., `lead`, `executor`, `reviewer`).
- **model** = model ID used for this agent invocation (e.g., `claude-sonnet-4-6`, `claude-opus-4-6`). Required for cost attribution by model.
- **turns** = number of agent turns consumed / budgeted turns from Delivery Plan.
- **tokens** = approximate input and output token counts for that agent invocation.
- **skills** = dynamic skill cost bucket: `low | medium | high`.
- **plugins** = MCP/plugin cost bucket: `low | medium | high`.
- **ok / OVER_BUDGET** = whether the agent stayed within its assigned turn budget.

The orchestrator creates the summary.md skeleton (with diagnostic section placeholders) alongside the ai-work.md skeleton. Each agent appends its telemetry line. The Reviewer finalizes summary.md with verdict and notes.

The Chief Orchestrator maintains `<artifact-root>/tasks/<task_id>/summary.md` as the centralized rollup:

1. After each subtask completes, read the `## Telemetry` section from the subtask's `<subtask_id>/summary.md`.
2. Append rows to the Detail table in the task-level `summary.md`.
3. Recalculate the Pipeline one-liner and Totals.
4. Use the `telemetry-summary` skill for the template and rules.

Telemetry is collected forward-only — do not retroactively fill past artifacts.

## Context Manifest

Every agent MUST write a `### <role>` subsection to the `## Context Manifest` section in the subtask's `<subtask_id>/summary.md`. The manifest answers *where* an agent's input tokens came from.

### Format

Each agent appends a named subsection:

```markdown
### <role>
| path                                    | bucket     | bytes |
| --------------------------------------- | ---------- | ----- |
| inline dispatch bundle                  | governance | 1240  |
| ai-work.md (section:spec)               | artifact   | 890   |
| apps/api/src/modules/bookings/svc.ts    | source     | 3244  |

Totals: governance 1240 | artifact 890 | source 3244 | schema 0 | docs 0
```

### Rules

- **One row per file opened**, whether read via `Read`, filesystem MCP, or received inline via prompt excerpt. The inline dispatch bundle (delivered in the Task prompt, not a file) counts as one `governance` row labeled `inline dispatch bundle`.
- **`bytes`** = bytes the agent consumed, not total file size. Approximation is acceptable (lines × 80 is fine).
- **Buckets are exhaustive — pick exactly one per row:**
  - `governance` — dispatch bundle, anything under `ai/`, plus files under `docs/requirements/`
  - `artifact` — task-data.md, ai-work.md sections, summary.md files, prior handoff artifacts
  - `source` — FE or BE application code
  - `schema` — SQL migrations, OpenAPI specs, type contracts, DB schema files
  - `docs` — anything else (READMEs, ADRs, external notes)
- **Totals line** — required per agent subsection. The orchestrator aggregates from these lines.
- **Empty manifest is valid** — write `*(no files read; all context received via dispatch bundle)*` and a totals line of zeros.

### Orchestrator aggregation

After each subtask completes, the Chief Orchestrator extends `<artifact-root>/tasks/<task_id>/summary.md` with a **Context Breakdown** section by reading all `### <role>` subsections from `## Context Manifest` in each subtask's `<subtask_id>/summary.md`:

```
## Context Breakdown

| agent       | governance | artifact | source | schema | docs | total |
| ----------- | ---------- | -------- | ------ | ------ | ---- | ----- |
| delivery-pm | 2000       | 1876     | 0      | 0      | 0    | 3876  |
| lead        | 1800       | 890      | 3244   | 912    | 0    | 6846  |

Task totals: governance 3800 | artifact 2766 | source 3244 | schema 912 | docs 0
Repeat reads: none (dispatch bundles are pre-curated per role)
```

The **Repeat reads** line lists any source path appearing in ≥2 agents' manifests within the same task (governance repeats are expected to be minimal with dispatch bundles).

## Diagnostic loop

Observation is per-task; action waits for aggregate signal.

**Per-task (observation, always on):**

- After each subtask completes, the orchestrator populates a `repeat_reads` line on task-level `summary.md` noting any file read by ≥3 agents within the task.

**After any two completed tasks with manifests (action):**

1. If source files are read by both a Lead and its Executor → the TEP's `context_bundle` is not carrying enough; fix the dispatch bundle content.
2. Otherwise collect one more task before changing anything.

# ORCHESTRATION

<!-- section:default-flow -->

## Default flow

1. Chief Orchestrator receives the task.
2. Create `task-data.md` at `ai-workflow-data/tasks/<task_id>/task-data.md` using the `task-packet` skill. The task-packet content lives inside `<!-- section:task-packet -->`.
3. Delivery PM appends the Delivery Plan section to `task-data.md` using the `delivery-plan` skill. The delivery-plan content lives inside `<!-- section:delivery-plan -->` (with nested `<!-- section:delivery-subtask-* -->` IDs unchanged).
4. Before dispatching any agent for a subtask, the Chief Orchestrator MUST write the `ai-work.md` skeleton at `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` using the template from `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:ai-work-skeleton -->`. The `<!-- section:spec -->` is populated by copying the exact content of the matching `<!-- section:delivery-subtask-<id> -->` from `task-data.md`.
5. Every subtask in the Delivery Plan carries a `domain` tag (assigned by Delivery PM from `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:domains -->`) that rides along with dispatch. For subtasks whose domain is in `design_hook_domains`, trigger Design Agent only if rules require it. When both Design Agent and Lead are triggered for the same subtask, Design Agent MUST run first and Lead MUST receive the addendum as input — they are sequential, not parallel. The Design Review Addendum is appended to `<!-- section:plan-addendum -->` in `ai-work.md`. Lead reads this section when creating the TEP. Domain validation is absorbed by the Lead for the subtask's domain — no separate Domain Agent exists.
6. Lead appends the Technical Execution Packet to `<!-- section:tep -->` in `ai-work.md` (merges former Tech Prep + Lead validation into one step). For `complexity: low` subtasks where no Lead / Design Agent trigger fires, the orchestrator may dispatch the executor directly using `<!-- section:spec -->` from `ai-work.md` as a lightweight TEP. If the subtask additionally qualifies for the ultra-light tier (`complexity: low` + single-file diff + no endpoint/schema/auth change), use the compact inline artifact format — see `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:ultra-light-tier -->`.
7. Executor appends implementation work to `<!-- section:implementation -->` in `ai-work.md`.
8. Run Integration Checker when paired fe+be subtasks belong to the same feature (mandatory in that case — see `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:domains -->` `decomposition_rule`), or when request/response contracts, auth expectations, or field/nullability alignment may have drifted across the domain boundary. The IC report is appended to `<!-- section:integration-check -->` in the fe subtask's `ai-work.md` (or the changed side's `ai-work.md` when only one side changed). If `verdict: NOT ok`, Orchestrator routes fix to `fix_owner` executor(s) from the IC report before proceeding to Review (see `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:integration-trigger -->`).
9. Reviewer appends `### Cycle N` block to `<!-- section:review -->` in `ai-work.md` AND writes `<subtask_id>/summary.md`. If changes requested, return to executor with focused rework only when `cycle_count` < complexity-tied cap (see `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:rework-cap -->`). Otherwise auto-downgrade the subtask to `needs-replan` and escalate to Delivery PM via `blocker-escalation-report`. **If any finding is severity `High` and touches logic defined in the TEP** (not a style fix, not a standalone utility), the Executor's rework MUST route back through the Lead for re-validation before the Reviewer receives the next cycle. Findings of severity `Medium` or `Low` only → Executor goes directly back to Reviewer.
10. Orchestrator reads `<subtask_id>/summary.md` (written by Reviewer). After all subtasks complete, Orchestrator writes the task-level `ai-workflow-data/tasks/<task_id>/summary.md` using the `telemetry-summary` skill — the existence of this file marks the task complete. Active tasks are those whose folder under `ai-workflow-data/tasks/<task_id>/` does not yet have a task-level `summary.md`.

<!-- /section:default-flow -->

<!-- section:agent-load-order -->

## Agent Load Order

Lead and Executor are stack-agnostic. Stack knowledge arrives at runtime from `ai-workflow-data/config/PROJECT_CONFIG.md` keyed by the subtask's `domain` tag. Every Lead/Executor invocation follows this six-step sequence before doing work:

1. Harness reads the stub (`.claude/agents/<role>.md`) — spins up with tools, model, permissionMode.
2. Agent reads its canonical contract (`${CLAUDE_PLUGIN_ROOT}/ai/agents/<role>.md`) — base skills, base plugins, base best practices, skill invocation rituals, forbidden actions.
3. Agent reads `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:project-best-practices -->` — universal project conventions.
4. Agent reads `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:<domain> -->` — domain-specific skills, plugins, baseline anchors, validation rules, forbidden actions.
5. Agent reads `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:agent-best-practices -->` — the role's project-specific overlay.
6. Agent performs the work and appends its artifact section to `ai-work.md`.

Menu guard rail: the agent's allowed skills for the subtask are `base_skills ∪ PROJECT_CONFIG.<domain>.skills`; allowed plugins are `base_plugins ∪ PROJECT_CONFIG.<domain>.plugins`. Anything outside this union is forbidden.

Adding a new domain to a project = one new `<!-- section:<domain> -->` block (plus a matching `<!-- section:<domain>-baseline -->`) in `ai-workflow-data/config/PROJECT_CONFIG.md` plus an entry in `declared_domains`. Zero changes to canonical contracts or harness stubs.

The `init` agent (canonical contract: `${CLAUDE_PLUGIN_ROOT}/ai/agents/init.md`; stub: `${CLAUDE_PLUGIN_ROOT}/agents/init.md`) generates `ai-workflow-data/config/PROJECT_CONFIG.md` by analyzing the consumer project, mapping evidence to the plugin's catalog, asking scoped multiple-choice questions, and running a review-and-comment gate before writing. It owns only `ai-workflow-data/config/PROJECT_CONFIG.md` and ensures `ai-workflow-data/tasks/.gitkeep` exists — never role contracts, stubs, constitution, or this playbook. Modes: `init` | `update` | `add` | `remove`.

<!-- /section:agent-load-order -->

<!-- section:escalation -->

## Escalation

- unresolved blockers
- invalid artifact chain
- review failure after complexity-tied cycle cap
- missing context blocking safe execution

<!-- /section:escalation -->

<!-- section:token-saving -->

## Token-saving

- only send the relevant section from `ai-work.md`, not the full file
- only send relevant excerpts from governance files
- only send target files/modules, not the whole repo
- for `task-data.md`, send only the matching `delivery-subtask-*` section by default (section IDs unchanged, nested inside `section:delivery-plan`)
- for executor rework, send only the last `### Cycle N` subsection from `<!-- section:review -->` in `ai-work.md`, not the full section
- for orchestrator closure, read only the last cycle's `review-verdict` and `review-completion-summary` from `<!-- section:review -->`; or read `<subtask_id>/summary.md` directly
- for Lead intake on subtasks with a design addendum, send only the `design-*` body sections from `<!-- section:plan-addendum -->` in `ai-work.md`
- for Integration Checker, prefer `impl-files-changed`, `impl-tests-run`, and direct contract excerpts from `<!-- section:implementation -->` in `ai-work.md`
- `delivery-routing`, `delivery-context-manifest`, and `delivery-telemetry` are orchestrator-facing sections in `task-data.md` and usually should not be forwarded to Leads or Executors
- follow the single-fact-per-artifact rule from `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:project-best-practices -->` — reference earlier sections by name instead of repeating content

<!-- /section:token-saving -->

<!-- section:telemetry -->

## Telemetry

Every agent appending to `ai-work.md` MUST also append one telemetry line to `<!-- section:telemetry -->` in that same file:

```
<role> | <turns_used>/<turns_budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>
```

- **turns** = number of agent turns consumed / budgeted turns from Delivery Plan.
- **tokens** = approximate input and output token counts for that agent invocation.
- **skills** = dynamic skill cost bucket: `low | medium | high`.
- **plugins** = MCP/plugin cost bucket: `low | medium | high`.
- **ok / OVER_BUDGET** = whether the agent stayed within its assigned turn budget.

The Chief Orchestrator maintains `ai-workflow-data/tasks/<task_id>/summary.md` as the centralized rollup:

1. After each subtask completes, read `<!-- section:telemetry -->` lines from the subtask's `ai-work.md`.
2. Append rows to the Detail table in `summary.md`.
3. Recalculate the Pipeline one-liner and Totals.
4. Use the `telemetry-summary` skill for the template and rules.

Telemetry is collected forward-only — do not retroactively fill past artifacts.

<!-- /section:telemetry -->

<!-- section:context-manifest -->

## Context Manifest

Every agent appending to `ai-work.md` MUST also append a `### <role>` subsection to `<!-- section:context-manifest -->` in the same file. The manifest is the diagnostic instrument for context-cost analysis — it answers *where* an agent's input tokens came from, not just how many.

### Format

Each agent appends a named subsection:

```markdown
### <role>
| path                                    | bucket     | bytes |
| --------------------------------------- | ---------- | ----- |
| ${CLAUDE_PLUGIN_ROOT}/ai/core/PROJECT_CONSTITUTION.md         | governance | 4821  |
| ai-workflow-data/tasks/T-042/task-data.md           | artifact   | 1876  |
| apps/api/src/modules/bookings/svc.ts    | source     | 3244  |

Totals: governance 4821 | artifact 1876 | source 3244 | schema 0 | docs 0
```

### Rules

- **One row per file opened**, whether read via `Read`, filesystem MCP, or received inline via prompt excerpt. Files pasted into the prompt still count — log the path and the bytes actually received.
- **`bytes`** = bytes the agent consumed, not total file size. Approximation is acceptable (lines × 80 is fine); orders of magnitude matter, not precision.
- **Buckets are exhaustive — pick exactly one per row:**
  - `governance` — anything under `ai/`, plus files under `docs/requirements/`
  - `artifact` — task-data.md, ai-work.md sections, summary.md files, prior handoff artifacts
  - `source` — FE or BE application code
  - `schema` — SQL migrations, OpenAPI specs, type contracts, DB schema files
  - `docs` — anything else (READMEs, ADRs, external notes)
- **Totals line** — required per agent subsection. The orchestrator aggregates from these lines.
- **Empty manifest is valid** — write `*(no files read; all context received via prompt)*` and a totals line of zeros.

### Orchestrator aggregation

After each subtask completes, the Chief Orchestrator extends `ai-workflow-data/tasks/<task_id>/summary.md` with a **Context Breakdown** section by reading all `### <role>` subsections from `<!-- section:context-manifest -->` in each subtask's `ai-work.md`:

```
## Context Breakdown

| agent       | governance | artifact | source | schema | docs | total |
| ----------- | ---------- | -------- | ------ | ------ | ---- | ----- |
| delivery-pm | 9924       | 1876     | 0      | 0      | 0    | 11800 |
| lead        | 9924       | 2450     | 3244   | 912    | 0    | 16530 |

Task totals: governance 19848 | artifact 4326 | source 3244 | schema 912 | docs 0
Repeat reads: ${CLAUDE_PLUGIN_ROOT}/ai/core/PROJECT_CONSTITUTION.md read by 2 agents
```

The **Repeat reads** line lists any path appearing in ≥2 agents' manifests within the same task.

### Artifact gate

The Chief Orchestrator rejects any `ai-work.md` that is missing the required sections for the current pipeline stage (see validator rules in `${CLAUDE_PLUGIN_ROOT}/ai/agents/chief-orchestrator.md`). Manifest is collected forward-only — do not retroactively fill past artifacts.

### Diagnostic loop

Observation is per-task; action waits for aggregate signal.

**Per-task (observation, always on):**

- After each subtask completes, the orchestrator populates a `repeat_reads` line on `summary.md` noting any governance file read by ≥3 agents within the task. This is a logged signal, not an action trigger.

**After any two completed tasks with manifests (action):**

1. If a single governance file is read by ≥3 agents in a task → slim it or split it per role.
2. If source files are read by both a Lead and its Executor → the TEP's `context_bundle` is not carrying enough; fix `context-minimizer` usage.
3. Otherwise collect one more task before changing anything.

<!-- /section:context-manifest -->

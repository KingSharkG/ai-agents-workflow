# ORCHESTRATION

<!-- section:default-flow -->

## Default flow

1. Chief Orchestrator receives the task.
2. Create `task-data.md` at `ai-workflow-data/tasks/<task_id>/task-data.md` using the `task-packet` skill. The task-packet content lives inside `<!-- section:task-packet -->`.
3. Delivery PM appends the Delivery Plan section to `task-data.md` using the `delivery-plan` skill. The delivery-plan content lives inside `<!-- section:delivery-plan -->` (with nested `<!-- section:delivery-subtask-* -->` IDs unchanged). After the Delivery PM completes, the orchestrator populates `subtask_offsets` in `orchestration-state.json` with the line range of each `<!-- section:delivery-subtask-<id> -->` block — this enables targeted reads later (see Orchestrator State Management).
4. Before any role-owned step, the Chief Orchestrator MUST determine the workflow mode and persist it to `orchestration-state.json`:
   - `mode: normal` — agent dispatch is available. Dispatch bundles, role separation, and normal gates apply.
   - `mode: degraded-inline` — agent dispatch is unavailable or blocked. The orchestrator MUST record the blocker, request explicit user waiver before continuing, and MUST NOT fabricate Delivery PM / Lead / Executor / Reviewer / Integration Checker execution, dispatch bundles, or approvals. In this mode, only intake artifacts, blocker records, pending gate records, and explicitly user-waived inline work may be written.
5. Before dispatching any agent for a subtask, the Chief Orchestrator MUST write both:
   - The `ai-work.md` skeleton at `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` using the template from `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:ai-work-skeleton -->`. The `<!-- section:spec -->` is populated by copying the exact content of the matching `<!-- section:delivery-subtask-<id> -->` from `task-data.md`.
   - The `summary.md` skeleton at `<subtask_id>/summary.md` with placeholder sections for Status, Acceptance Signals, Files Changed, Dispatch Bundles, Telemetry, Context Manifest, Notes, and Open Gates. Each agent appends its diagnostics here; the Reviewer finalizes it.
6. Every subtask in the Delivery Plan carries a `domain` tag (assigned by Delivery PM from `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:domains -->`) that rides along with dispatch. For subtasks whose domain is in `design_hook_domains`, trigger Design Agent only if rules require it. When both Design Agent and Lead are triggered for the same subtask, Design Agent MUST run first and Lead MUST receive the addendum as input — they are sequential, not parallel. The Design Review Addendum is appended to `<!-- section:plan-addendum -->` in `ai-work.md`. Lead reads this section when creating the TEP. Domain validation is absorbed by the Lead for the subtask's domain — no separate Domain Agent exists.
7. Lead appends the Technical Execution Packet to `<!-- section:tep -->` in `ai-work.md` (merges former Tech Prep + Lead validation into one step). For `complexity: low` subtasks where no Lead / Design Agent trigger fires, the orchestrator may dispatch the executor directly using `<!-- section:spec -->` from `ai-work.md` as a lightweight TEP. If the subtask additionally qualifies for the ultra-light tier (`complexity: low` + single-file diff + no endpoint/schema/auth change), use the compact inline artifact format — see `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:ultra-light-tier -->`.
8. Executor appends implementation work to `<!-- section:implementation -->` in `ai-work.md`.
9. Run Integration Checker when paired fe+be subtasks belong to the same feature (mandatory in that case — see `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:domains -->` `decomposition_rule`), when request/response contracts, auth expectations, or field/nullability alignment may have drifted across the domain boundary, or when the Delivery Plan marks `integration_gate: required`. The IC report is appended to `<!-- section:integration-check -->` in the fe subtask's `ai-work.md` (or the changed side's `ai-work.md` when only one side changed). If `verdict: NOT ok`, Orchestrator routes fix to `fix_owner` executor(s) from the IC report before proceeding to Review (see `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:integration-trigger -->`). If the IC gate is required and the IC has not yet returned `verdict: ok`, the subtask's `workflow_state` remains `pending-integration-check` even if review findings are otherwise closed.
10. Reviewer appends `### Cycle N` block to `<!-- section:review -->` in `ai-work.md` AND finalizes `<subtask_id>/summary.md`. If changes requested, return to executor with focused rework only when `cycle_count` < complexity-tied cap (see `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:rework-cap -->`). Otherwise auto-downgrade the subtask to `needs-replan` and escalate to Delivery PM via `blocker-escalation-report`. **If any finding is severity `High` and touches logic defined in the TEP** (not a style fix, not a standalone utility), the Executor's rework MUST route back through the Lead for re-validation before the Reviewer receives the next cycle. Findings of severity `Medium` or `Low` only → Executor goes directly back to Reviewer. **Rework dispatch bundles use the delta-review protocol** (see `<!-- section:token-saving -->` → Delta-review protocol) — send only delta context, not the full prior package.
11. Orchestrator reads `<subtask_id>/summary.md` (written by Reviewer) and refreshes the task-level `ai-workflow-data/tasks/<task_id>/summary.md` using the `telemetry-summary` skill. Task completion is determined by the task summary's `workflow_state`, not by the file merely existing. A task is `complete` only when the task summary exists, its `workflow_state` is `complete`, and both `open_gates` and `pending_user_actions` are empty.

<!-- /section:default-flow -->

<!-- section:resume-entry -->

## Resume Entry Point

When the Chief Orchestrator receives a prompt beginning with the keyword `resume`, it MUST enter the Resume Entry Point flow instead of the normal default flow.

**Prompt format from resume-orchestrator:**

```
resume task_id=<task_id>
state=<routing-critical JSON>
resume_point=<REPLAN|RESUME_SUBTASK|NEXT_SUBTASK|BLOCKED|DONE>
interrupted_subtask_stage=<stage_code | null>
```

**State reload:** After reading the inline state for routing decisions, re-read `orchestration-state.json` from disk before making any writes. Disk is authoritative for writes.

**Resume entry by code:**

| Code | Chief Orchestrator action |
|---|---|
| `REPLAN` | Skip task-packet (already exists). Read `task-data.md`. Re-dispatch Delivery PM. Continue from Step 3 of default flow. |
| `RESUME_SUBTASK` | Skip to `current_subtask`. Read `trigger_decisions[current_subtask]` from state — do NOT re-evaluate triggers for the resumed subtask. Use `interrupted_subtask_stage` to dispatch the next agent. Continue subtask review loop normally. Validate `ai-work.md` section completeness before trusting `current_subtask` as still-interrupted. |
| `NEXT_SUBTASK` | Skip completed subtasks. Read `pending_subtasks[0]` from state. Use `subtask_offsets` for targeted `task-data.md` read. Begin subtask from Step 5 of default flow. |
| `VERIFY_COMPLETE` | All subtasks dequeued (`current_subtask: null`, `pending_subtasks: []`) but `phase` not yet `complete`. Re-run the task-completion check from Step 11 of default flow: read each subtask summary, confirm all verdicts are `approved`, confirm `blocked_gates` and `pending_user_actions` are empty, then write `phase: complete` to `orchestration-state.json` and finalize the task-level `summary.md`. |
| `BLOCKED` | Read `blocked_gates` and `pending_user_actions` from state. Workflow gates (`blocked_gates`) are treated as user-waived (resume-orchestrator already obtained confirmation). For `pending_user_actions`: these are external real-world actions — do NOT proceed to the next subtask without re-confirming each action is physically complete. Surface the list and ask the user to confirm before dispatching. |
| `DONE` | Read `task_summary_path` from state. Print summary and exit. |

**Context hygiene:** Do not re-run `task-packet` skill, re-dispatch Delivery PM (except `REPLAN`), or re-write skeletons for completed subtasks. Read `completed_subtasks` from state to skip those.

**Normal flow resumes:** Once the resume entry point determines where to re-enter, proceed with all normal flow rules (dispatch bundles, artifact gates, review loops, state updates) from that point forward.

<!-- /section:resume-entry -->

<!-- section:dispatch-bundles -->

## Dispatch Bundle Model

All agents (Lead, Executor, Reviewer, Delivery PM, Design Agent, Integration Checker) receive their context via a **dispatch bundle** — a single markdown file written by the orchestrator before each dispatch. Agents do NOT independently read canonical contracts, PROJECT_CONFIG.md sections, or governance files.

Dispatch bundles are valid only in `mode: normal`. In `mode: degraded-inline`, the orchestrator MUST NOT create `roles/<role>.md` files or record synthetic dispatch outcomes for those roles.

**Bundle path convention:**
- Subtask agents: `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/roles/<role>.md`
- Delivery PM: `ai-workflow-data/tasks/<task_id>/roles/delivery-pm.md`

**Startup sequence (replaces the former six-step load order):**
1. Harness reads the stub (`.claude/agents/<role>.md`) — spins up with tools, model, permissionMode.
2. Agent reads the dispatch bundle at the path provided in the orchestrator's prompt.
3. Agent performs the work and appends its artifact section.

**Bundle contents (assembled by orchestrator via `context-minimizer` skill):**
- Role contract excerpts (mission, skill rituals, forbidden actions) — from `${CLAUDE_PLUGIN_ROOT}/ai/agents/<role>.md`
- Pre-extracted PROJECT_CONFIG.md sections (domain, baselines, role best-practices) — from `ai-workflow-data/config/PROJECT_CONFIG.md`
- Governance excerpts within token ceilings — from governance files
- Artifact input (the specific ai-work.md sections this role needs)

Menu guard rail: the agent's allowed skills for the subtask are `base_skills ∪ domain.skills`; allowed plugins are `base_plugins ∪ domain.plugins`. Both lists are included in the dispatch bundle's Project Context section.

**Retention:** Bundles persist after agent completion. Their key data (role, token ceiling used, sections included) is summarized into `<subtask_id>/summary.md` by the orchestrator. Bundle files may then be deleted.

Adding a new domain to a project = one new `<!-- section:<domain> -->` block (plus a matching `<!-- section:<domain>-baseline -->`) in `ai-workflow-data/config/PROJECT_CONFIG.md` plus an entry in `declared_domains`. Zero changes to canonical contracts or harness stubs.

The `init` agent (canonical contract: `${CLAUDE_PLUGIN_ROOT}/ai/agents/init.md`; stub: `${CLAUDE_PLUGIN_ROOT}/agents/init.md`) generates `ai-workflow-data/config/PROJECT_CONFIG.md` by analyzing the consumer project, mapping evidence to the plugin's catalog, asking scoped multiple-choice questions, and running a review-and-comment gate before writing. It owns only `ai-workflow-data/config/PROJECT_CONFIG.md` and ensures `ai-workflow-data/tasks/.gitkeep` exists — never role contracts, stubs, constitution, or this playbook. Modes: `init` | `update` | `add` | `remove`.

<!-- /section:dispatch-bundles -->

<!-- section:orchestrator-state -->

## Orchestrator State Management

The orchestrator persists its state to `ai-workflow-data/tasks/<task_id>/orchestration-state.json` between subtask dispatches. This prevents unbounded context accumulation across sequential agent dispatches within the orchestrator's maxTurns window.

**After completing each subtask:**
1. Update `orchestration-state.json` with the completed subtask result.
2. Extend task-level `summary.md` with subtask telemetry.
3. Summarize dispatch bundle data into `<subtask_id>/summary.md`.

**Before starting the next subtask:**
1. Read `orchestration-state.json` for current task state.
2. Read the next subtask's spec using targeted reading: use the `subtask_offsets` entry in `orchestration-state.json` to call `Read(task-data.md, offset=start_line, limit=end_line-start_line)`. Do NOT read the full `task-data.md` — it grows with every subtask and can exceed 40 KB.
3. Do NOT rely on in-context memory of prior subtasks' results or reasoning.

**State file schema:**
```json
{
  "task_id": "<task_id>",
  "mode": "normal | degraded-inline",
  "phase": "planning | execution | blocked | complete",
  "completed_subtasks": [
    { "subtask_id": "...", "verdict": "approved", "cycles": 1, "summary_path": "..." }
  ],
  "current_subtask": "<subtask_id> | null",
  "pending_subtasks": ["..."],
  "blocked_gates": ["integration-check:TP-042-E2"],
  "pending_user_actions": ["run yarn install in projects/frontend/mobile"],
  "trigger_decisions": {
    "<subtask_id>": { "design_agent": "skipped|required", "lead": "required|direct-executor", "integration_checker": "skipped|required|conditional" }
  },
  "subtask_offsets": {
    "<subtask_id>": { "start_line": 157, "end_line": 195 }
  },
  "task_summary_path": "ai-workflow-data/tasks/<task_id>/summary.md"
}
```

**`subtask_offsets`** maps each subtask ID to the line range of its `<!-- section:delivery-subtask-<id> -->` block in `task-data.md`. Populated by the Delivery PM after writing the plan (or by the orchestrator after the Delivery PM completes). This enables targeted `Read(file, offset, limit)` calls instead of loading the full file on every turn.

**State semantics:**

- `completed_subtasks[].verdict` captures the review outcome for that subtask. It does NOT by itself imply the task is complete.
- `blocked_gates` tracks mandatory workflow gates that are still open (`integration-check`, missing reviewer summary, etc.).
- `pending_user_actions` tracks required external actions (dependency install, device QA run, credentials, approvals).
- `phase: complete` is valid only when `pending_subtasks`, `blocked_gates`, and `pending_user_actions` are all empty.
- `current_subtask` is set to the active subtask ID when an agent is dispatched and cleared to `null` only after the subtask reaches `approved` or `needs-replan` verdict. This field is the primary signal for `RESUME_SUBTASK` detection by the resume-orchestrator.

<!-- /section:orchestrator-state -->

<!-- section:escalation -->

## Escalation

- unresolved blockers
- invalid artifact chain
- review failure after complexity-tied cycle cap
- missing context blocking safe execution

<!-- /section:escalation -->

<!-- section:token-saving -->

## Token-saving

### General rules

- Dispatch bundles replace direct governance reads — agents receive only pre-curated excerpts within token ceilings
- Only send the relevant section from `ai-work.md`, not the full file
- Only send target files/modules, not the whole repo
- For `task-data.md`, send only the matching `delivery-subtask-*` section by default
- For orchestrator closure, read `<subtask_id>/summary.md` directly
- For Lead intake on subtasks with a design addendum, send only the `design-*` body sections from `<!-- section:plan-addendum -->`
- For Integration Checker, prefer `impl-files-changed`, `impl-tests-run`, and direct contract excerpts from `<!-- section:implementation -->`
- `delivery-routing`, `delivery-context-manifest`, and `delivery-telemetry` are orchestrator-facing sections and should not be included in dispatch bundles
- Follow the single-fact-per-artifact rule — reference earlier sections by name instead of repeating content
- Orchestrator MUST use `subtask_offsets` from `orchestration-state.json` for targeted reads of `task-data.md` — never load the full file after the planning phase

### Delta-review protocol (rework cycles)

For review cycle N > 1, the dispatch bundle for the target agent includes only delta context:

**Medium/Low findings — Executor goes directly back to Reviewer:**

The executor's rework dispatch bundle includes:
- Current diff or changed files
- Latest `review-findings` from last `### Cycle N` in `<!-- section:review -->`
- Latest `impl-summary` and `impl-tests-run`
- Relevant acceptance slice from `<!-- section:spec -->`
- Do NOT resend: full implementation section, full review history, full baseline, full checklist

The reviewer's re-review dispatch bundle includes:
- Updated `<!-- section:implementation -->` (current cycle only)
- Changed files or diff (current cycle only)
- `<!-- section:spec -->` acceptance signals
- Do NOT resend: full prior review cycles, full TEP, full baseline

**High findings touching TEP-defined logic — Executor routes through Lead:**

The lead's re-validation dispatch bundle includes:
- Impacted TEP slice only (not full TEP)
- Latest finding payload from `review-findings`
- Do NOT resend: full prior review package, full implementation section

The executor's rework bundle (after Lead re-validates) includes:
- Updated TEP slice (if Lead revised it)
- Latest `review-findings`
- Do NOT resend: full TEP, full review history

**Severity routing (unchanged):**
- `High` findings touching TEP-defined logic route: Executor → Lead → Executor → Reviewer
- `Medium` and `Low` findings route: Executor → Reviewer (direct)

<!-- /section:token-saving -->

<!-- section:telemetry -->

## Telemetry

Every agent MUST write one telemetry line to the subtask's `<subtask_id>/summary.md` (under the `## Telemetry` section):

```
<role> | <turns_used>/<turns_budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>
```

- **turns** = number of agent turns consumed / budgeted turns from Delivery Plan.
- **tokens** = approximate input and output token counts for that agent invocation.
- **skills** = dynamic skill cost bucket: `low | medium | high`.
- **plugins** = MCP/plugin cost bucket: `low | medium | high`.
- **ok / OVER_BUDGET** = whether the agent stayed within its assigned turn budget.

The orchestrator creates the summary.md skeleton (with diagnostic section placeholders) alongside the ai-work.md skeleton. Each agent appends its telemetry line. The Reviewer finalizes summary.md with verdict and notes.

The Chief Orchestrator maintains `ai-workflow-data/tasks/<task_id>/summary.md` as the centralized rollup:

1. After each subtask completes, read the `## Telemetry` section from the subtask's `<subtask_id>/summary.md`.
2. Append rows to the Detail table in the task-level `summary.md`.
3. Recalculate the Pipeline one-liner and Totals.
4. Use the `telemetry-summary` skill for the template and rules.

Telemetry is collected forward-only — do not retroactively fill past artifacts.

<!-- /section:telemetry -->

<!-- section:context-manifest -->

## Context Manifest

Every agent MUST write a `### <role>` subsection to the `## Context Manifest` section in the subtask's `<subtask_id>/summary.md`. The manifest answers *where* an agent's input tokens came from.

### Format

Each agent appends a named subsection:

```markdown
### <role>
| path                                    | bucket     | bytes |
| --------------------------------------- | ---------- | ----- |
| roles/lead.md (dispatch bundle)         | governance | 1240  |
| ai-work.md (section:spec)               | artifact   | 890   |
| apps/api/src/modules/bookings/svc.ts    | source     | 3244  |

Totals: governance 1240 | artifact 890 | source 3244 | schema 0 | docs 0
```

### Rules

- **One row per file opened**, whether read via `Read`, filesystem MCP, or received inline via prompt excerpt. The dispatch bundle counts as one `governance` row.
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

After each subtask completes, the Chief Orchestrator extends `ai-workflow-data/tasks/<task_id>/summary.md` with a **Context Breakdown** section by reading all `### <role>` subsections from `## Context Manifest` in each subtask's `<subtask_id>/summary.md`:

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

### Diagnostic loop

Observation is per-task; action waits for aggregate signal.

**Per-task (observation, always on):**

- After each subtask completes, the orchestrator populates a `repeat_reads` line on task-level `summary.md` noting any file read by ≥3 agents within the task.

**After any two completed tasks with manifests (action):**

1. If source files are read by both a Lead and its Executor → the TEP's `context_bundle` is not carrying enough; fix the dispatch bundle content.
2. Otherwise collect one more task before changing anything.

<!-- /section:context-manifest -->

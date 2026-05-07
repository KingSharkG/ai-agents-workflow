---
name: delivery-plan
description: Turn a task into ordered subtasks with dependencies, blockers, and Definition of Done. Use when Delivery PM is shaping execution.
stage: planning
---

# Delivery Plan Skill

Produce an ordered Delivery Plan from a Task Packet. Avoid oversized subtasks — keep every subtask single-domain; split multi-domain work into paired single-domain subtasks. Mark trigger-candidate subtasks for Design and Lead.

Each subtask must be **self-describing**: the Lead reading only the matching subtask excerpt should have enough context to create a TEP without re-exploring the repo.

For all new plans, default to the sectioned format `sectioned-v1` so the orchestrator can excerpt one subtask without opening the full artifact.

## Output Target

**Append** to `<artifact-root>/tasks/<task_id>/task-data.md` (the file created by the `task-packet` skill). Do NOT create a new `delivery-plan.md` file. Wrap the entire output in `<!-- section:delivery-plan -->` ... `<!-- /section:delivery-plan -->`. The nested `<!-- section:delivery-subtask-* -->` IDs inside are unchanged and remain directly extractable.

## Output Template

```markdown

---

<!-- section:delivery-plan -->
## Delivery Plan

<!-- section:delivery-metadata -->
### Metadata

- **task_id**: <from Task Packet>
- **plan_format**: sectioned-v1
- **plan_version**: 1
- **created_at**: <ISO 8601 UTC>
- **updated_at**: <set on revision>
- **task_title**: <from Task Packet>
- **phases**: <short label per phase, e.g. A (auth), B (groups)>
<!-- /section:delivery-metadata -->

---

<!-- section:delivery-phase-<phase-slug> -->
### Phase <X> — <Phase Title>

<!-- section:delivery-subtask-<normalized-subtask-id> -->
#### <subtask_id> — <title>

- **domain**: <single domain from `declared_domains`; never compound>
- **complexity**: low | medium | hard
- **no_split_reason**: <required only when complexity=hard and not splittable>
- **turns_budget**: 3 (low) | 6 (medium) | 10 (hard)
- **depends_on**: <subtask_id list or "none">
- **can_run_in_parallel**: yes | no
- **triggers**: design-agent | lead | none
- **target_files**: <module path(s); Lead verifies exact files in TEP>
- **summary**: <enough context for Lead to TEP from this excerpt alone — see Rules>
- **out_of_scope**: <what this subtask must NOT touch>
- **acceptance_signals**: <observable outcomes>
- **definition_of_done**:
  - [ ] <criterion>
  - [ ] tests pass
  - [ ] Reviewer approves
  - [ ] `<subtask_id>/summary.md` exists
- **blockers**: <blocker or "none">
<!-- /section:delivery-subtask-<normalized-subtask-id> -->

<!-- repeat for each subtask -->
<!-- /section:delivery-phase-<phase-slug> -->

---

<!-- section:delivery-routing -->
### Routing Recommendation

<which agents to dispatch and in what order; note cross-phase dependencies>
<!-- /section:delivery-routing -->

---

<!-- section:delivery-context-manifest -->
### Context Manifest

*(no files read; all context received via prompt)*
Totals: governance 0 | artifact 0 | source 0 | schema 0 | docs 0
<!-- /section:delivery-context-manifest -->

---

<!-- section:delivery-telemetry -->
### Telemetry

<turns_used>/<turns_budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>
<!-- /section:delivery-telemetry -->

<!-- /section:delivery-plan -->
```

## Complexity Rubric

- **low** — single file, no new dependencies, no schema/API change, ~<50 LOC, no cross-module effects.
- **medium** — 2–5 files, possibly a new hook/service, no migration, contained to one module.
- **hard** — migration, new API contract, cross-module refactor, new dependency, or ambiguous requirements. Automatically triggers Lead for the subtask's domain.

## Rules

- Every subtask must have `complexity`, `turns_budget`, `depends_on`, `can_run_in_parallel`, `triggers`, `target_files`, `summary`, `out_of_scope`, `acceptance_signals`, `definition_of_done`, and `blockers` — never blank.
- All new plans MUST use `plan_format: sectioned-v1` and wrap metadata, each phase, each subtask, routing, context manifest, and telemetry in the matching `<!-- section:... -->` markers.
- `subtask_id` stays the compact machine identifier; keep the human-readable heading short and do not duplicate the phase label in the title.
- **`summary` should provide enough detail that the Lead can create a TEP from this excerpt alone.** Keep summaries to ≤ 10 lines per subtask.
- If `complexity=hard`, attempt to split into smaller subtasks. If splitting is not possible, set `no_split_reason` and `triggers: lead`.
- `blockers` must never be left blank — write "none" if clear.
- Append to `task-data.md` — never overwrite the `<!-- section:task-packet -->` section.
- Do not set `triggers: lead` unless the trigger condition from TRIGGER_RULES.md is met.

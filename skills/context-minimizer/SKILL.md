---
name: context-minimizer
description: Produce a minimum context bundle for a given artifact type and target agent role. Eliminates manual context curation by the chief-orchestrator and enforces the token-efficiency policy.
---

# Context Minimizer

Assemble the minimum context bundle before every agent delegation. Never send raw governance files — extract only the relevant excerpts.

Invoke with: **artifact type** (e.g. `task-packet`, `delivery-plan`, `tep`, `implementation-report`, `review-report`) and **target agent**.

## Context Bundle by Role

### delivery-pm

**Include:**

- `section:task-packet` from `task-data.md` (full)
- `ai-workflow-data/config/PROJECT_CONFIG.md` — `<!-- section:domains -->` and `<!-- section:cross-domain-rules -->` for decomposition
- `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` — full (short, always relevant)

**Exclude:** ai-workflow-data/config/PROJECT_CONFIG.md baseline sections, REVIEW_CHECKLIST, all agent contracts

---

### lead (TEP creation + validation)

**Include:**

- `section:spec` from `ai-work.md` (already extracted by orchestrator from `task-data.md`). Never send the full task-data.md.
- When a design addendum exists for the subtask (only for domains listed in `PROJECT_CONFIG.md#domains.design_hook_domains`), include only the body sections from `section:plan-addendum` in `ai-work.md`:
  `design-findings`, `design-constraints`, `design-open-questions`, `domain-invariants`, `domain-role-checks`, `domain-status-checks`, `domain-clarifications`.
- `ai-workflow-data/config/PROJECT_CONFIG.md` — the relevant `<!-- section:<domain> -->` block only (skills, plugins, baselines anchors, validation_rules, forbidden_actions), plus `<!-- section:project-best-practices -->` and the `lead:` sub-block of `<!-- section:agent-best-practices -->`
- `ai-workflow-data/config/PROJECT_CONFIG.md` — only the anchors referenced from the domain section above (the domain baseline plus `<!-- section:auth-baseline -->` / `<!-- section:api-baseline -->` when the subtask touches auth or a REST contract)

**Exclude:** addendum metadata/footer sections, REVIEW_CHECKLIST, all other Delivery Plan subtasks, `delivery-routing`, `delivery-context-manifest`, `delivery-telemetry` by default, other agents' contracts

---

### executor

**Include:**

- `section:tep` from `ai-work.md` (current subtask only)
- `ai-workflow-data/config/PROJECT_CONFIG.md` — the relevant `<!-- section:<domain> -->` block (for baselines anchors, validation_rules, forbidden_actions), plus `<!-- section:project-best-practices -->` and the `executor:` sub-block of `<!-- section:agent-best-practices -->`
- `ai-workflow-data/config/PROJECT_CONFIG.md` — only the anchors referenced from the domain section above
- `${CLAUDE_PLUGIN_ROOT}/ai/core/PROJECT_CONSTITUTION.md` — Definition of Done section only
- On focused rework cycles, include only `<!-- section:review-findings -->` from the last `### Cycle N` in `section:review` in `ai-work.md`, not the full section.

**Exclude:** TRIGGER_RULES, other subtask TEPs

**Lightweight path (`complexity: low`, no TEP):**

- Include `section:spec` from `ai-work.md` (the orchestrator already extracted the matching `delivery-subtask-*` block from `task-data.md` when creating the skeleton).
- Do not include `delivery-routing`, `delivery-context-manifest`, or `delivery-telemetry` unless the specific dispatch truly needs them.

---

### design-agent (FE subtasks only)

**Include:**

- `section:spec` from `ai-work.md` for the active FE subtask
- `ai-workflow-data/config/PROJECT_CONFIG.md` — FE section only (`<!-- section:fe-baseline -->`)
- Relevant FE context excerpt from the touched area (screen contract, navigation rule, type surface, or repo map) when the subtask depends on existing app behavior
- `section:tep` from `ai-work.md` only when revising an already-shaped FE subtask after blocker or rework feedback

**Exclude:** BE baseline, REVIEW_CHECKLIST, other agents' contracts

> Design Agent emits a Design Review Addendum for the Lead to merge; it does not produce executor-facing plans.
> Domain validation is absorbed by the Leads (no separate Domain Agent) — see `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:domain-validation-note -->`.

---

### integration-checker

**Include:**

- Changed-side `section:implementation` section extracts from `ai-work.md` for the current cycle — prefer `impl-files-changed`, `impl-tests-run`, `impl-unresolved-issues`; include the full section only when specific sub-sections are unavailable.
- The latest approved artifact or current live contract surface from the untouched side when only one side changed
- `ai-workflow-data/config/PROJECT_CONFIG.md` — `<!-- section:api-baseline -->` and `<!-- section:auth-baseline -->` only
- Relevant changed FE/BE contract excerpts from source or diff when possible; do not rely on the report alone.

**Exclude:** TRIGGER_RULES

---

### reviewer

**Include:**

- `section:implementation` from `ai-work.md` (current cycle)
- Changed files or diff for the current cycle
- `section:spec` from `ai-work.md` for the active subtask
- `${CLAUDE_PLUGIN_ROOT}/ai/governance/REVIEW_CHECKLIST.md` — always: `core-review`, `severity`, `rework-policy`; add `domain-review` for any domain subtask; add `integration-review` when a paired cross-domain subtask changed both sides or an Integration Check Report is included for this cycle
- `ai-workflow-data/config/PROJECT_CONFIG.md` — relevant layer section only
- `${CLAUDE_PLUGIN_ROOT}/ai/core/PROJECT_CONSTITUTION.md` — `definition-of-done` section only
- Integration Check Report (if available for this cycle)

**Exclude:** TRIGGER_RULES, all agent contracts

---

### orchestrator (post-approval summary)

**Include:**

- `section:review` sections `review-verdict` and `review-completion-summary` from `ai-work.md` (approved cycle only)
- `<subtask_id>/summary.md` — Reviewer writes this; orchestrator reads it when extending the task-level summary
- `${CLAUDE_PLUGIN_ROOT}/ai/core/PROJECT_CONSTITUTION.md` — Definition of Done section only

**Exclude:** ai-workflow-data/config/PROJECT_CONFIG.md baseline sections, TRIGGER_RULES

> Note: Summary is now handled by the orchestrator directly, not a separate agent.

---

## Output format

```markdown
## Context Bundle — [Target Agent] receiving [Artifact Type]

### Included

- [file or section]: [one-line reason]

### Explicitly Excluded

- [file]: [reason]

### Current Artifact

[paste or reference]
```

## Rules

- Never include a full governance file when a section suffices.
- Never include all subtask TEPs when only one subtask is being worked.
- For sectioned Delivery Plans, default to `delivery-subtask-*` only. Add `delivery-routing`, `delivery-context-manifest`, or `delivery-telemetry` only when they materially change the target agent's work.
- If in doubt, exclude and note it — the agent can request more context via `blocker-escalation-report`.

## Token Ceilings per Role

These caps apply to curated governance/context tokens only (excluding the agent's own instructions and the current artifact content).

| Target Role                      | Max Governance Tokens | Rationale                                                                    |
| -------------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| executor                         | 1 500                 | Only needs TEP + one baseline section + DoD                                  |
| reviewer                         | 2 400                 | Needs implementation report + active scope excerpt + review checklist + one baseline section + DoD |
| lead (TEP creation)              | 1 800                 | One subtask excerpt + one baseline section + tech stack                      |
| delivery-pm                      | 2 000                 | Task packet + domains/cross-domain rules + trigger rules                     |
| design-agent                     | 1 500                 | Delivery subtask + FE baseline section + small target-context excerpt        |
| integration-checker              | 1 200                 | Changed-side implementation report + untouched-side contract surface + API/Auth sections |

If the assembled context exceeds the ceiling, the orchestrator must re-excerpt before dispatching. Over-ceiling dispatch is an orchestration defect.

## Section Extraction

Use `<!-- section:TAG -->` markers in governance and core files to extract precise sections:

### Delivery Plans

Extract from `task-data.md` → `<!-- section:delivery-plan -->`, then within it:

- Metadata only → `<!-- section:delivery-metadata -->`
- Phase overview / grouping → `<!-- section:delivery-phase-<phase-slug> -->`
- Lead or lightweight executor dispatch → `<!-- section:delivery-subtask-<normalized-subtask-id> -->`
- Orchestrator routing only → `<!-- section:delivery-routing -->`
- Diagnostics only → `<!-- section:delivery-context-manifest -->`, `<!-- section:delivery-telemetry -->`

### Task Packet

Extract from `task-data.md` → `<!-- section:task-packet -->`, then within it:

- Metadata / title → `<!-- section:task-metadata -->`
- Requirements excerpt → `<!-- section:task-requirements-excerpt -->`
- Scope estimate → `<!-- section:task-scope-estimate -->`
- Audit context only → `<!-- section:task-business-goal -->`, `<!-- section:task-known-blockers -->`, `<!-- section:task-assumptions -->`

### Technical Execution Packet

Extract from `section:tep` in `ai-work.md`, then within it:

- Metadata / traceability → `<!-- section:tep-metadata -->`
- Goal → `<!-- section:tep-goal -->`
- Scope / target files → `<!-- section:tep-target-files -->`, `<!-- section:tep-non-goals -->`
- Contract / context for executors → `<!-- section:tep-expected-contract -->`, `<!-- section:tep-context-bundle -->`
- Execution guidance → `<!-- section:tep-implementation-steps -->`, `<!-- section:tep-risks -->`, `<!-- section:tep-acceptance-signals -->`, `<!-- section:tep-recommended-tests -->`

### Implementation Report

Extract from `section:implementation` in `ai-work.md`, then within it:

- Metadata → `<!-- section:impl-metadata -->`
- Change summary → `<!-- section:impl-summary -->`, `<!-- section:impl-files-changed -->`
- Validation evidence → `<!-- section:impl-tests-run -->`
- Audit/supporting context → `<!-- section:impl-dynamic-skills -->`, `<!-- section:impl-plugins-used -->`, `<!-- section:impl-unresolved-issues -->`, `<!-- section:impl-project-state -->`

### Review Report

Extract from `section:review` in `ai-work.md`. Multi-cycle: the section contains `### Cycle N` subsections — latest cycle first. Within a cycle:

- Metadata → `<!-- section:review-metadata -->`
- Rework input for executors → `<!-- section:review-findings -->`
- Orchestrator closure → `<!-- section:review-verdict -->`, `<!-- section:review-completion-summary -->`

**Latest review cycle rule:** For executor rework, extract only the last `### Cycle N` subsection within `<!-- section:review -->`. Do not send previous cycles.

### Integration Check Report

Remains a **standalone file** (references two subtasks simultaneously): `ai-workflow-data/tasks/<task_id>/integration-check-<cycle>.md`.

- Metadata → `<!-- section:integration-metadata -->`
- Compared surfaces → `<!-- section:integration-fe-surface -->`, `<!-- section:integration-be-surface -->`
- Result / actions → `<!-- section:integration-verdict -->`, `<!-- section:integration-findings -->`, `<!-- section:integration-recommended-fixes -->`

### Design / Domain Addenda

Extract from `section:plan-addendum` in `ai-work.md`, then within it:

- Design body → `<!-- section:design-findings -->`, `<!-- section:design-constraints -->`, `<!-- section:design-open-questions -->`
- Domain body → `<!-- section:domain-invariants -->`, `<!-- section:domain-role-checks -->`, `<!-- section:domain-status-checks -->`, `<!-- section:domain-clarifications -->`

### Blocker Escalation Report

Extract from `section:escalation-N` in `ai-work.md` (N is orchestrator-assigned, incrementing per escalation event), then within it:

- Metadata → `<!-- section:blocker-metadata -->`
- Blocker decision payload → `<!-- section:blocker-type -->`, `<!-- section:blocker-what-is-blocked -->`, `<!-- section:blocker-what-was-tried -->`, `<!-- section:blocker-required-input -->`, `<!-- section:blocker-suggested-rerouting -->`

### Subtask Summary

No section markers — read `<subtask_id>/summary.md` directly (written by Reviewer). Contains: Verdict, Cycles, Files Changed, Telemetry, Notes (completion one-liner).

### Baseline sections in `ai-workflow-data/config/PROJECT_CONFIG.md`

- FE executor/lead → extract `<!-- section:fe-baseline -->`
- BE executor/lead → extract `<!-- section:be-baseline -->`
- Integration checker → extract `<!-- section:api-baseline -->`
- Auth-related tasks → also extract `<!-- section:auth-baseline -->`
- Reviewer → extract the layer-relevant section only

### REVIEW_CHECKLIST.md

- Always include: `<!-- section:core-review -->`, `<!-- section:severity -->`, `<!-- section:rework-policy -->`
- Any domain subtask → also include `<!-- section:domain-review -->`
- Paired cross-domain subtask (e.g. FE+BE), or any cycle with an Integration Check Report → include `<!-- section:domain-review -->`, `<!-- section:integration-review -->`

### RESOLUTION_POLICY.md

- Always include: `<!-- section:global-skills -->`
- Reviewer → also include `<!-- section:reviewer-skills -->`
- Agents checking plugin availability → `<!-- section:registry -->` only
- Adding/deprecating plugins → also include `<!-- section:intake -->`, `<!-- section:deprecation -->`
- Budget enforcement → `<!-- section:plugin-budget -->`, `<!-- section:skill-budget -->`
- Domain-fixed skills are not in this file — pull them from `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:<domain> -->` → `skills`.

### PROJECT_CONSTITUTION.md

- Executors/Reviewer → extract `<!-- section:definition-of-done -->`
- Stack, auth, and API baselines are not in the constitution — pull them from `ai-workflow-data/config/PROJECT_CONFIG.md` instead (`<!-- section:<domain> -->`, `<!-- section:auth-baseline -->`, `<!-- section:api-baseline -->`).

Topic-key conventions match the baseline sections in `ai-workflow-data/config/PROJECT_CONFIG.md` (`fe-baseline`, `be-baseline`, `auth-baseline`, `api-baseline`). When a role needs "relevant requirements only," pick by topic key from `PROJECT_CONFIG`.

### TRIGGER_RULES.md

- Orchestrator (full routing) → all trigger sections
- FE dispatch decisions → `<!-- section:fe-triggers -->`, `<!-- section:design-agent-trigger -->`, `<!-- section:domain-validation-note -->`
- BE dispatch decisions → `<!-- section:be-triggers -->`
- Executor dispatch gate → `<!-- section:definition-of-ready -->`
- Budget enforcement → `<!-- section:turn-budgets -->`, `<!-- section:telemetry-gate -->`

### ORCHESTRATION.md

- Default workflow → `<!-- section:default-flow -->`
- Escalation rules → `<!-- section:escalation -->`

---
name: context-minimizer
description: Build and write a dispatch bundle file for a target agent role before every delegation. Replaces the six-step load order with a single pre-curated file that the agent reads on startup.
---

# Context Minimizer — Dispatch Bundle Producer

Before every agent delegation the orchestrator MUST invoke this skill to produce a **dispatch bundle** — a single markdown file that contains everything the target agent needs. The agent reads this file instead of independently loading governance files, canonical contracts, and PROJECT_CONFIG.md sections.

## Dispatch Bundle Protocol

1. Determine the target agent role and subtask context (domain, complexity, rework cycle if any).
2. Assemble the bundle content per the role-specific rules below.
3. Verify the assembled governance/context excerpts stay within the token ceiling for the target role.
4. Write the bundle file to `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/roles/<role>.md`.
5. Pass the bundle file path to the agent in the dispatch prompt.

If the assembled context exceeds the ceiling, re-excerpt until it fits — never silently exceed. Over-ceiling dispatch is an orchestration defect.

## Bundle Format

```markdown
# Dispatch Bundle — <role> for <subtask_id>

## Role Contract
[copy the matching `<!-- role-contract:<role> -->` block verbatim from the Role Contract Blocks section below — do NOT read ai/agents/<role>.md]

## Project Context
[relevant domain section + baseline + role best-practices — pre-extracted from ai-workflow-data/config/PROJECT_CONFIG.md]

## Governance
[only sections relevant to this role, within token ceiling — excerpted from governance files]

## Artifact Input
[specific ai-work.md sections this role needs — spec, tep, review-findings, etc.]
```

The agent reads ONLY this bundle (plus its own stub for tool/model config). It does NOT independently read canonical contracts, PROJECT_CONFIG.md, or governance files.

---

## Role Contract Blocks

Role contracts live in the sibling file [`role-contracts.md`](./role-contracts.md). Read it only at bundle-assembly time, extract the `<!-- role-contract:<role> -->` block matching the target role, and copy it verbatim into the bundle's `## Role Contract` section. The canonical `ai/agents/<role>.md` files exist for human documentation only and are NOT read at dispatch time — any edit there MUST be mirrored in `role-contracts.md` in the same commit.

---

## Context Bundle by Role

### delivery-pm

**Role Contract:** copy `<!-- role-contract:delivery-pm -->` block verbatim from the Role Contract Blocks section above. Do NOT read `ai/agents/delivery-pm.md`.

**Project Context from** `PROJECT_CONFIG.md`:
- `<!-- section:domains -->` — declared_domains, detection_rules, decomposition_rule, escalation_rule
- `<!-- section:cross-domain-rules -->` — ordering rules

**Governance:**
- `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` — full (short, always relevant for routing recommendations)

**Artifact Input:**
- `section:task-packet` from `task-data.md` (full)

**Exclude:** PROJECT_CONFIG.md baseline sections, REVIEW_CHECKLIST, all other agent contracts

---

### lead (TEP creation + validation)

**Role Contract:** copy `<!-- role-contract:lead -->` block verbatim from the Role Contract Blocks section above. Do NOT read `ai/agents/lead.md`.

**Project Context from** `PROJECT_CONFIG.md`:
- `<!-- section:<domain> -->` block (skills, plugins, baseline anchors, validation_rules, forbidden_actions)
- Referenced baseline anchors (`<!-- section:<domain>-baseline -->` plus `<!-- section:auth-baseline -->` / `<!-- section:api-baseline -->` when the subtask touches auth or a REST contract)
- `<!-- section:project-best-practices -->`
- `lead:` sub-block of `<!-- section:agent-best-practices -->`

**Governance:**
- None required in bundle (Lead does not need TRIGGER_RULES or REVIEW_CHECKLIST)

**Artifact Input:**
- `section:spec` from `ai-work.md` (already extracted by orchestrator from `task-data.md`). Never send the full task-data.md.
- When a design addendum exists (only for domains in `design_hook_domains`), include only body sections from `section:plan-addendum`:
  `design-findings`, `design-constraints`, `design-open-questions`, `domain-invariants`, `domain-role-checks`, `domain-status-checks`, `domain-clarifications`.

**Exclude:** addendum metadata/footer, REVIEW_CHECKLIST, other Delivery Plan subtasks, `delivery-routing`, `delivery-context-manifest`, `delivery-telemetry`, other agents' contracts

---

### executor

**Role Contract:** copy `<!-- role-contract:executor -->` block verbatim from the Role Contract Blocks section above. Do NOT read `ai/agents/executor.md`.

**Project Context from** `PROJECT_CONFIG.md`:
- `<!-- section:<domain> -->` block (for baseline anchors, validation_rules, forbidden_actions)
- Referenced baseline anchors — **skip if the TEP's `<!-- section:tep-context-bundle -->` already contains the same baseline content** (Lead embeds baselines in the TEP context_bundle for medium/hard subtasks; re-including them wastes ~300-500 tokens)
- `<!-- section:project-best-practices -->`
- `executor:` sub-block of `<!-- section:agent-best-practices -->`

**Governance:**
- `${CLAUDE_PLUGIN_ROOT}/ai/core/PROJECT_CONSTITUTION.md` — Definition of Done section only

**Artifact Input:**
- `section:tep` from `ai-work.md` (current subtask only)
- On focused rework cycles: only `<!-- section:review-findings -->` from the last `### Cycle N` in `section:review`, not the full section.

**Exclude:** TRIGGER_RULES, other subtask TEPs

**Lightweight path (`complexity: low`, no TEP):**
- Include `section:spec` from `ai-work.md` instead of TEP.
- Do not include `delivery-routing`, `delivery-context-manifest`, or `delivery-telemetry`.

**Rework bundle (cycle N > 1):**
- Include only: current diff or changed files, latest `review-findings` from last `### Cycle N`, latest `impl-summary` and `impl-tests-run`, relevant acceptance slice from `spec`.
- For High findings routed through Lead: include only the impacted TEP slice and latest finding payload, not the full prior package.
- Do NOT include: full implementation section, full review history, full baseline, full checklist.

---

### design-agent (FE subtasks only)

**Role Contract:** copy `<!-- role-contract:design-agent -->` block verbatim from the Role Contract Blocks section above. Do NOT read `ai/agents/design-agent.md`.

**Project Context from** `PROJECT_CONFIG.md`:
- FE section only (`<!-- section:fe-baseline -->`)

**Governance:**
- None required in bundle

**Artifact Input:**
- `section:spec` from `ai-work.md` for the active FE subtask
- Relevant FE context excerpt from the touched area (screen contract, navigation rule, type surface, or repo map) when the subtask depends on existing app behavior
- `section:tep` from `ai-work.md` only when revising an already-shaped FE subtask after blocker or rework feedback

**Exclude:** BE baseline, REVIEW_CHECKLIST, other agents' contracts

---

### integration-checker

**Role Contract:** copy `<!-- role-contract:integration-checker -->` block verbatim from the Role Contract Blocks section above. Do NOT read `ai/agents/integration-checker.md`.

**Project Context from** `PROJECT_CONFIG.md`:
- `<!-- section:api-baseline -->` and `<!-- section:auth-baseline -->` only

**Governance:**
- None required in bundle

**Artifact Input:**
- Changed-side `section:implementation` extracts from `ai-work.md` — prefer `impl-files-changed`, `impl-tests-run`, `impl-unresolved-issues`; include full section only when sub-sections are unavailable.
- Latest approved artifact or current live contract surface from the untouched side when only one side changed
- Relevant changed FE/BE contract excerpts from source or diff when possible

**Exclude:** TRIGGER_RULES

---

### reviewer

**Role Contract:** copy `<!-- role-contract:reviewer -->` block verbatim from the Role Contract Blocks section above. Do NOT read `ai/agents/reviewer.md`.

**Project Context from** `PROJECT_CONFIG.md`:
- Relevant layer section only (domain validation_rules)

**Governance:**
- `${CLAUDE_PLUGIN_ROOT}/ai/governance/REVIEW_CHECKLIST.md` — always: `<!-- section:core-review -->`, `<!-- section:severity -->`, `<!-- section:rework-policy -->`; add `<!-- section:domain-review -->` for domain subtasks; add `<!-- section:integration-review -->` when paired cross-domain subtask changed both sides or Integration Check Report included
- `${CLAUDE_PLUGIN_ROOT}/ai/core/PROJECT_CONSTITUTION.md` — `<!-- section:definition-of-done -->` section only

**Artifact Input:**
- `section:implementation` from `ai-work.md` (current cycle)
- Changed files or diff for the current cycle
- `section:spec` from `ai-work.md` for the active subtask
- Integration Check Report (if available for this cycle)

**Exclude:** TRIGGER_RULES, all other agent contracts

**Re-review bundle (rework cycle N > 1):**
- Include only: updated `<!-- section:implementation -->` (current cycle), changed files or diff (current cycle), `<!-- section:spec -->` acceptance signals.
- Do NOT include: full prior review cycles, full TEP, full baseline.
- **Governance reduction:** Each reviewer dispatch is a new agent instance with no memory of prior cycles. However, if the re-review is for Medium/Low findings only (no scope change), include a condensed governance reminder instead of full sections: include only `<!-- section:severity -->` and `<!-- section:rework-policy -->` (skip `core-review`, `domain-review`, `integration-review`). Add a one-liner: `Review protocol: same as Cycle 1 — focus on whether findings from Cycle N-1 are resolved.` This saves ~800-1,200 tokens per rework cycle. For High findings or scope changes, include full governance as in Cycle 1.

---

### orchestrator (post-approval summary)

No dispatch bundle needed — the orchestrator reads artifacts directly. For post-approval:

**Include:**
- `section:review` sections `review-verdict` and `review-completion-summary` from `ai-work.md` (approved cycle only)
- `<subtask_id>/summary.md` (written by Reviewer)
- `${CLAUDE_PLUGIN_ROOT}/ai/core/PROJECT_CONSTITUTION.md` — Definition of Done section only

**Exclude:** PROJECT_CONFIG.md baseline sections, TRIGGER_RULES

---

## Token Ceilings per Role

These caps apply to curated governance/context tokens in the bundle (excluding the agent stub's own content and target source files the agent reads during work).

| Target Role          | Max Governance Tokens | Rationale |
| -------------------- | --------------------- | --------- |
| executor             | 1 500                 | TEP + one baseline section + DoD |
| reviewer             | 2 400                 | Implementation report + scope excerpt + review checklist + one baseline + DoD |
| lead (TEP creation)  | 1 800                 | One subtask excerpt + one baseline section + tech stack |
| delivery-pm          | 2 000                 | Task packet + domains/cross-domain rules + trigger rules |
| design-agent         | 1 500                 | Delivery subtask + FE baseline + small context excerpt |
| integration-checker  | 1 200                 | Changed-side implementation + untouched-side contract + API/Auth sections |

---

## Section Extraction Rules

Use `<!-- section:TAG -->` markers in governance and core files to extract precise sections.

### Delivery Plans

Extract from `task-data.md` → `<!-- section:delivery-plan -->`:
- Metadata only → `<!-- section:delivery-metadata -->`
- Phase overview �� `<!-- section:delivery-phase-<phase-slug> -->`
- Single subtask → `<!-- section:delivery-subtask-<normalized-subtask-id> -->`
- Routing only → `<!-- section:delivery-routing -->`

### Task Packet

Extract from `task-data.md` → `<!-- section:task-packet -->`:
- Metadata / title → `<!-- section:task-metadata -->`
- Requirements → `<!-- section:task-requirements-excerpt -->`
- Scope → `<!-- section:task-scope-estimate -->`
- Audit context → `<!-- section:task-business-goal -->`, `<!-- section:task-known-blockers -->`, `<!-- section:task-assumptions -->`

### Technical Execution Packet

Extract from `section:tep` in `ai-work.md`:
- Metadata → `<!-- section:tep-metadata -->`
- Goal → `<!-- section:tep-goal -->`
- Scope → `<!-- section:tep-target-files -->`, `<!-- section:tep-non-goals -->`
- Contract/context → `<!-- section:tep-expected-contract -->`, `<!-- section:tep-context-bundle -->`
- Execution guidance → `<!-- section:tep-implementation-steps -->`, `<!-- section:tep-risks -->`, `<!-- section:tep-acceptance-signals -->`, `<!-- section:tep-recommended-tests -->`

### Implementation Report

Extract from `section:implementation` in `ai-work.md`:
- Metadata → `<!-- section:impl-metadata -->`
- Change summary → `<!-- section:impl-summary -->`, `<!-- section:impl-files-changed -->`
- Validation evidence → `<!-- section:impl-tests-run -->`
- Audit → `<!-- section:impl-dynamic-skills -->`, `<!-- section:impl-plugins-used -->`, `<!-- section:impl-unresolved-issues -->`, `<!-- section:impl-project-state -->`

### Review Report

Extract from `section:review` in `ai-work.md` (multi-cycle: `### Cycle N` subsections, latest first):
- Metadata → `<!-- section:review-metadata -->`
- Rework input → `<!-- section:review-findings -->`
- Closure → `<!-- section:review-verdict -->`, `<!-- section:review-completion-summary -->`

**Latest review cycle rule:** For executor rework, extract only the last `### Cycle N` subsection. Do not send previous cycles.

### Integration Check Report

Standalone file: `ai-workflow-data/tasks/<task_id>/integration-check-<cycle>.md`
- Metadata → `<!-- section:integration-metadata -->`
- Surfaces → `<!-- section:integration-fe-surface -->`, `<!-- section:integration-be-surface -->`
- Result → `<!-- section:integration-verdict -->`, `<!-- section:integration-findings -->`, `<!-- section:integration-recommended-fixes -->`

### Design / Domain Addenda

Extract from `section:plan-addendum` in `ai-work.md`:
- Design body → `<!-- section:design-findings -->`, `<!-- section:design-constraints -->`, `<!-- section:design-open-questions -->`
- Domain body → `<!-- section:domain-invariants -->`, `<!-- section:domain-role-checks -->`, `<!-- section:domain-status-checks -->`, `<!-- section:domain-clarifications -->`

### Blocker Escalation Report

Extract from `section:escalation-N` in `ai-work.md`:
- Metadata → `<!-- section:blocker-metadata -->`
- Payload → `<!-- section:blocker-type -->`, `<!-- section:blocker-what-is-blocked -->`, `<!-- section:blocker-what-was-tried -->`, `<!-- section:blocker-required-input -->`, `<!-- section:blocker-suggested-rerouting -->`

### Baseline sections in `PROJECT_CONFIG.md`

- FE executor/lead → `<!-- section:fe-baseline -->`
- BE executor/lead → `<!-- section:be-baseline -->`
- Integration checker → `<!-- section:api-baseline -->`
- Auth-related → also `<!-- section:auth-baseline -->`
- Reviewer → layer-relevant section only

### REVIEW_CHECKLIST.md

- Always: `<!-- section:core-review -->`, `<!-- section:severity -->`, `<!-- section:rework-policy -->`
- Domain subtask → also `<!-- section:domain-review -->`
- Paired cross-domain / IC report → also `<!-- section:integration-review -->`

### RESOLUTION_POLICY.md

- Always: `<!-- section:global-skills -->`
- Reviewer → also `<!-- section:reviewer-skills -->`
- Plugin availability → `<!-- section:registry -->` only
- Budget enforcement → `<!-- section:plugin-budget -->`, `<!-- section:skill-budget -->`

### PROJECT_CONSTITUTION.md

- Executors/Reviewer → `<!-- section:definition-of-done -->`

### TRIGGER_RULES.md

- Delivery PM (full routing) → all trigger sections
- FE dispatch → `<!-- section:fe-triggers -->`, `<!-- section:design-agent-trigger -->`, `<!-- section:domain-validation-note -->`
- BE dispatch → `<!-- section:be-triggers -->`
- Executor gate → `<!-- section:definition-of-ready -->`
- Budget → `<!-- section:turn-budgets -->`, `<!-- section:telemetry-gate -->`

### ORCHESTRATION.md

- Default workflow → `<!-- section:default-flow -->`
- Escalation → `<!-- section:escalation -->`

## Rules

- Never include a full governance file when a section suffices.
- Never include all subtask TEPs when only one subtask is being worked.
- For sectioned Delivery Plans, default to `delivery-subtask-*` only.
- If in doubt, exclude and note it — the agent can request more context via `blocker-escalation-report`.
- The bundle file path convention is `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/roles/<role>.md`.
- Bundle files are retained after agent completion. Their key data (role, token ceiling used, sections included) is summarized into `<subtask_id>/summary.md` by the orchestrator. Bundle files may then be deleted.

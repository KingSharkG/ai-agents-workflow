# Section Extraction Rules

Use `<!-- section:TAG -->` markers in governance and core files to extract precise sections.

## Delivery Plans

Extract from `task-data.md` → `<!-- section:delivery-plan -->`:
- Metadata only → `<!-- section:delivery-metadata -->`
- Phase overview → `<!-- section:delivery-phase-<phase-slug> -->`
- Single subtask → `<!-- section:delivery-subtask-<normalized-subtask-id> -->`
- Routing only → `<!-- section:delivery-routing -->`

## Task Packet

Extract from `task-data.md` → `<!-- section:task-packet -->`:
- Metadata / title → `<!-- section:task-metadata -->`
- Requirements → `<!-- section:task-requirements-excerpt -->`
- Scope → `<!-- section:task-scope-estimate -->`
- Audit context → `<!-- section:task-business-goal -->`, `<!-- section:task-known-blockers -->`, `<!-- section:task-assumptions -->`

## Technical Execution Packet

Extract from `section:tep` in `ai-work.md`:
- Metadata → `<!-- section:tep-metadata -->`
- Goal → `<!-- section:tep-goal -->`
- Scope → `<!-- section:tep-target-files -->`, `<!-- section:tep-non-goals -->`
- Contract/context → `<!-- section:tep-expected-contract -->`, `<!-- section:tep-context-bundle -->`
- Execution guidance → `<!-- section:tep-implementation-steps -->`, `<!-- section:tep-risks -->`, `<!-- section:tep-acceptance-signals -->`, `<!-- section:tep-recommended-tests -->`

## Implementation Report

Extract from `section:implementation` in `ai-work.md`:
- Metadata → `<!-- section:impl-metadata -->`
- Change summary → `<!-- section:impl-summary -->`, `<!-- section:impl-files-changed -->`
- Validation evidence → `<!-- section:impl-tests-run -->`
- Audit → `<!-- section:impl-dynamic-skills -->`, `<!-- section:impl-plugins-used -->`, `<!-- section:impl-unresolved-issues -->`, `<!-- section:impl-project-state -->`

## Review Report

Extract from `section:review` in `ai-work.md` (multi-cycle: `### Cycle N` subsections, latest first):
- Metadata → `<!-- section:review-metadata -->`
- Rework input → `<!-- section:review-findings -->`
- Closure → `<!-- section:review-verdict -->`, `<!-- section:review-completion-summary -->`

**Latest review cycle rule:** For executor rework, extract only the last `### Cycle N` subsection. Do not send previous cycles.

## Integration Check Report

Standalone file: `<artifact-root>/tasks/<task_id>/integration-check-<cycle>.md`
- Metadata → `<!-- section:integration-metadata -->`
- Surfaces → `<!-- section:integration-fe-surface -->`, `<!-- section:integration-be-surface -->`
- Result → `<!-- section:integration-verdict -->`, `<!-- section:integration-findings -->`, `<!-- section:integration-recommended-fixes -->`

## Design / Domain Addenda

Extract from `section:plan-addendum` in `ai-work.md`:
- Design body → `<!-- section:design-findings -->`, `<!-- section:design-constraints -->`, `<!-- section:design-open-questions -->`
- Domain body → `<!-- section:domain-invariants -->`, `<!-- section:domain-role-checks -->`, `<!-- section:domain-status-checks -->`, `<!-- section:domain-clarifications -->`

## Blocker Escalation Report

Extract from `section:escalation-N` in `ai-work.md`:
- Metadata → `<!-- section:blocker-metadata -->`
- Payload → `<!-- section:blocker-type -->`, `<!-- section:blocker-what-is-blocked -->`, `<!-- section:blocker-what-was-tried -->`, `<!-- section:blocker-required-input -->`, `<!-- section:blocker-suggested-rerouting -->`

## Baseline sections in `PROJECT_CONFIG.md`

Resolved via the Project-Level Context Cache protocol (see SKILL.md → "Project-Level Context Cache (consumption protocol)") — grep the `<tag>` anchor block out of `domain-contexts.cache.md` first (when listed in `domain-contexts.cache.manifest.json`), fall back to live extraction from `PROJECT_CONFIG.md` otherwise.

- FE executor/lead → `<!-- section:fe-baseline -->`
- BE executor/lead → `<!-- section:be-baseline -->`
- Integration checker → `<!-- section:api-baseline -->`
- Auth-related → also `<!-- section:auth-baseline -->`
- Reviewer → layer-relevant section only

## REVIEW_CHECKLIST.md

- Always: `<!-- section:core-review -->`, `<!-- section:severity -->`, `<!-- section:rework-policy -->`
- Domain subtask → also `<!-- section:domain-review -->`
- Paired cross-domain / IC report → also `<!-- section:integration-review -->`

## RESOLUTION_POLICY.md

- Always: `<!-- section:global-skills -->`
- Reviewer → also `<!-- section:reviewer-skills -->`
- Plugin availability → `<!-- section:registry -->` only
- Budget enforcement → `<!-- section:plugin-budget -->`, `<!-- section:skill-budget -->`

## PROJECT_CONSTITUTION.md

- Executors/Reviewer → `<!-- section:definition-of-done -->`

## TRIGGER_RULES.md

- Delivery PM (full routing) → all trigger sections
- FE dispatch → `<!-- section:fe-triggers -->`, `<!-- section:design-agent-trigger -->`, `<!-- section:domain-validation-note -->`
- BE dispatch → `<!-- section:be-triggers -->`
- Executor gate → `<!-- section:definition-of-ready -->`
- Budget → `<!-- section:turn-budgets -->`, `<!-- section:telemetry-gate -->`

## ORCHESTRATION.md

- Default workflow → `<!-- section:default-flow -->`
- Escalation → `<!-- section:escalation -->`

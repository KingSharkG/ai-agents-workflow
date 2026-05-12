# REVIEW_CHECKLIST

<!-- section:core-review -->

## Core Review Areas

- correctness
- architecture fit
- test adequacy
- error handling
- performance
- accessibility basics
- security and auth implications
- contract consistency
- scope discipline
- style and convention consistency — apply `<artifact-root>/config/PROJECT_CONFIG.md#<!-- section:project-best-practices -->` and `#<!-- section:agent-best-practices -->` → `reviewer` (naming, formatting, idiomatic patterns established in the existing codebase)

<!-- /section:core-review -->

<!-- section:domain-review -->

## Domain Review

For the subtask's declared `domain`, apply all of:

- `<artifact-root>/config/PROJECT_CONFIG.md#<!-- section:<domain> -->` → `validation_rules`
- `<artifact-root>/config/PROJECT_CONFIG.md#<!-- section:<domain> -->` → `forbidden_actions`
- `<artifact-root>/config/PROJECT_CONFIG.md#<!-- section:<domain>-baseline -->`
- `<artifact-root>/config/PROJECT_CONFIG.md#<!-- section:agent-best-practices -->` → `reviewer`

For paired / cross-domain work (e.g. `fe` + `be` in the same feature), also apply `<!-- section:cross-domain-rules -->` and the integration-review section below.

<!-- /section:domain-review -->

<!-- section:integration-review -->

## Integration Review

**Skip condition:** if an approved `<!-- section:integration-check -->` in `ai-work.md` with `verdict: ok` exists for the current review cycle, the Reviewer MUST skip this section and note `integration-review: delegated to integration-checker` in `<!-- section:review -->`. Reviewer's correctness / security / architecture checks remain independent.

Otherwise check:

- FE expectations match BE contract
- auth expectations match actual backend behavior
- field names and nullability align
- loading/error states match real API outcomes
- status codes and error shapes handled correctly

<!-- /section:integration-review -->

<!-- section:severity -->

## Severity

### High

- logic bug
- security/auth issue
- contract mismatch
- data integrity risk

### Medium

- missing edge-case handling
- missing important tests
- weak error handling
- problematic UX state handling

### Low

- naming
- readability
- small cleanup
- small consistency issue

<!-- /section:severity -->

<!-- section:rework-policy -->

## Rework Policy

- Rework cycle cap is complexity-tied (low=1, medium=2, hard=3). Authoritative table: `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:rework-cap -->`.
- Exceeding the cap with unresolved high/medium issues auto-downgrades the subtask to `status: needs-replan` and routes to Delivery PM via Blocker Escalation Report — not another executor turn.

<!-- /section:rework-policy -->

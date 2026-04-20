---
name: project-config-template
description: Canonical skeleton for ai-workflow-data/config/PROJECT_CONFIG.md. Use when init writes the initial file or update refreshes owned sections. Emitted text must pass the hooks/evaluate-triggers.js regex.
---

# Project Config Template Skill

Produce the content for `ai-workflow-data/config/PROJECT_CONFIG.md`. All required anchors are present even when empty (per `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:produce-artifact-first -->`).

**Denylist enforcement.** When populating `<!-- section:<domain> -->` → `plugins:` and `skills:` lists, drop every candidate whose identifier matches an entry in `${CLAUDE_PLUGIN_ROOT}/ai/governance/FORBIDDEN_WORKFLOWS.md` → `<!-- section:denylist -->`. Do NOT emit `feature-dev`, `feature-dev:*`, `pr-review-toolkit:review-pr`, `pr-review-toolkit:code-reviewer`, `code-review:code-review`, or the role-scoped `superpowers:*` orchestration skills listed there — they orchestrate competing workflows and would be stripped at bundle assembly by the `context-minimizer` filter and hard-blocked at dispatch by the `guard-forbidden-workflows` hook. Helpers that are safe to list: `context7`, `figma`, `supabase`, domain-specific MCP servers, and the narrow `superpowers:*` / `pr-review-toolkit:*` entries named in `FORBIDDEN_WORKFLOWS.md` → `<!-- section:allowed-helpers -->`.

## Output Target

Return the full skeleton to the init agent. The agent writes it atomically after the `project-config-review` gate approves.

## Required Anchors (v1)

1. `<!-- section:domains -->` — declared_domains, detection_rules, decomposition_rule, escalation_rule.
2. `<!-- section:<domain> -->` — one per declared domain (skills, plugins, baseline anchor, validation_rules, forbidden_actions).
3. `<!-- section:<domain>-baseline -->` — persistent domain context.
4. `<!-- section:api-baseline -->` — BE REST contract expectations.
5. `<!-- section:auth-baseline -->` — auth / permission model baseline.
6. `<!-- section:project-best-practices -->` — universal project conventions (user-editable).
7. `<!-- section:agent-best-practices -->` — role-specific overlay (user-editable).
8. `<!-- section:extra-trigger-keywords -->` — project keyword overlay unioned with TRIGGER_RULES.
9. `<!-- section:cross-domain-rules -->` — rules spanning multiple domains (read by delivery-pm).
10. `<!-- section:quality-gates -->` — CI / test / lint / typecheck / build commands (read by reviewer and executor).

For `fe`-only or `be`-only projects, drop the unused domain and its baseline; trim `declared_domains` accordingly. Include `api-baseline` and `auth-baseline` only when BE is present.

## Skeleton

```markdown
# PROJECT_CONFIG

<!-- section:domains -->
```yaml
declared_domains:
  - fe
  - be
design_hook_domains:
  - fe
detection_rules:
  fe_signals: [ui, screen, navigation, component, hook]
  be_signals: [endpoint, contract, migration, schema, auth]
decomposition_rule: one-subtask-per-domain
escalation_rule: emit blocker-escalation-report when signals match an undeclared domain
```
<!-- /section:domains -->

<!-- section:fe -->
```yaml
skills: []
plugins: []
baseline_anchor: fe-baseline
validation_rules: []
forbidden_actions: []
```
<!-- /section:fe -->

<!-- section:fe-baseline -->
```yaml
framework: <detected-or-ask>
router: <detected-or-ask>
data_layer: <detected-or-ask>
```
<!-- /section:fe-baseline -->

<!-- section:be -->
```yaml
skills: []
plugins: []
baseline_anchor: be-baseline
validation_rules: []
forbidden_actions: []
```
<!-- /section:be -->

<!-- section:be-baseline -->
```yaml
framework: <detected-or-ask>
runtime: <detected-or-ask>
```
<!-- /section:be-baseline -->

<!-- section:api-baseline -->
```yaml
style: <rest|graphql|rpc>
auth: <jwt|session|oauth>
```
<!-- /section:api-baseline -->

<!-- section:auth-baseline -->
```yaml
provider: <detected-or-ask>
session_model: <detected-or-ask>
```
<!-- /section:auth-baseline -->

<!-- section:project-best-practices -->
- single-fact-per-artifact
<!-- /section:project-best-practices -->

<!-- section:agent-best-practices -->
lead: []
executor: []
reviewer: []
<!-- /section:agent-best-practices -->

<!-- section:extra-trigger-keywords -->
```yaml
# project-specific keyword overlays (unioned with TRIGGER_RULES.md)
```
<!-- /section:extra-trigger-keywords -->

<!-- section:cross-domain-rules -->
```yaml
# rules that span multiple domains (read by delivery-pm)
rules: []
```
<!-- /section:cross-domain-rules -->

<!-- section:quality-gates -->
```yaml
# commands that executors and reviewers run to verify a change
test: <detected-or-ask>
lint: <detected-or-ask>
typecheck: <detected-or-ask>
build: <detected-or-ask>
```
<!-- /section:quality-gates -->
```

## Validation Rules (MANDATORY before the init agent writes)

The emitted text must parse under these exact regex literals from `${CLAUDE_PLUGIN_ROOT}/hooks/evaluate-triggers.js`:

- **Section regex** (line 48-49): `<!--\s*section:([a-z0-9-]+)\s*-->([\s\S]*?)<!--\s*/section:\1\s*-->`
- **Agent-map line** (line 63): `^([A-Za-z][A-Za-z0-9_-]*):\s*(\[\s*\])?\s*$`
- **List-item line** (line 70): `^\s*-\s+(.+?)\s*$`

Before returning, the init agent must compile each emitted `<!-- section:... -->` block and confirm round-trip extraction works. Any deviation aborts the write with a diagnostic.

## Rules

- Every anchor listed above MUST be present, even when its value is `[]` or a comment-only YAML block.
- Fill every field from evidence or a user answer — never invent or paraphrase.
- Preserve the exact anchor names. No typos, no case differences, no extra whitespace inside the `<!-- section:... -->` comment.
- `declared_domains` must match the set of `<!-- section:<domain> -->` blocks that follow.
- `design_hook_domains` ⊆ `declared_domains`.
- `api-baseline` and `auth-baseline` are present only when BE is declared.
- Trailing newline is required at end-of-file.

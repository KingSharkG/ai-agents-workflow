# PROJECT_CONFIG.md skeleton

The canonical skeleton emitted by `project-config-template` at init. Required-anchor presence and ordering are load-bearing — see SKILL.md → "Required Anchors (v1)" and "Validation Rules".

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

For `fe`-only or `be`-only projects, drop the unused domain and its baseline; trim `declared_domains` accordingly. Include `api-baseline` and `auth-baseline` only when BE is present.

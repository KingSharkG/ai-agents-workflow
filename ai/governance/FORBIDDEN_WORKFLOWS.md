# FORBIDDEN_WORKFLOWS

Authoritative denylist of skills and subagents that MUST NOT be invoked from inside the ai-agents-workflow pipeline.

These entries orchestrate competing end-to-end workflows. If a Lead / Executor / Reviewer (or any agent except the user) invokes one, the entry short-circuits the pipeline: artifacts stop updating, the review loop is bypassed, and `/continue` cannot resume the task. Helper plugins (library docs, design tooling, database schema) are NOT on this list — only workflow orchestrators are.

Enforcement:

1. Prompt level — Lead / Executor / Reviewer contracts reference this file and refuse invocation.
2. Bundle level — `context-minimizer` strips these entries from the dispatch bundle's Project Context `plugins:` list even if they appear in `PROJECT_CONFIG.md`.
3. Hook level — `hooks/guard-forbidden-workflows.js` blocks matching `Task` and `Skill` PreToolUse calls with exit 1.

<!-- section:denylist -->

## Denylist

```yaml
# Each entry: exact identifier (supports "*" tail wildcard).
# "replacement" is a short hint for the block-message; keep it actionable.
# "applies_to" scopes enforcement: "all" blocks every agent;
#   listing roles blocks only those roles (other roles may still invoke the entry).
entries:
  - id: feature-dev:feature-dev
    kind: skill
    applies_to: all
    replacement: "ai-agents-workflow lead + codebase-exploration + multi-approach-architecture"
  - id: feature-dev:code-architect
    kind: subagent
    applies_to: all
    replacement: "ai-agents-workflow:lead (with multi-approach-architecture skill when complexity >= medium)"
  - id: feature-dev:code-explorer
    kind: subagent
    applies_to: all
    replacement: "ai-agents-workflow:lead (with codebase-exploration skill)"
  - id: feature-dev:code-reviewer
    kind: subagent
    applies_to: all
    replacement: "ai-agents-workflow:reviewer"
  - id: superpowers:brainstorming
    kind: skill
    applies_to: [lead, executor, reviewer, delivery-pm, design-agent, integration-checker]
    replacement: "orchestrator owns intake + delivery planning; do not re-brainstorm inside execution roles"
  - id: superpowers:writing-plans
    kind: skill
    applies_to: [lead, executor, reviewer, design-agent, integration-checker]
    replacement: "delivery-pm owns plan authoring via the delivery-plan skill"
  - id: superpowers:executing-plans
    kind: skill
    applies_to: [lead, reviewer, delivery-pm, design-agent, integration-checker]
    replacement: "executor is the only role allowed to run executing-plans"
  - id: superpowers:subagent-driven-development
    kind: skill
    applies_to: all
    replacement: "chief-orchestrator owns subagent dispatch via orchestrator-dispatch"
  - id: superpowers:dispatching-parallel-agents
    kind: skill
    applies_to: [executor, reviewer, delivery-pm, design-agent, integration-checker]
    replacement: "only chief-orchestrator and lead (via codebase-exploration) may fan out parallel subagents"
  - id: pr-review-toolkit:review-pr
    kind: skill
    applies_to: all
    replacement: "reviewer owns review via the review-report skill; this competing orchestrator bypasses the Cycle N cadence"
  - id: pr-review-toolkit:code-reviewer
    kind: subagent
    applies_to: all
    replacement: "ai-agents-workflow:reviewer"
  - id: code-review:code-review
    kind: skill
    applies_to: all
    replacement: "reviewer owns review via the review-report skill; this competing orchestrator bypasses the Cycle N cadence"
```

<!-- /section:denylist -->

<!-- section:allowed-helpers -->

## Allowed Helpers (non-exhaustive)

These stay allowed for all roles that reference them in their contract or dispatch bundle:

- `context7:*` — library / SDK docs
- `figma:*` — design-system tooling (design-agent primarily)
- `supabase:*` — database / auth helpers (per-domain)
- `claude-api` — Claude API / Anthropic SDK helper
- `superpowers:test-driven-development` — executor / reviewer
- `superpowers:systematic-debugging` — any role
- `superpowers:verification-before-completion` — executor / reviewer
- `superpowers:receiving-code-review` — executor (on rework)
- `superpowers:finishing-a-development-branch` — chief-orchestrator only
- `code-simplifier`, `simplify` — executor (cleanup pass)

If a helper you need is not listed here AND not in `ai/governance/RESOLUTION_POLICY.md#<!-- section:registry -->`, emit a `blocker-escalation-report` with `blocker_type: environment-capability-gap` — do not silently substitute.

<!-- /section:allowed-helpers -->

<!-- section:adding-entries -->

## Adding a new entry

1. Justify in the PR description why the skill/subagent orchestrates a competing workflow (multi-step pipeline, own review loop, own dispatch).
2. Add it under `<!-- section:denylist -->` with a concrete `replacement` hint.
3. Update `ai/governance/RESOLUTION_POLICY.md` to remove / reclassify the entry so the two files agree.
4. No code changes required in `hooks/guard-forbidden-workflows.js` — it reads this file at invocation time.

<!-- /section:adding-entries -->

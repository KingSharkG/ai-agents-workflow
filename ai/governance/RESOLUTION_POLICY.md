# RESOLUTION_POLICY

Canonical policy for how agents resolve skills and plugins. Covers the resolution order, the fixed skill catalogs (global, reviewer, external), the approved plugin registry, intake/deprecation procedures, and the joint skill + plugin budget.

Any plugin not listed in `<!-- section:registry -->` with `status: approved` (or `trial`) MAY NOT be invoked. Using an unlisted or `deprecated` plugin is a hard blocker.

Some skills and plugins (e.g. `feature-dev:*`, `pr-review-toolkit:review-pr`, `superpowers:writing-plans`) orchestrate their own end-to-end workflows. They are not blocked, but invoking them is a Reviewer-enforced responsibility: any work whose artifact trail (TEP / `ai-work.md` / `review-report`) is missing or routed around the Cycle N rework loop will be rejected at review.

## Fixed Before Dynamic

1. Agent-fixed skills (see `## Skills & Plugins` in each agent file, plus the role-generic sections below: `<!-- section:global-skills -->`, `<!-- section:reviewer-skills -->`).
2. Domain-fixed skills from `<artifact-root>/config/PROJECT_CONFIG.md#<!-- section:<domain> -->` → `skills`. Domain-fixed skills are not declared in this file — they live entirely in the project overlay, so adding a new domain requires no change here.
3. Registry plugins (`<!-- section:registry -->`) — the single entry point for all plugins, whether MCP servers, Claude built-ins, or marketplace-distributed.
4. External skills (`<!-- section:external-skills -->`) — informational prefix-indexed mapping from skill prefix to provider plugin.
5. `npx skills find` as last resort.
6. Record dynamic skills used in Implementation Report. If nothing resolves, emit a `blocker-escalation-report` with `blocker_type: environment-capability-gap`.

<!-- section:global-skills -->

## Global Fixed Skills

- artifact discipline
- assumption logging
- blocker detection
- scope discipline
- token-saving behavior

<!-- /section:global-skills -->

<!-- section:reviewer-skills -->

## Reviewer Fixed Skills

- correctness review
- architecture review
- test adequacy review
- auth/security review
- performance review

<!-- /section:reviewer-skills -->

<!-- section:external-skills -->

## External Skills (Environment-Provided)

The following skills are referenced in agent contracts but provided by the tool environment (Claude Desktop, MCP plugins) — they do not exist as files in this repo. Each prefix maps to a plugin listed in `<!-- section:registry -->`; consult that row for `source` and `allowed_roles`.

| Prefix               | Skills                                                                                                                                                                                                          | Source                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `superpowers:`       | `test-driven-development`, `verification-before-completion`, `finishing-a-development-branch`, `systematic-debugging`, `receiving-code-review`, `brainstorming`, `writing-plans`, `dispatching-parallel-agents`, `executing-plans`, `subagent-driven-development` | `claude-builtin`         |
| `frontend-design:`   | `frontend-design`                                                                                                                                                                                               | `claude-builtin`         |
| `figma:`             | `figma-use`, `figma-implement-design`, `figma-generate-library`, `figma-code-connect`                                                                                                                           | `mcp-server` (`figma`)   |
| `pr-review-toolkit:` | `silent-failure-hunter`, `pr-test-analyzer`, `review-pr`, `code-reviewer`                                                                                                                                       | `claude-builtin`         |
| `code-review:`       | `code-review`                                                                                                                                                                                                   | `claude-builtin`         |
| `feature-dev:`       | `code-explorer`, `code-architect`, `code-reviewer`, `feature-dev`                                                                                                                                               | `claude-builtin`         |

For codebase-aware exploration and multi-option architecture, prefer ai-agents-workflow's `codebase-exploration` and `multi-approach-architecture` skills — they integrate directly with the TEP / `ai-work.md` artifact chain. `feature-dev:*` may still be invoked as a helper, but its output must be routed back through the artifact chain or Reviewer will reject the subtask.

If an agent references one of these and the environment does not provide it, the agent MUST emit a `blocker-escalation-report` (`blocker_type: environment-capability-gap`) rather than silently skipping.

<!-- /section:external-skills -->

<!-- section:external-sources -->

## External Sources

Taxonomy of source types used in `<!-- section:registry -->` and `<!-- section:external-skills -->`. Every registry row declares exactly one `source` plus a `source_ref` describing how the plugin resolves at runtime.

| source                  | meaning                                                                  | resolution                                                                            |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `local-plugin`          | This plugin's own agents / skills.                                       | Path under `${CLAUDE_PLUGIN_ROOT}`.                                                   |
| `mcp-server`            | MCP plugin already installed in the harness.                             | `source_ref` = MCP server id (visible via `/plugin`).                                 |
| `claude-builtin`        | Skill-provider plugin bundled in Claude Code.                            | `source_ref` = skill prefix (e.g. `superpowers:`, `pr-review-toolkit:`).              |
| `github-marketplace`    | Plugin distributed via a GitHub marketplace.                             | `source_ref` = `<owner>/<repo>`; consumer must run `/plugin marketplace add`.         |
| `consumer-marketplace`  | Marketplace the consumer added locally via `/plugin marketplace add`.    | `source_ref` = marketplace slug.                                                      |
| `npx-skills-find`       | Dynamic skill discovered at runtime.                                     | `source_ref = -`; governed by the dynamic-skill budget in `<!-- section:skill-budget -->`. |

Intake rule: new rows with `source ∈ {consumer-marketplace, npx-skills-find}` enter at `status: trial`.

`source_ref` is NOT version-pinned. Consumers pin specific versions via their own `/plugin` state, not via this registry.

<!-- /section:external-sources -->

<!-- section:registry -->

## Plugin Registry

| name              | source            | source_ref            | purpose                                                    | allowed_roles                                                                                              | cost_tier | status   |
| ----------------- | ----------------- | --------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------- | -------- |
| `context7`        | `mcp-server`      | `context7`            | Current library / framework / SDK documentation lookup     | lead (base), executor (base), init (base), delivery-pm (base), design-agent (base)                         | low       | approved |
| `filesystem`      | `mcp-server`      | `filesystem`          | Scoped filesystem access for read-only path exploration    | lead (base), init (base)                                                                                   | low       | approved |
| `github`          | `mcp-server`      | `github`              | PR diffs, issues, CI status, repo metadata                 | chief-orchestrator, reviewer, integration-checker; lead/executor per `PROJECT_CONFIG.md#<domain>.plugins`   | low       | approved |
| `figma`           | `mcp-server`      | `figma`               | Figma file / node / image access and design-system tooling | design-agent; lead/executor per `PROJECT_CONFIG.md#<domain>.plugins`                                        | medium    | approved |
| `superpowers`     | `claude-builtin`  | `superpowers:`        | Workflow skills (TDD, debugging, brainstorming, plans)     | all roles (skill provider)                                                                                 | low       | approved |
| `frontend-design` | `claude-builtin`  | `frontend-design:`    | Frontend-design skill                                      | design-agent; lead/executor per `PROJECT_CONFIG.md#<domain>.plugins`                                        | low       | approved |
| `pr-review-toolkit` | `claude-builtin` | `pr-review-toolkit:`  | PR review tooling                                          | reviewer, chief-orchestrator                                                                               | low       | approved |
| `code-review`     | `claude-builtin`  | `code-review:`        | Code-review skill                                          | reviewer                                                                                                   | low       | approved |

**Role model:** `lead` and `executor` are generic. The `allowed_roles` column lists hard assignments (e.g., `chief-orchestrator` owns `github` regardless of project). Per-domain plugin assignments for lead/executor are declared in `<artifact-root>/config/PROJECT_CONFIG.md#<!-- section:<domain> -->` → `plugins`. The merged allowlist for any subtask is `base_plugins ∪ PROJECT_CONFIG.<domain>.plugins`; invoking outside that union is a hard blocker.

<!-- /section:registry -->

<!-- section:fields -->

## Fields

- **name** — plugin identifier as invoked by the harness; this is what a consumer writes in `PROJECT_CONFIG.md`.
- **source** — one of the source types defined in `<!-- section:external-sources -->`.
- **source_ref** — provenance detail: MCP server id, Claude built-in prefix, marketplace slug, `<owner>/<repo>`, or `-` for `npx-skills-find`.
- **purpose** — one-line description of intended use.
- **allowed_roles** — roles permitted to invoke the plugin. Other roles MUST NOT call it.
- **cost_tier** — `low | medium | high`. Contributes to `telemetry.plugins_cost` accounting.
- **status** — `approved | trial | deprecated`.
  - `approved`: free to use within `allowed_roles`.
  - `trial`: usable, but every run invoking it MUST set `telemetry.plugins_cost: "high"` and cite this registry row.
  - `deprecated`: MUST NOT be invoked; remove callers.

<!-- /section:fields -->

<!-- section:intake -->

## Intake — Adding a New Plugin

1. Open a PR that edits **only** `${CLAUDE_PLUGIN_ROOT}/ai/governance/RESOLUTION_POLICY.md`, proposing a new row under `<!-- section:registry -->` with all required columns filled — including `source` and `source_ref`.
2. New rows enter at `status: trial`. Rows with `source ∈ {consumer-marketplace, npx-skills-find}` MUST remain `trial` until promotion; see step 3.
3. Chief Orchestrator reviews: validates purpose, scopes `allowed_roles` to the minimum set, assigns a `cost_tier`.
4. After one successful task using the plugin under `trial`, Chief Orchestrator may promote `status: approved` in a follow-up PR.
5. While `status: trial`, every run using the plugin MUST flag `plugins_cost: "high"` regardless of count.

<!-- /section:intake -->

<!-- section:deprecation -->

## Deprecation

1. Change `status: deprecated` in `<!-- section:registry -->`.
2. Open blockers against any agent contract still referencing the plugin.
3. Remove plugin references from agent contracts (and from this file) once callers are gone.

<!-- /section:deprecation -->

<!-- section:plugin-budget -->

## Plugin Budget

Reported via `telemetry.plugins_cost` in every artifact.

- Using >2 distinct MCP plugins in a run → `plugins_cost: "high"`.
- `trial`-status plugins (see `<!-- section:fields -->`) MUST set `plugins_cost: "high"` regardless of count.
- `plugins_cost: high` combined with `dynamic_skills_cost: high` (see `<!-- section:skill-budget -->`) is a **soft blocker**: Chief Orchestrator must open a conversion review — pin plugin usage to a specific agent role, or convert dynamic skill → fixed role skill. **Conversion review** = a `blocker-escalation-report` with `blocker_type: budget-efficiency`, routed to the user (not an internal agent), listing which plugins/skills are high-cost, which runs triggered them, and a proposed lower-cost alternative for each.
- Executors MUST list plugins invoked under `plugins_used[]` in `IMPLEMENTATION_REPORT.md`, analogous to `used_dynamic_skills[]`.
- Invoking a plugin missing from `<!-- section:registry -->` (or with `status: deprecated`) is a **hard blocker**.

<!-- /section:plugin-budget -->

<!-- section:skill-budget -->

## Skill Budget (Dynamic Skills)

Applies to dynamic skills only. Reported via `telemetry.dynamic_skills_cost` in every artifact.

- Using >2 dynamic skills in a run → `dynamic_skills_cost: "high"`.
- `dynamic_skills_cost: high` combined with `plugins_cost: high` (see `<!-- section:plugin-budget -->`) is a **soft blocker**: Chief Orchestrator must open a conversion review — convert dynamic skill → fixed role skill, or pin plugin usage to a specific agent role. **Conversion review** = a `blocker-escalation-report` with `blocker_type: budget-efficiency`, routed to the user, listing high-cost plugins/skills and a proposed lower-cost alternative.
- Resolution order: agent-fixed skills → domain-fixed skills → registry plugins → external skills → `npx skills find` → stop.

<!-- /section:skill-budget -->

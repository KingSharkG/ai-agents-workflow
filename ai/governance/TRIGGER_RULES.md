# TRIGGER_RULES

<!-- section:design-agent-trigger -->

## Design Agent

Run if:

- new mobile screen
- user flow changes
- CTA hierarchy changes
- loading/error/empty state changes
- usability-sensitive form

Skip (symmetric to Lead skip rules for FE subtasks) if:

- new screen follows an existing pattern in the codebase
- CRUD form with no new CTAs, flows, or state variants
- single-file style or copy change

When skipping, Delivery PM MUST include a one-line justification in the subtask (`design_skip_reason: ...`).

<!-- /section:design-agent-trigger -->

<!-- section:domain-validation-note -->

## Domain Validation

There is no separate Domain Agent. Domain validation is absorbed by the Lead for the subtask's `domain`. The specific validation rules for each domain live in `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:<domain> -->` → `validation_rules`.

Leads may escalate ambiguous domain rules via `blocker-escalation-report` when requirements are insufficient.

<!-- /section:domain-validation-note -->

<!-- section:fe-triggers -->

## Lead — FE triggers

Run Lead (domain: fe) if:

- `complexity: hard` (automatic)
- design-agent trigger fired for the subtask
- business statuses, lifecycle transitions, permission/role changes, or auth-flow semantics affect FE behavior (domain validation — Lead absorbs; no separate Domain Agent)
- navigation architecture changes
- new shared hook or abstraction pattern
- core data-layer architecture changes for the domain (per `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:fe-baseline -->` / domain `validation_rules`)
- new frontend dependency introduced
- large FE diff (5+ files or cross-feature)

Skip (executor goes direct) if:

- `complexity: low`
- new screen following an existing pattern
- wiring existing hooks/components to a new endpoint
- single-file style or copy change

<!-- /section:fe-triggers -->

<!-- section:be-triggers -->

## Lead — BE triggers

Run Lead (domain: be) if:

- `complexity: hard` (automatic)
- new REST contract affecting multiple consumers
- auth/permission model changes (not just adding a guard to an existing route)
- cross-module schema change or new FK relationships
- new backend dependency introduced
- ambiguous requirements flagged by Delivery PM
- business statuses, lifecycle transitions, or permission/role changes (domain validation — no separate Domain Agent for BE)

Skip (executor goes direct) if:

- `complexity: low`
- pure schema migration already specified in the Delivery Plan
- seed script or utility script
- single-module CRUD following an established pattern in the codebase

<!-- /section:be-triggers -->

<!-- section:integration-trigger -->

## Integration Checker

Run if:

- both FE and BE changed
- request/response contracts changed
- auth expectations changed
- nullability/field shape may differ
- the Delivery Plan marks `integration_gate: required`

**On `verdict: NOT ok`:** The Integration Checker MUST include `fix_owner: fe | be | both` in the report with a one-sentence rationale identifying which side introduced the mismatch. The Orchestrator routes the fix to the identified executor(s). The Reviewer MUST NOT approve the subtask until a follow-up Integration Checker run returns `verdict: ok`. The Reviewer cannot substitute their own integration check for IC's verdict.

**Mandatory gate rule:** If the subtask spec or project rule says the IC gate is required, the subtask's `workflow_state` remains `pending-integration-check` until the IC returns `verdict: ok`. A clean code review alone is insufficient to close that subtask.

<!-- /section:integration-trigger -->

<!-- section:acceptance-evidence -->

## Acceptance Evidence States

Every acceptance signal recorded in `<subtask_id>/summary.md` MUST carry:

- `State`: `pass | fail | deferred | blocked | pending`
- `Evidence`: `executed | inspected | deferred | blocked | pending`

Rules:

- Runtime, simulator, device, network, auth-flow, and manual-QA behaviors may be `State: pass` only when `Evidence: executed`.
- Static structure, type-shape, and code-layout checks may be `State: pass` with `Evidence: inspected`.
- If execution is not possible in the current environment, record `State: deferred` or `blocked` instead of promoting it to `pass`.
- The Reviewer finalizes these values; stale placeholder rows are invalid.

<!-- /section:acceptance-evidence -->

<!-- section:context-hygiene -->

## Context Hygiene (Orchestrator Rule)

Between agent runs the orchestrator MUST:

- Keep only the produced artifact path and its structured summary fields. Raw agent output, intermediate tool calls, and file dumps are discarded.
- When dispatching the next agent, pass only: (a) prior artifact(s) by reference, (b) governance excerpts required by the target role, (c) nothing from earlier agents' scratch reasoning.
- Never paste a previous agent's verbose output into the next prompt — only the artifact.

Subagent spawns give fresh context by construction; this rule closes the orchestrator-side leak.

<!-- /section:context-hygiene -->

<!-- section:definition-of-ready -->

## Definition of Ready (Executor Dispatch Gate)

### Standard path (Lead creates TEP)

The orchestrator MUST NOT dispatch the Executor unless `<!-- section:tep -->` in the subtask's `ai-work.md` has:

- Every `target_file` verified to exist.
- A populated `context_bundle` (executor needs no other files).
- `complexity` and `turns_budget` copied from the Delivery Plan.
- `acceptance_signals` present and observable.

If any gate fails, route back to the Lead for the subtask's domain or raise a Blocker Escalation Report.

### Lightweight path (`complexity: low`, no Lead trigger)

The orchestrator may dispatch the executor directly using `<!-- section:spec -->` from the subtask's `ai-work.md` (pre-populated by the orchestrator from `task-data.md` at skeleton-creation time). Gates:

- no `design-agent` trigger fired for the subtask
- `target_files` listed (best-effort; executor verifies with its own tools).
- `context_bundle` is **optional** — executor reads target files directly.
- `complexity` and `turns_budget` present.
- `acceptance_signals` present.

The executor MUST still append to `<!-- section:implementation -->` in `ai-work.md` and go through Review, **unless** the subtask also qualifies for the ultra-light tier (see `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:ultra-light-tier -->`), in which case the compact `impl-ultra` / `review-ultra` blocks are used inside those same sections.

<!-- /section:definition-of-ready -->

<!-- section:telemetry-gate -->

## Telemetry Gate

Every agent MUST write diagnostics to `<subtask_id>/summary.md`:
- One telemetry line under `## Telemetry`
- One `### <role>` subsection under `## Context Manifest`

The orchestrator creates the summary.md skeleton (with diagnostic section placeholders) alongside the ai-work.md skeleton. Diagnostics are NOT written to ai-work.md.

**Exception:** ultra-light `impl-ultra` / `review-ultra` compact blocks still require telemetry lines in summary.md.

For `task-data.md` (task-packet and delivery-plan sections), the agent appends telemetry inside `<!-- section:task-telemetry -->` and `<!-- section:delivery-telemetry -->` respectively.

Authoritative format: `${CLAUDE_PLUGIN_ROOT}/ai/playbooks/ORCHESTRATION.md` → `<!-- section:telemetry -->` and `<!-- section:context-manifest -->`.

Policy:

- `<subtask_id>/summary.md` missing after agent's turn → orchestrator routes back to the agent.
- `OVER_BUDGET` is a **soft blocker**: Delivery PM re-scopes before another cycle; it is NOT a reason to retry with a larger budget silently.

<!-- /section:telemetry-gate -->

<!-- section:turn-budgets -->

## Complexity-Based Turn Budgets

### Executor budgets (per subtask)

| complexity | turns_budget |
| ---------- | ------------ |
| low        | 3            |
| medium     | 6            |
| hard       | 10           |

### Non-executor budgets (per invocation)

| role                    | turns_budget                   |
| ----------------------- | ------------------------------ |
| Delivery PM             | 4                              |
| Lead                    | 4 (low) / 6 (medium) / 8 (hard) |
| Reviewer                | 3 per cycle                    |
| Design Agent            | 3                              |
| Integration Checker     | 3                              |

A runaway agent exceeding its budget is a blocker, not a reason to raise the cap.

<!-- /section:turn-budgets -->

<!-- section:rework-cap -->

## Complexity-Based Rework Cap

Maximum review/rework cycles per subtask are tied to complexity:

| complexity | max_cycles |
| ---------- | ---------- |
| low        | 1          |
| medium     | 2          |
| hard       | 3          |

Exceeding the cap does **not** trigger another executor turn. The subtask auto-downgrades to `status: needs-replan` and is routed to Delivery PM (via Blocker Escalation Report) for scope / approach revision.

<!-- /section:rework-cap -->

<!-- section:trigger-keywords -->

## Trigger Keywords (Observation Hook)

Stack-agnostic keyword lists consumed by `.claude/hooks/evaluate-triggers.js`. The hook substring-matches these (case-insensitive) against the current artifact text and emits a non-blocking "recommended to run" hint before an agent dispatch. Authoritative routing still lives in the trigger sections above — this is only a heuristic surface hint.

Keys are canonical agent names (same as `.claude/agents/<name>.md`). Values are keyword arrays. A project may add stack-specific keywords without editing this file by populating `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:extra-trigger-keywords -->` (optional; the hook unions both). If this section is missing or malformed, the hook exits 0 with no hint.

Adding a new conditional agent = add a new key here; no hook code change required.

```yaml
design-agent:
  - new screen
  - user flow
  - cta hierarchy
  - loading state
  - error state
  - empty state
  - usability
  - form layout

lead:
  # fe-side signals (generic)
  - navigation architecture
  - data fetching
  - frontend dependency
  - large fe diff
  - reusable
  - abstraction
  - auth flow
  - auth semantic
  # be-side signals (generic)
  - rest contract
  - db schema
  - migration
  - auth permission
  - backend dependency
  - module boundary
  - endpoint
  # shared domain-validation signals
  - business status
  - lifecycle
  - state transition
  - permissions
  - roles
  - business logic
  - ambiguous

integration-checker:
  - both fe and be
  - request/response
  - contract
  - auth expectation
  - nullability
  - field shape
  - fe and be changed
```

<!-- /section:trigger-keywords -->

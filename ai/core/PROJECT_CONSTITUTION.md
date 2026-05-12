# PROJECT_CONSTITUTION

## Version

v1.4

## Change Log

- v1.4
  Changed from: role responsibilities scattered across nine `agents/<role>.md` role-contract blocks with no cross-role comparison surface; chief-orchestrator hard rule 10 pointed at a "role-to-task-type table" that did not exist anywhere.
  To: a canonical "Role Boundaries" table lives in this constitution and is the single source of truth for who owns which work type and which dispatch tool routes there. Per-role contracts in `agents/<role>.md` continue to govern *how* each role does its job; this table governs *which* role to dispatch.
  Reason: Close the rationalization gap that produced CAKE-5997 (chief edited consumer-repo source files itself). Rule 10 now points at a real, scannable table; readers no longer need to grep nine files to answer "who does X?".

- v1.3
  Changed from: constitution carried Project Scope, Primary Stack (fe-stack, be-stack, package manager), Auth and Security Baseline, and API Baseline inline.
  To: all project-specific overlay (stack, domains, baselines, auth, API, commands, naming, environments, quality gates) lives in `<artifact-root>/config/PROJECT_CONFIG.md`. The constitution holds only portable governance.
  Reason: Finish the portability consolidation started in v1.2. A new project or new domain requires zero edits to this file.

- v1.2
  Changed from: four stack-specific role contracts (fe-lead, be-lead, fe-executor, be-executor) with stack knowledge baked in.
  To: two generic role contracts (lead, executor) that are stack-agnostic; stack knowledge layers in at runtime from `<artifact-root>/config/PROJECT_CONFIG.md` keyed by the subtask's `domain` tag.
  Reason: Make the orchestration framework portable across projects (FE-only, BE-only, mixed). Adding a new domain is one new section in `<artifact-root>/config/PROJECT_CONFIG.md` with zero changes to canonical contracts.

- v1.1
  Changed from: artifact footer rules that specified only a minimal telemetry line.
  To: a canonical artifact footer contract requiring both `## Context Manifest` with a totals line and a telemetry footer that records turns, tokens, dynamic-skill cost, plugin cost, and budget status.
  Reason: Align governance, templates, and validators so workflow artifacts are auditable and do not drift across roles.

## Purpose

Stable source of truth for project-wide engineering, orchestration, and governance rules.

## Project-Specific Overlay

All project-specific rules — stack, domains, baselines (fe, be, api, auth), commands, paths, naming conventions, environments, quality gates, and role overlays — live in `<artifact-root>/config/PROJECT_CONFIG.md`. This document holds only portable governance; adding a new domain or swapping the stack must not require edits here.

## Naming Convention

Agent and role identifiers use **kebab-case** in code, IDs, file paths, frontmatter, dispatch arguments, and structured artifact fields: `chief-orchestrator`, `delivery-pm`, `design-agent`, `integration-checker`. Use **Title Case** only in plain English prose (e.g. "the Chief Orchestrator routes…"). Mixed casing in code or markers is a hard violation; mixed casing in prose is a nit. Hooks and validators match identifiers case-insensitively as a courtesy, but new code MUST author lowercase kebab-case to stay forward-compatible with stricter validators.

## Global Workflow Rules

- Every agent works in a fresh context.
- Every handoff uses structured artifacts.
- No silent scope changes.
- Review/rework cycle cap is complexity-tied — see `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:rework-cap -->`.
- If FE and BE both change, run Integration Checker unless explicitly waived.
- Every dispatched agent must write the diagnostics footer (telemetry line + context manifest subsection) to `<subtask_id>/summary.md` — NOT to `ai-work.md`. Canonical procedure: `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-telemetry/references/artifact-footer-protocol.md`. Do not restate elsewhere.
- Chief Orchestrator aggregates per-subtask telemetry into `<artifact-root>/tasks/<task_id>/summary.md`.

## Repo Layout Rule

- `ai/` holds governance and agent contracts only — never task-scoped reports, plans, or summaries.
- Task-scoped artifacts live under `<artifact-root>/tasks/<task_id>/` with this structure:
  - `task-data.md` — task packet + delivery plan (combined, two sections)
  - `summary.md` — task-level completion record (created after task done; replaces `telemetry_summary.md`)
  - `[phase-X/]<subtask_id>/ai-work.md` — all agent context transfer for that subtask, sectioned, append-only
  - `[phase-X/]<subtask_id>/summary.md` — subtask completion record (written by Reviewer on approval)

The canonical list of `<!-- section:* -->` markers used in these artifacts — including writer, readers, location, and required/optional/conditional status — lives in [`ai/core/SECTION_MARKERS.md`](SECTION_MARKERS.md). Add a row there before introducing a new marker; renames must update writers, `context-minimizer`, and validation hooks in lockstep.

<!-- section:definition-of-done -->

## Definition of Done

A subtask is done only when **all** of the following hold:

- code is implemented
- relevant tests pass
- Reviewer approves with `review_verdict: approved` and zero unresolved high/medium confidence-filtered findings (see `${CLAUDE_PLUGIN_ROOT}/ai/governance/REVIEW_CHECKLIST.md` → `<!-- section:severity -->`)
- architecture issues are closed or explicitly waived
- if the Integration Checker was triggered (per `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:integration-trigger -->`), its report carries `verdict: ok`
- every acceptance signal in `<subtask_id>/summary.md` is `State: pass` with an appropriate `Evidence` (`executed` for runtime/auth/network/device/manual-QA; `inspected` for static/type/layout). `deferred` / `blocked` / `pending` rows MUST be explicitly escalated, not silently treated as done.
- `<subtask_id>/summary.md` exists, is finalized (no placeholder text), and `workflow_state` is one of `approved | blocked-on-user | pending-integration-check` (NOT `in-progress` / `needs-replan`)

<!-- /section:definition-of-done -->

<!-- section:role-boundaries -->

## Role Boundaries

Canonical mapping of work type → owning role → dispatch tool. The chief-orchestrator dispatches; it never implements. If you cannot find your work type below, the chief-orchestrator is not the owner — escalate or re-classify before acting.

| Work type | Owning role | How chief-orchestrator routes there |
|-----------|-------------|--------------------------------------|
| Code changes (any `Edit`/`Write` to source files; mutation `Bash` against the consumer repo) | Executor | `Task(subagent_type: ai-agents-workflow:executor)` |
| Code review / acceptance gating / `<!-- section:review -->` finalization / subtask `summary.md` finalization | Reviewer | `Task(subagent_type: ai-agents-workflow:reviewer)` |
| Delivery plan / scope split / dependency graph / blocker analysis (the artifact P1 approves) | Delivery PM | `Task(subagent_type: ai-agents-workflow:delivery-pm)` |
| Technical Execution Packet (TEP) shaping; codebase exploration notes; multi-approach architecture options | Lead | `Task(subagent_type: ai-agents-workflow:lead)` |
| UX flows / CTA hierarchy / loading-empty-error states / Design Review Addendum | Design Agent | `Task(subagent_type: ai-agents-workflow:design-agent)` |
| FE/BE contract compatibility (auth, field names, nullability, request/response shapes) | Integration Checker | `Task(subagent_type: ai-agents-workflow:integration-checker)` |
| Workflow artifacts under `<artifact-root>/**` — **per-task** (`task-data.md`, `orchestration-state.json`, `orchestration-history.json`, task-level `summary.md`) **and per-subtask** (`ai-work.md` skeleton, `summary.md` skeleton — Reviewer finalizes them) | Chief Orchestrator | `Edit` / `Write` directly (artifact-root scoped) |
| Intake classification + 4-option AskUserQuestion popup + dispatch routing + state transitions + user gates (P1/P2/P4/P5) | Chief Orchestrator | `Skill` + `AskUserQuestion` + `Task` |

**Hard invariant.** Chief-orchestrator's `Edit` / `Write` / `Bash` tools are valid **only** for paths under `<artifact-root>/**`. Any work that requires touching consumer-repo source files MUST be dispatched via `Task(executor)`. Four blocking hooks enforce this at runtime:

| Hook | Lifecycle | Role |
|------|-----------|------|
| `hooks/guard-orchestrator-step0.js` | PreToolUse | Gates Edit/Write/Task before intake completes |
| `hooks/guard-orchestrator-source-writes.js` | PreToolUse | Blocks consumer-repo writes after intake |
| `hooks/pre-task-guard.js` | PreToolUse | Validates dispatch preconditions (P1 gate, skeleton, stage, schema) |
| `hooks/guard-chief-orchestrator-stop.js` | SubagentStop | Catches retroactive bypass attempts at turn end |

Per-role contracts (the *how*, not the *which*) live inline in [`agents/<role>.md`](../../agents/) between `<!-- role-contract:<role> -->` markers. The orchestrator-class agents (chief-orchestrator, init, resume-orchestrator) keep their procedural docs in [`ai/agents/`](../agents/).

<!-- /section:role-boundaries -->

## Allowed Change Scope

Executors may:

- modify code
- update dependencies
- change database schema
- add migrations
- update project files inside approved task scope

Executors may not:

- silently change requirements
- silently rewrite architecture rules
- silently change governance policy

## Constitution Change Policy

May be updated only when changing: portable architectural rules, review policy, handoff policy, or source-of-truth ownership rules. Stack, auth, and API specifics are overlay — edit `<artifact-root>/config/PROJECT_CONFIG.md` instead.
Allowed updaters: Chief Orchestrator, Design Agent, Lead, Reviewer.
Every change must include: version bump, what changed, why it changed.

## Token Efficiency Policy

Agents must receive only the minimum context needed:

- current artifact
- relevant task excerpts from `<artifact-root>/tasks/<task_id>/`
- relevant governance excerpt
- repo map or target file set

Do not pass: full repo by default, full chat history, long irrelevant files, full historical logs.
If an agent lacks context, it must request expansion rather than guess.

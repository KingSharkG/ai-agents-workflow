# PROJECT_CONSTITUTION

## Version

v1.3

## Change Log

- v1.3
  Changed from: constitution carried Project Scope, Primary Stack (fe-stack, be-stack, package manager), Auth and Security Baseline, and API Baseline inline.
  To: all project-specific overlay (stack, domains, baselines, auth, API, commands, naming, environments, quality gates) lives in `ai-workflow-data/config/PROJECT_CONFIG.md`. The constitution holds only portable governance.
  Reason: Finish the portability consolidation started in v1.2. A new project or new domain requires zero edits to this file.

- v1.2
  Changed from: four stack-specific role contracts (fe-lead, be-lead, fe-executor, be-executor) with stack knowledge baked in.
  To: two generic role contracts (lead, executor) that are stack-agnostic; stack knowledge layers in at runtime from `ai-workflow-data/config/PROJECT_CONFIG.md` keyed by the subtask's `domain` tag.
  Reason: Make the orchestration framework portable across projects (FE-only, BE-only, mixed). Adding a new domain is one new section in `ai-workflow-data/config/PROJECT_CONFIG.md` with zero changes to canonical contracts.

- v1.1
  Changed from: artifact footer rules that specified only a minimal telemetry line.
  To: a canonical artifact footer contract requiring both `## Context Manifest` with a totals line and a telemetry footer that records turns, tokens, dynamic-skill cost, plugin cost, and budget status.
  Reason: Align governance, templates, and validators so workflow artifacts are auditable and do not drift across roles.

## Purpose

Stable source of truth for project-wide engineering, orchestration, and governance rules.

## Project-Specific Overlay

All project-specific rules — stack, domains, baselines (fe, be, api, auth), commands, paths, naming conventions, environments, quality gates, and role overlays — live in `ai-workflow-data/config/PROJECT_CONFIG.md`. This document holds only portable governance; adding a new domain or swapping the stack must not require edits here.

## Global Workflow Rules

- Every agent works in a fresh context.
- Every handoff uses structured artifacts.
- No silent scope changes.
- Review/rework cycle cap is complexity-tied — see `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:rework-cap -->`.
- If FE and BE both change, run Integration Checker unless explicitly waived.
- Every agent must write diagnostics (telemetry line + context manifest subsection) to `<subtask_id>/summary.md` — NOT to `ai-work.md`. Authoritative format and rules: `orchestrator-telemetry` skill → Telemetry + Context Manifest sections. Do not restate them elsewhere.
- Chief Orchestrator aggregates per-subtask telemetry into `ai-workflow-data/tasks/<task_id>/summary.md`.

## Repo Layout Rule

- `ai/` holds governance and agent contracts only — never task-scoped reports, plans, or summaries.
- Task-scoped artifacts live under `ai-workflow-data/tasks/<task_id>/` with this structure:
  - `task-data.md` — task packet + delivery plan (combined, two sections)
  - `summary.md` — task-level completion record (created after task done; replaces `telemetry_summary.md`)
  - `[phase-X/]<subtask_id>/ai-work.md` — all agent context transfer for that subtask, sectioned, append-only
  - `[phase-X/]<subtask_id>/summary.md` — subtask completion record (written by Reviewer on approval)

<!-- section:definition-of-done -->

## Definition of Done

A subtask is done only when:

- code is implemented
- relevant tests pass
- Reviewer approves
- architecture issues are closed or explicitly waived
- `<subtask_id>/summary.md` exists (written by Reviewer on approval)

<!-- /section:definition-of-done -->

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

May be updated only when changing: portable architectural rules, review policy, handoff policy, or source-of-truth ownership rules. Stack, auth, and API specifics are overlay — edit `ai-workflow-data/config/PROJECT_CONFIG.md` instead.
Allowed updaters: Chief Orchestrator, Design Agent, Lead, Reviewer.
Every change must include: version bump, what changed, why it changed.

## Token Efficiency Policy

Agents must receive only the minimum context needed:

- current artifact
- relevant task excerpts from `ai-workflow-data/tasks/<task_id>/`
- relevant governance excerpt
- repo map or target file set

Do not pass: full repo by default, full chat history, long irrelevant files, full historical logs.
If an agent lacks context, it must request expansion rather than guess.

# ai-agents-workflow — Claude Code Plugin

Portable multi-agent governance layer. Packages the orchestration, lead/executor, delivery-PM, design, reviewer, integration-checker, and init roles as a single installable plugin, plus the governance skills and hook scripts listed below.

## Layout

- `.claude-plugin/plugin.json` — plugin manifest
- `.claude-plugin/marketplace.json` — local marketplace entry
- `agents/` — ten subagent definitions (chief-orchestrator, lead, executor, delivery-pm, design-agent, reviewer, integration-checker, init, resume-orchestrator, pr-lessons-harvester).
- `skills/` — 28 governance skills, each at `skills/<name>/SKILL.md` (flat layout required by Claude Code's plugin skill loader, which only discovers one directory level deep). Conceptual grouping is preserved via the `stage:` frontmatter field on every SKILL.md; the groups below are documentation-only and do not appear in the on-disk path.
  - **Task-pipeline stages** (`stage:` value on each skill — used during a single task's lifecycle):
    - `intake` — `orchestrator-intake`, `task-packet`
    - `planning` — `delivery-plan`, `technical-execution-packet`, `multi-approach-architecture`, `codebase-exploration`, `plan-addendum`
    - `execution` — `implementation-report`, `review-report`, `integration-check`
    - `closure` — `post-task-review`
    - `shared` — cross-cutting orchestration skills used in every task stage: `orchestrator-state`, `orchestrator-dispatch`, `orchestrator-user-gates`, `orchestrator-degraded`, `orchestrator-telemetry`, `context-minimizer`, `blocker-escalation-report`, `reversal-packet`, `resolve-artifact-root`, `telemetry-summary`
  - **Side-flow groups** (independent of the task pipeline; driven by their own slash commands):
    - `project-config` — owned by `/ai-agents-workflow:init|add|update|remove`: `project-config-template`, `project-config-review`, `project-config-mutate`, `project-discovery`
    - `pr-lessons` — owned by `/ai-agents-workflow:pr-lessons` (with `pr-lessons-check` consulted by Executor and Reviewer during execution): `pr-lesson-extraction`, `pr-lessons-check`, `pr-lessons-store`
- `commands/` — eight user-facing slash commands (`init`, `add`, `update`, `remove`, `task`, `continue`, `pr-lessons`, `review`) that namespace as `/ai-agents-workflow:<command>`; thin entry-points dispatching the `init`, `chief-orchestrator`, `resume-orchestrator`, or `pr-lessons-harvester` subagent (or, for `review`, running entirely in the main thread)
- `hooks/` — Node.js hook scripts wired via `hooks/hooks.json`. Notable:
  - **UserPromptSubmit / blocking:**
    - `block-aiaw-task-in-plan-mode` — first-line plan-mode backstop on `/ai-agents-workflow:*` commands, ahead of `pre-task-guard` Phase 0.
  - **PreToolUse / blocking:**
    - `pre-task-guard` — Phase 0 plan-mode block on `Task(chief-orchestrator)` + skeleton + P1 gate + Phase 3.5 stage guard + trigger evaluation (the plan-mode block was folded in from the former standalone `check-plan-mode.js`).
    - `guard-main-thread-mutations`, `guard-orchestrator-source-writes`, `guard-orchestrator-step0` — write-side guards.
    - `guard-main-thread-skills` — Skill-call guard (allowlists `resolve-artifact-root` for command pre-flights).
  - **PreToolUse / non-blocking (audit-only):**
    - `guard-agent-reads` — Read guard.
  - **SubagentStop / blocking:**
    - `guard-chief-orchestrator-stop` — structural backstop on chief stop.
  - **PostToolUse / blocking (full):**
    - `validate-artifact-chain` — markdown/JSON artifact schema. Approved **subtask** summaries: populated `## Telemetry` (≥1 line `<agent> | N/N turns | …`) / `## Dispatch Bundles` / `## Context Manifest`. **Task-level** completion (`phase: complete`): `stage: closure`, populated `## Task Status` / `## Changes by Phase` / `## Detail` / `## Totals` / `## Dispatch Bundles` / `## Context Breakdown` (trivial relaxation: `## Task Status` only).
  - **PostToolUse / blocking (partial — structural warnings non-blocking, closure invariants blocking):**
    - `validate-orchestration-state-write` — structural/schema issues remain non-blocking WARNs (exit 0). Closure invariants are BLOCKING (exit 2): C1 (`phase=complete` ⇒ `stage=closure`), C2 (empty `pending_subtasks` / `blocked_gates` / `pending_user_actions` / `pending_subtasks_needing_rereview` + `current_subtask=null`), C3 (history seq parity), C4 (`workflow_state`/`phase` agreement), C5 (terminal closure `stage_history` entry shape **including non-empty `stage_history` array**), C6 (`phase=planned` ⇒ `stage=closure` — plan-only terminal). The retired `validate-summary-telemetry` hook's telemetry-line check folded into `validate-artifact-chain`.
  - **Shared `hooks/lib/`:** `plan-mode-check.js` (banner detector), `plan-mode-message.js` (canonical "press Shift+Tab" message), `hook-log.js` (shared append-only writer for `<artifact-root>/tasks/<task_id>/hooks.log`).
- `ai/core/PROJECT_CONSTITUTION.md` — workflow rules, Definition of Done
- `ai/governance/` — trigger rules, review checklist, artifact discipline, resolution policy (helper plugins/skills)
- `ai/playbooks/ORCHESTRATION.md` — default flow (Step 0 intake classification through Step 15 completion), dispatch bundles, orchestrator state, token-saving rules
- `ai/agents/` — canonical procedural docs for the three orchestrator-class agents NOT dispatched via `context-minimizer` bundles: `chief-orchestrator.md`, `init.md`, `resume-orchestrator.md`. Role contracts for the six dispatched agents (`delivery-pm`, `design-agent`, `executor`, `integration-checker`, `lead`, `reviewer`) live inline in `agents/<role>.md` between `<!-- role-contract:<role> -->` markers — `context-minimizer` reads that block verbatim on every dispatch.
- `ai/core/SECTION_MARKERS.md` — registry of every `<!-- section:* -->` marker used in workflow artifacts (writer, readers, location, required/optional/conditional, stage). Update before introducing a new marker.

## Paths inside this plugin

Agent stubs, role contracts, and skills reference plugin-internal docs via `${CLAUDE_PLUGIN_ROOT}/ai/...`. The Claude Code harness exports `CLAUDE_PLUGIN_ROOT` to tool subprocesses; agents resolve it by running `echo $CLAUDE_PLUGIN_ROOT` in Bash, then passing the absolute path to the `Read` tool.

## Consumer-repo expectations

`<artifact-root>` is the resolved absolute path returned by `hooks/lib/artifact-root.js` for the current consumer repo. It points at one of two supported layouts, picked at `/ai-agents-workflow:init`:

- **In-project layout** — `<cwd>/.claude/aiaw-data-<project>/`
- **Sibling layout**    — `<dirname(cwd)>/aiaw-data-<project>/`

`<project>` is `path.basename(cwd)` — the consumer-project folder name, no slugification. The in-project layout sits under `.claude/` so the project root stays clean and no `additionalDirectories` permission grant is required (Claude Code already has access to anything under CWD). Hooks resolve the root at runtime; the chief-orchestrator injects the absolute path into every dispatch bundle via the `<!-- artifact-root: ... -->` fact line. The legacy `ai-workflow-data/` directory is no longer supported — see README → "Migration from ai-workflow-data".

The plugin reads files from the consumer repo (NOT from the plugin), under `<artifact-root>/`:

- `<artifact-root>/config/PROJECT_CONFIG.md` — per-project overlay: domains, baselines, cross-domain rules, quality gates, per-domain skills/plugins, `<!-- section:extra-trigger-keywords -->`. Generated and maintained by the `init` agent.
- `<artifact-root>/config/domain-contexts.cache.md` + `domain-contexts.cache.manifest.json` — derived cache of pre-extracted PROJECT_CONFIG.md sections. The `.md` file concatenates every cached section block (anchors preserved); the manifest is written last as the completion marker. Regenerated on every `init` / `update` / `add` / `remove`; read by `context-minimizer` during bundle assembly instead of re-extracting. Never hand-edit. Contents are project-dependent — only sections present in PROJECT_CONFIG.md appear in the cache. The legacy fan-out layout (`domain-contexts/<tag>.md` + `_manifest.json`) is no longer written and gets removed on the next regeneration if present. See `skills/project-config-template/SKILL.md` → "Derived Context Cache".
- `<artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` — per-subtask artifact. Must exist before dispatching any non-exempt agent, or the `pre-task-guard` hook blocks the Task call.
- `<artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/summary.md` — per-subtask summary with diagnostics (telemetry, context manifest, dispatch bundle audit). Created by orchestrator alongside ai-work.md, finalized by Reviewer.
- Dispatch bundles are NOT persisted to disk. The orchestrator composes each bundle in memory via `context-minimizer` and embeds it inline in the Task `prompt` parameter (between `<!-- dispatch-bundle:start ... -->` and `<!-- dispatch-bundle:end -->` markers). The only on-disk record is a one-line audit entry per dispatch in `<subtask_id>/summary.md` → `<!-- section:dispatch-bundles -->`.
- `<artifact-root>/tasks/<task_id>/orchestration-state.json` — **hot** orchestrator state (execution cursor: phase, current_subtask, pending_subtasks, blocked_gates, pending_user_actions, subtask_offsets). Read before every subtask transition. **Hook-managed; NEVER hand-edit.** This file is authoritative for `pre-task-guard.js` Phases 1–4 and the Phase 3.5 stage gate. Out-of-band edits desync `last_completed_seq` from `orchestration-history.json` and cause the orchestrator to refuse further dispatches until repaired via the P4 consistency check.
- `<artifact-root>/tasks/<task_id>/orchestration-history.json` — **history** orchestrator state (`completed_subtasks[]` with validated sections + `trigger_decisions{}`). Written once per subtask completion, read only at P2/P4 gates, resume, and post-task retrospective. Split from hot state so task-history growth doesn't inflate per-dispatch read cost. See `skills/orchestrator-state/SKILL.md`.

Run `/ai-agents-workflow:init` in a new consumer project (or natural language: "initialize project config") to generate `<artifact-root>/config/PROJECT_CONFIG.md` and scaffold `<artifact-root>/tasks/`. The full slash-command surface (`init` | `add` | `update` | `remove` | `task` | `continue`) is documented in `README.md` → **Usage**.

## Lifecycle Stages

A task progresses through up to four stages — `intake | planning | execution | closure` — recorded in `orchestration-state.json` → `stage` (schema_version 3+). The `pre-task-guard.js` Phase 3.5 hook blocks subagent dispatches that don't belong to the active stage; the per-stage subagent whitelist mirrors `STAGE_AGENTS` in that hook. Stage reopens are supported as soft transitions: `execution → planning` (Reviewer `needs-replan` or P2 user-elected replan) and `closure → execution` (`reversal-packet`); the soft cap is `stage_reopen_count >= 3`. The full rule set (write-side hard rule, `exit_reason` enum, auto-diff procedure for affected subtasks) lives in `skills/orchestrator-state/SKILL.md` → "Stage Discipline". The stage-grouped 15-step procedure is in `ai/playbooks/ORCHESTRATION.md` → `<!-- section:default-flow -->`.

## Intake Classification

The `/ai-agents-workflow:task` command classifies requests into five paths (`direct-answer`, `plan-only`, `execution-trivial`, `execution-simple`, `execution-full`) at Step 0 before entering the pipeline. When the request is ambiguous (low-information imperative, conflicting signals, vague modifiers, risk-area keyword without scope), the skill asks ≤3 clarifying questions before classifying — see `skills/orchestrator-intake/SKILL.md` → Step 0a. The `orchestrator-intake` skill applies checklist-based rules — file/LOC thresholds, MUST-pass / MUST-NOT-pass conditions per path, and a fixed risk-area keyword set covering schema, API, auth, reliability, and cross-cutting concerns — to produce a `heuristic_verdict`. The skill then ALWAYS shows a four-option `AskUserQuestion` radio-button popup (`Direct answer` / `Plan only` / `Execute (lightweight)` / `Execute (full pipeline)`) with the heuristic pick marked `(Recommended)`; the user's choice becomes `final_path`. Direct answers and trivial changes still skip parts of the pipeline as before; trivial mechanical changes (typo, single-string update, single-line bump) follow a compressed flow that skips Delivery PM + P1 + Lead. See `skills/orchestrator-intake/SKILL.md` for the full rule set, `ai/agents/chief-orchestrator.md` → Intake Classification Protocol, and `ai/playbooks/ORCHESTRATION.md` → `<!-- section:trivial-flow -->`.

## Installation

See `README.md` for remote-marketplace install, local development install, and verification.

# Section Markers Registry

Single source of truth for `<!-- section:<name> -->` markers used in workflow artifacts. Writers, readers (skills + hooks), and the cache regenerator key off this file.

**When to update:** add a row whenever a skill introduces a new section, renames an existing one, or changes its location. The migration order is in [the audit plan](../../.claude/plans/from-claude-best-practices-jolly-frog.md#p4) — registry first, then refactor consumers.

**How to read each row:**
- `marker` — the literal `<name>` inside `<!-- section:<name> -->`. Closing form `<!-- /section:<name> -->` is supported but not required by all writers.
- `writer` — the skill (or agent stub) that emits the section. Plain text means the writer is the only producer; multiple writers means the section is appended-to across the dispatch chain.
- `readers` — skills, hooks, and agents that consume the section. `context-minimizer` is listed explicitly because it is the canonical bundle-assembly reader.
- `location` — the artifact file the marker lives in. Paths are relative to `<artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/` unless noted.
- `required?` — `Y` = artifact is invalid without it (validation hook fails); `O` = optional; `C` = conditional (see notes column).
- `stage(s)` — lifecycle stages where the section is written (`intake | planning | execution | closure`).

Sub-sections are listed under their parent block as indented rows (parent must be present for children to be considered).

**Casing rule:** marker names SHOULD be authored lowercase (`<!-- section:review -->`, not `<!-- section:Review -->`). Validators and the section-counter in `hooks/validate-artifact-chain.js` deliberately match case-insensitively (`/gi`) so a stray capital won't blow up a real run, but mixed-case markers are still protocol violations and may be rejected by a future stricter validator. New markers added to this registry must be lowercase, hyphen-separated, ASCII-only.

---

## ai-work.md (per-subtask artifact)

| marker | writer | readers | required? | stage(s) | notes |
|---|---|---|---|---|---|
| `task-packet` | `task-packet` skill (chief-orchestrator) | `context-minimizer`, all subagents | Y | intake | Root block. Contains every `task-*` sub-section below. |
| ↳ `task-metadata` | `task-packet` skill | `context-minimizer` | Y | intake | id, source, classification, created_at |
| ↳ `task-business-goal` | `task-packet` skill | all subagents | Y | intake | |
| ↳ `task-requirements-excerpt` | `task-packet` skill | all subagents | Y | intake | |
| ↳ `task-context-manifest` | `task-packet` skill | `context-minimizer` | Y | intake | governance/config files in scope |
| ↳ `task-scope-estimate` | `task-packet` skill | `delivery-pm` | Y | intake | rough complexity / size hint |
| ↳ `task-known-blockers` | `task-packet` skill | `delivery-pm` | O | intake | |
| ↳ `task-assumptions` | `task-packet` skill | all subagents | O | intake | |
| ↳ `task-telemetry` | `task-packet` skill | `telemetry-summary` | Y | intake | turn/token budget for intake |
| `intake-classification` | `orchestrator-intake` skill | `chief-orchestrator`, `pre-task-guard.js` | Y | intake | Records `final_path`, `heuristic_verdict`, user choice. |
| `delivery-plan` | `delivery-plan` skill (delivery-pm) | `chief-orchestrator`, `lead`, `validate-artifact-chain.js` | Y | planning | Lives in `task-data.md` (task-level) when phase split, otherwise here. |
| `spec` | `chief-orchestrator` (subtask init) | `lead`, `design-agent`, `executor`, `reviewer`, `resume-orchestrator`, `validate-artifact-chain.js` | Y | planning | Per-subtask copy of `delivery-subtask-<id>` content; written when chief creates the `ai-work.md` skeleton. See `ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:ai-work-skeleton -->`. |
| ↳ `delivery-metadata` | `delivery-plan` skill | `chief-orchestrator` | Y | planning | |
| ↳ `delivery-routing` | `delivery-plan` skill | `chief-orchestrator` | Y | planning | subtask → role mapping |
| ↳ `delivery-context-manifest` | `delivery-plan` skill | `context-minimizer` | Y | planning | |
| ↳ `delivery-telemetry` | `delivery-plan` skill | `telemetry-summary` | Y | planning | |
| ↳ `delivery-phase-<id>` | `delivery-plan` skill | `validate-artifact-chain.js` | C | planning | Required when the plan uses phase splits. |
| ↳ `delivery-subtask-<id>` | `delivery-plan` skill | `validate-artifact-chain.js` | C | planning | Required when the plan uses subtask splits. |
| `exploration-notes` | `codebase-exploration` skill (lead) | `lead`, `executor` (via bundle) | C | planning | Required when subtask `complexity ∈ {medium, hard}`. |
| ↳ `exploration-metadata` | `codebase-exploration` skill | `context-minimizer` | C | planning | |
| ↳ `exploration-entry-points` | `codebase-exploration` skill | `lead` | C | planning | |
| ↳ `exploration-layers` | `codebase-exploration` skill | `lead` | C | planning | |
| ↳ `exploration-similar-features` | `codebase-exploration` skill | `lead` | C | planning | |
| ↳ `exploration-key-files` | `codebase-exploration` skill | `lead` | C | planning | 5–10 files; every `tep-target-files` entry must appear here. |
| ↳ `exploration-open-questions` | `codebase-exploration` skill | `lead` | O | planning | |
| `architecture-options` | `multi-approach-architecture` skill (lead) | `lead`, `chief-orchestrator` | C | planning | Required when complexity ≥ medium AND approach is non-trivial. |
| ↳ `architecture-metadata` | `multi-approach-architecture` skill | `context-minimizer` | C | planning | |
| ↳ `architecture-option-a/b/c` | `multi-approach-architecture` skill | `chief-orchestrator` | C | planning | 2–3 trade-off approaches |
| ↳ `architecture-selected` | `multi-approach-architecture` skill | `lead` (TEP), `executor` | C | planning | which option won, why |
| `tep` | `technical-execution-packet` skill (lead) | `executor`, `reviewer`, `context-minimizer` | Y | planning | Root TEP block. |
| ↳ `tep-metadata` | `technical-execution-packet` skill | `context-minimizer`, `pre-task-guard.js` | Y | planning | |
| ↳ `tep-goal` | `technical-execution-packet` skill | `executor` | Y | planning | |
| ↳ `tep-non-goals` | `technical-execution-packet` skill | `executor` | O | planning | |
| ↳ `tep-target-files` | `technical-execution-packet` skill | `executor`, `reviewer` | Y | planning | Must each appear in `exploration-key-files`. |
| ↳ `tep-context-bundle` | `technical-execution-packet` skill | `executor` | Y | planning | signatures, types, contracts only |
| ↳ `tep-expected-contract` | `technical-execution-packet` skill | `executor`, `reviewer` | Y | planning | acceptance contract |
| ↳ `tep-implementation-steps` | `technical-execution-packet` skill | `executor` | Y | planning | |
| ↳ `tep-recommended-skills` | `technical-execution-packet` skill | `executor` | O | planning | menu-guard-rail-scoped |
| ↳ `tep-recommended-tests` | `technical-execution-packet` skill | `executor` | Y | planning | |
| ↳ `tep-acceptance-signals` | `technical-execution-packet` skill | `reviewer` | Y | planning | |
| ↳ `tep-risks` | `technical-execution-packet` skill | `reviewer` | O | planning | |
| ↳ `tep-clarifying-questions` | `technical-execution-packet` skill | `chief-orchestrator` | O | planning | If present, blocks Executor dispatch until user answers. |
| `plan-addendum` | `plan-addendum` skill (design-agent) | `lead`, `executor` | C | planning | Required when subtask hits a design hook. |
| ↳ `design-metadata` | `plan-addendum` skill | `context-minimizer` | C | planning | |
| ↳ `design-findings` | `plan-addendum` skill | `lead`, `executor` | C | planning | |
| ↳ `design-constraints` | `plan-addendum` skill | `executor` | C | planning | |
| ↳ `design-open-questions` | `plan-addendum` skill | `chief-orchestrator` | O | planning | |
| `implementation` | `implementation-report` skill (executor) | `reviewer`, `context-minimizer` | Y | execution | Root implementation report. |
| ↳ `impl-metadata` | `implementation-report` skill | `context-minimizer` | Y | execution | cycle, started_at, finished_at |
| ↳ `impl-summary` | `implementation-report` skill | `reviewer` | Y | execution | |
| ↳ `impl-files-changed` | `implementation-report` skill | `reviewer`, `pr-lessons-check` | Y | execution | |
| ↳ `impl-tests-run` | `implementation-report` skill | `reviewer` | Y | execution | command + outcome |
| ↳ `impl-dynamic-skills` | `implementation-report` skill | `reviewer` | O | execution | non-baseline skills invoked |
| ↳ `impl-plugins-used` | `implementation-report` skill | `reviewer` | O | execution | |
| ↳ `impl-project-state` | `implementation-report` skill | `reviewer` | O | execution | dirty/clean, migrations, etc. |
| ↳ `impl-unresolved-issues` | `implementation-report` skill | `reviewer` | O | execution | |
| `review` | `review-report` skill (reviewer) | `chief-orchestrator`, `executor` (rework), `validate-artifact-chain.js` | Y | execution | Canonical name; hook flags `review-report`/`review-cycle*` variants. |
| ↳ `review-metadata` | `review-report` skill | `context-minimizer` | Y | execution | cycle, verdict |
| ↳ `review-summary` | `review-report` skill | `chief-orchestrator` | Y | execution | |
| ↳ `review-findings` | `review-report` skill | `executor` | Y | execution | severity-tagged |
| ↳ `review-low-confidence` | `review-report` skill | `executor` | O | execution | |
| ↳ `review-resolved` | `review-report` skill | `chief-orchestrator` | C | execution | rework cycles |
| ↳ `review-verdict` | `review-report` skill | `chief-orchestrator`, `pre-task-guard.js` | Y | execution | `approved`/`needs-rework`/`needs-replan` |
| ↳ `review-completion-summary` | `review-report` skill | `chief-orchestrator` | C | closure | written on final approval |
| `integration-check` | `integration-check` skill (integration-checker) | `chief-orchestrator`, `validate-artifact-chain.js` | C | execution | Required when subtask flags integration concern. |
| ↳ `integration-metadata` | `integration-check` skill | `context-minimizer` | C | execution | |
| ↳ `integration-fe-surface` | `integration-check` skill | `reviewer` | C | execution | |
| ↳ `integration-be-surface` | `integration-check` skill | `reviewer` | C | execution | |
| ↳ `integration-findings` | `integration-check` skill | `executor`, `reviewer` | C | execution | |
| ↳ `integration-recommended-fixes` | `integration-check` skill | `executor` | C | execution | |
| ↳ `integration-verdict` | `integration-check` skill | `chief-orchestrator` | C | execution | |
| ↳ `integration-review` | `integration-check` skill | `reviewer` | O | execution | |
| ↳ `integration-context-manifest` | `integration-check` skill | `context-minimizer` | C | execution | |
| ↳ `integration-telemetry` | `integration-check` skill | `telemetry-summary` | C | execution | |
| `escalation-<n>` *(parameterized: `escalation-1`, `escalation-2`, …)* | `blocker-escalation-report` skill (any agent) | `chief-orchestrator`, `reviewer` (closure audit) | C | any | Per-escalation container. `<n>` is a 1-based monotonically increasing index; one block per escalation event. Hosts the `blocker-*` child markers below. |
| `blocker-metadata` | `blocker-escalation-report` skill (any agent) | `chief-orchestrator`, `delivery-pm` | C | any | Block written when an agent escalates; appears once inside each `escalation-N` block. |
| ↳ `blocker-type` | `blocker-escalation-report` skill | `chief-orchestrator` | C | any | |
| ↳ `blocker-what-is-blocked` | `blocker-escalation-report` skill | `chief-orchestrator` | C | any | |
| ↳ `blocker-what-was-tried` | `blocker-escalation-report` skill | `chief-orchestrator` | C | any | |
| ↳ `blocker-required-input` | `blocker-escalation-report` skill | `chief-orchestrator` | C | any | |
| ↳ `blocker-suggested-rerouting` | `blocker-escalation-report` skill | `chief-orchestrator` | O | any | `route_to:` enum |
| `pr-lessons` | `context-minimizer` (injected into bundles) | `executor`, `reviewer` | C | execution | Injected when `<artifact-root>/knowledge/pr-lessons.md` is non-empty. |

## summary.md (per-subtask diagnostics + audit)

| marker | writer | readers | required? | stage(s) | notes |
|---|---|---|---|---|---|
| `dispatch-bundles` | `orchestrator-dispatch` skill (chief-orchestrator) | audit only | Y | any | One line per dispatch: `- <role> for <subtask_id> (cycle <n>): <tokens> tokens; sections: <list>; cache_misses: <list-or-none>`. |
| `context-manifest` | every dispatched agent | `validate-summary-telemetry.js` | Y | any | files/skills/plugins the agent actually loaded |
| `telemetry` | every dispatched agent | `validate-summary-telemetry.js`, `telemetry-summary` skill | Y | any | turns_used, tokens_in, tokens_out |
| `domain-status-checks` | `reviewer` | `chief-orchestrator` | O | execution | per-domain pass/fail |
| `domain-role-checks` | `reviewer` | `chief-orchestrator` | O | execution | |
| `domain-validation-note` | `reviewer` | `chief-orchestrator` | O | execution | |
| `domain-clarifications` | any agent | `chief-orchestrator` | O | any | |

## reversal-&lt;subtask_id&gt;-&lt;NN&gt;.md (standalone soft-reopen artifact)

Written by the `reversal-packet` skill at `<artifact-root>/tasks/<task_id>/reversal-<subtask_id>-<NN>.md` when a closed subtask must be reopened (closure→execution soft transition). The file is a terminal artifact for its cycle; the resulting rework produces its own ai-work.md / summary.md chain in a fresh subtask directory.

> **Enforcement note.** The `required? Y` markers below are contract-level requirements for the `reversal-packet` skill — they are not currently enforced by `hooks/validate-artifact-chain.js`, which detects artifacts by basename (`ai-work.md`, `summary.md`, `task-data.md`) and does not yet match the `reversal-<subtask_id>-<NN>.md` pattern. A malformed reversal packet will surface at the dispatched-agent contract level (the agents reading the packet expect these blocks), not at write time. If you need write-time enforcement, extend the validator's filename-detection list.

| marker | writer | readers | required? | stage(s) | notes |
|---|---|---|---|---|---|
| `reversal-metadata` | `reversal-packet` skill (orchestrator) | `chief-orchestrator`, dispatched agents | Y | closure→execution | Root block. |
| ↳ `reversal-reason` | `reversal-packet` skill | dispatched agents | Y | closure→execution | |
| ↳ `reversal-scope` | `reversal-packet` skill | dispatched agents | Y | closure→execution | |
| ↳ `reversal-proposed-action` | `reversal-packet` skill | `chief-orchestrator` | Y | closure→execution | |
| ↳ `reversal-context-manifest` | `reversal-packet` skill | `context-minimizer` | Y | closure→execution | |
| ↳ `reversal-telemetry` | `reversal-packet` skill | `telemetry-summary` | Y | closure→execution | |

## task-data.md (task-level artifact, only when phase-splits or task-level summaries exist)

| marker | writer | readers | required? | stage(s) | notes |
|---|---|---|---|---|---|
| `delivery-plan` | `delivery-plan` skill | `chief-orchestrator`, `lead` | Y | planning | Promoted here when plan uses phase splits. Hook checks both locations. |
| `review-completion-summary` | `review-report` skill | `chief-orchestrator` | C | closure | task-level rollup |

## PROJECT_CONFIG.md (consumer-repo overlay, owned by init agent)

| marker | writer | readers | required? | notes |
|---|---|---|---|---|
| `domains` | `init` agent | all subagents (via `domain-contexts.cache.md`) | Y | per-domain skills/plugins/baselines |
| `cross-domain-rules` | `init` agent | `lead`, `reviewer` | O | |
| `quality-gates` | `init` agent | `executor`, `reviewer` | Y | lint/test/build commands |
| `extra-trigger-keywords` | `init` agent | `chief-orchestrator` (intake) | O | augments default trigger evaluation |
| `external-skills` | `init` agent | `lead`, `executor` | O | |
| `external-sources` | `init` agent | `init` (refresh) | O | |
| `fe`, `fe-baseline`, `fe-triggers` | `init` agent | FE-domain dispatches | C | when FE domain present |
| `be`, `be-baseline`, `be-triggers` | `init` agent | BE-domain dispatches | C | when BE domain present |
| `auth-baseline`, `api-baseline` | `init` agent | role-relevant dispatches | C | |
| `domain-invariants` | `init` agent | `reviewer` | O | |
| `design-agent-trigger` | `init` agent | `chief-orchestrator` (trigger eval) | C | when a design hook is configured |
| `integration-trigger` | `init` agent | `chief-orchestrator` (trigger eval) | C | |
| `agent-best-practices` | `init` agent | `context-minimizer` | O | per-role best-practice excerpts pulled into bundles |
| `project-best-practices` | `init` agent | `context-minimizer` | O | |
| `plugin-budget`, `skill-budget`, `turn-budgets`, `ultra-light-tier` | `init` agent | `context-minimizer`, `pre-task-guard.js` | O | runtime ceilings |

## Documentation-only anchors (NOT artifact markers)

These appear as `<!-- section:* -->` in governance/playbook/skill files for in-document navigation. They are **not** consumed by `context-minimizer` or validation hooks and need no registry entry:

`default-flow`, `trivial-flow`, `intake`, `registry`, `escalation`, `escalation-routing`, `rework-cap`, `rework-policy`, `severity`, `verdict-taxonomy`, `produce-artifact-first`, `definition-of-done`, `definition-of-ready`, `role-boundaries`, `context-hygiene`, `acceptance-evidence`, `trigger-keywords`, `agent-best-practices` (when used as anchor in CONSTITUTION rather than as PROJECT_CONFIG section), `summary-skeleton`, `summary-minimum-schema`, `ai-work-skeleton`, `telemetry-gate`, `core-review`, `domain-review`, `reviewer-skills`, `deprecation`, `fields`, `resume-entry`, `global-skills`, `impl-*` (when in skill template snippets), `tep-*` (when in template snippets).

> Note: `trigger-keywords` is technically parsed by `hooks/pre-task-guard.js` (it walks the YAML block under that anchor in [`TRIGGER_RULES.md`](../governance/TRIGGER_RULES.md) to merge base rules with PROJECT_CONFIG `extra-trigger-keywords`). It's listed here rather than in the artifact tables because the parser keys off the governance-file location, not a per-task artifact path. If we ever move trigger rules to a per-task artifact, promote it to a table row.

If a marker name appears in both a governance doc (as anchor) AND an artifact template (as a real section), it goes in the table above.

---

## Authority and inline references

**This markdown table is the single source of truth.** Hooks (`validate-artifact-chain.js`, `validate-summary-telemetry.js`) and skills reference marker names by literal string; this file is the human-readable index. There is no companion machine-readable JSON. (Earlier iterations carried a `section-markers.json` stub plus a four-step migration checklist; both were retired in favour of keeping the markdown table authoritative. If a tooling layer ever needs the data in JSON form, generate it from this table on demand rather than maintaining a second source.)

**Known inline-reference sites to keep in sync when adding/renaming a marker.** Audit with `grep -rn '<!-- section:' .` (or `git grep` from a clone). The list below names the categories the sweep will encounter, not every individual hit:

- [`agents/chief-orchestrator.md`](../../agents/chief-orchestrator.md) hard-rule 10 → `<!-- section:role-boundaries -->` pointer at the constitution
- [`ai/core/PROJECT_CONSTITUTION.md`](PROJECT_CONSTITUTION.md) → contains the `<!-- section:role-boundaries -->` and `<!-- section:definition-of-done -->` blocks themselves
- [`ai/playbooks/ORCHESTRATION.md`](../playbooks/ORCHESTRATION.md) → `<!-- section:default-flow -->`, `<!-- section:trivial-flow -->` (and other doc-only anchors)
- [`hooks/pre-task-guard.js`](../../hooks/pre-task-guard.js), [`hooks/validate-artifact-chain.js`](../../hooks/validate-artifact-chain.js), [`hooks/validate-summary-telemetry.js`](../../hooks/validate-summary-telemetry.js) → hard-coded marker regexes
- Per-skill `SKILL.md` and `references/*.md` files under [`skills/`](../../skills/) → marker-name strings embedded in templates and section-extraction logic (most artifact-writing skills carry at least one inline reference)

When adding a new marker, either consume an anchor into this file or add the new reference site to this list so the migration sweep knows it exists.

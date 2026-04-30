---
name: context-minimizer
description: Build and write a dispatch bundle file for a target agent role before every delegation. Replaces the six-step load order with a single pre-curated file that the agent reads on startup.
---

# Context Minimizer — Dispatch Bundle Producer

Before every agent delegation the orchestrator MUST invoke this skill to produce a **dispatch bundle** — a single markdown file that contains everything the target agent needs. The agent reads this file instead of independently loading governance files, canonical contracts, and PROJECT_CONFIG.md sections.

## Dispatch Bundle Protocol

1. Determine the target agent role and subtask context (domain, complexity, rework cycle if any).
2. Assemble the bundle content per the role-specific rules below.
3. Verify the assembled governance/context excerpts stay within the token ceiling for the target role.
4. Write the bundle file to `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/roles/<role>.md`.
5. Pass the bundle file path to the agent in the dispatch prompt.

If the assembled context exceeds the ceiling, re-excerpt until it fits — never silently exceed. Over-ceiling dispatch is an orchestration defect.

The bundle composes whatever `plugins:` and `skills:` are listed in the consumer's `PROJECT_CONFIG.md` for the target domain. Workflow integrity is enforced at the artifact-acceptance gate (Reviewer reading `ai-work.md`), not by filtering the skill list.

## Project-Level Context Cache (consumption protocol)

Per-role bundle assembly needs the same `PROJECT_CONFIG.md` sections repeatedly — the domain block, baselines, best-practices sub-blocks — and re-grepping PROJECT_CONFIG.md on every dispatch is wasted work. The init / update / mutate skills write a pre-extracted cache as a single combined file at `ai-workflow-data/config/domain-contexts.cache.md`; this skill reads that file instead of extracting live whenever possible.

**Cache files:**
- `ai-workflow-data/config/domain-contexts.cache.md` — combined file containing every cached section block back-to-back, each wrapped in its original `<!-- section:<tag> -->...<!-- /section:<tag> -->` anchors. Section bodies are byte-for-byte identical to what live extraction from PROJECT_CONFIG.md produces.
- `ai-workflow-data/config/domain-contexts.cache.manifest.json` — completion marker + `sections` list of cached tags + `cache_path`.

(Legacy `ai-workflow-data/config/domain-contexts/` directory with one file per tag is no longer written. If it still exists in a repo, the next `init` / `update` / `add` / `remove` removes it as part of regeneration.)

**Read protocol for any PROJECT_CONFIG.md section the bundle needs:**

1. Check `domain-contexts.cache.manifest.json` first. If missing or unreadable, skip to step 3 (fallback).
2. If the needed `<tag>` appears in `manifest.sections`, read `domain-contexts.cache.md` and grep the bytes between `<!-- section:<tag> -->` and `<!-- /section:<tag> -->` — same anchor-based extraction this skill applies on the fallback path, just against a smaller file. Use those bytes directly.
3. **Fallback** — if the manifest is missing, the tag is absent from `manifest.sections`, the cache file is unreadable, or the anchor pair is not found: extract the section live from `ai-workflow-data/config/PROJECT_CONFIG.md` as this skill has always done. Emit a telemetry warning (`cache_miss: <tag>`) into the subtask's `summary.md` → Context Manifest so the reviewer rollup captures the miss. Never block dispatch on a cache miss.

**Cache freshness.** The cache is regenerated atomically by `project-config-template` / `project-config-mutate` after every PROJECT_CONFIG.md write, and the manifest is always written last. If `domain-contexts.cache.manifest.json` is older than `PROJECT_CONFIG.md` (mtime comparison), treat the cache as stale and fall back to live extraction. Do not attempt to regenerate the cache from this skill — only the config-writing skills own cache regeneration.

**What is cached** (authoritative list — kept in sync with `project-config-template` → "Derived Context Cache"):

- `domains`
- `cross-domain-rules`
- `<domain>` — one per declared domain
- `<domain>-baseline` — one per declared domain
- `api-baseline`, `auth-baseline`
- `project-best-practices`
- `agent-best-practices-<role>` — split into three anchor blocks (`agent-best-practices-lead`, `agent-best-practices-executor`, `agent-best-practices-reviewer`) within the combined cache file
- `quality-gates`

**What is not cached** (always extracted live):

- Governance files under `${CLAUDE_PLUGIN_ROOT}/ai/governance/` and `${CLAUDE_PLUGIN_ROOT}/ai/core/` — plugin-internal, not project-specific.
- Role contract blocks — embedded in `${CLAUDE_PLUGIN_ROOT}/ai/agents/<role>.md` between `<!-- role-contract:<role> -->` markers (read once per dispatch by `context-minimizer`).
- Artifact input — per-subtask and per-cycle, cannot be cached at project level.

## Bundle Format

```markdown
# Dispatch Bundle — <role> for <subtask_id>

## Role Contract
[read `${CLAUDE_PLUGIN_ROOT}/ai/agents/<role>.md` and copy the `<!-- role-contract:<role> -->` … `<!-- /role-contract:<role> -->` block verbatim — only this marker block, not the surrounding human documentation]

## Project Context
[relevant domain section + baseline + role best-practices — pre-extracted from ai-workflow-data/config/PROJECT_CONFIG.md]

## Governance
[only sections relevant to this role, within token ceiling — excerpted from governance files]

## Artifact Input
[specific ai-work.md sections this role needs — spec, tep, review-findings, etc.]
```

The agent reads ONLY this bundle (plus its own stub for tool/model config). It does NOT independently read canonical contracts, PROJECT_CONFIG.md, or governance files.

---

## Role Contract Blocks

Role contracts live inline in each canonical `${CLAUDE_PLUGIN_ROOT}/ai/agents/<role>.md` file, fenced by `<!-- role-contract:<role> -->` … `<!-- /role-contract:<role> -->` markers. At bundle-assembly time, read the per-role file, extract that marker block, and copy it verbatim into the bundle's `## Role Contract` section. The surrounding prose in `ai/agents/<role>.md` is human documentation and is NOT included in the bundle — only the marker block is load-bearing at runtime.

---

## Context Bundle by Role

> **Role Contract for every role below.** Read `${CLAUDE_PLUGIN_ROOT}/ai/agents/<role>.md` and copy the `<!-- role-contract:<role> -->` marker block verbatim into the bundle's `## Role Contract` section. Do not include the surrounding prose. This rule is identical for all roles per `## Role Contract Blocks` above and is not repeated per-section.

> **Cache resolution.** Every `Project Context from PROJECT_CONFIG.md` bullet below that names a `<!-- section:<tag> -->` resolves via the Project-Level Context Cache protocol above: grep the tag's anchor block out of `ai-workflow-data/config/domain-contexts.cache.md` when the tag is in `domain-contexts.cache.manifest.json`, otherwise extract live from `PROJECT_CONFIG.md`. The per-role lists below describe **what** to include; the cache protocol describes **how** to read it.

Per-role bundle contents (delivery-pm, lead, executor, design-agent, integration-checker, reviewer, orchestrator) live in `${CLAUDE_PLUGIN_ROOT}/skills/context-minimizer/references/role-bundles.md`. Read the block matching the dispatch's target role. Content is stable across cycles — read once per session, not per dispatch.


## Token Ceilings per Role

These caps apply to curated governance/context tokens in the bundle (excluding the agent stub's own content and target source files the agent reads during work).

| Target Role          | Max Governance Tokens | Rationale |
| -------------------- | --------------------- | --------- |
| executor             | 1 500                 | TEP + one baseline section + DoD |
| reviewer             | 2 400                 | Implementation report + scope excerpt + review checklist + one baseline + DoD |
| lead (TEP creation)  | 1 800                 | One subtask excerpt + one baseline section + tech stack |
| delivery-pm          | 2 000                 | Task packet + domains/cross-domain rules + trigger rules |
| design-agent         | 1 500                 | Delivery subtask + FE baseline + small context excerpt |
| integration-checker  | 1 200                 | Changed-side implementation + untouched-side contract + API/Auth sections |

---

## Section Extraction Rules

Per-role bundle blocks above name the `<!-- section:<tag> -->` to extract from each artifact (`ai-work.md`, `task-data.md`, integration-check report). The full extraction rules — which sub-tags map to which artifact subsection, latest-cycle rules for `section:review`, baseline cache resolution, and per-governance-file extraction — live in `${CLAUDE_PLUGIN_ROOT}/skills/context-minimizer/references/section-extraction.md`. Read that file when extracting a section type for the first time in a dispatch; the rules are stable across cycles, so you only need to read once per session.

## Rules

- Never include a full governance file when a section suffices.
- Never include all subtask TEPs when only one subtask is being worked.
- For sectioned Delivery Plans, default to `delivery-subtask-*` only.
- If in doubt, exclude and note it — the agent can request more context via `blocker-escalation-report`.
- The bundle file path convention is `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/roles/<role>.md`.
- Bundle files are retained after agent completion. Their key data (role, token ceiling used, sections included) is summarized into `<subtask_id>/summary.md` by the orchestrator. Bundle files may then be deleted.
- Always consult the Project-Level Context Cache (`ai-workflow-data/config/domain-contexts.cache.manifest.json`) before extracting any PROJECT_CONFIG.md section. Live extraction from PROJECT_CONFIG.md is the fallback path, not the default — silently re-extracting when a cached copy exists wastes the work the init / mutate skills did. Record every cache miss as `cache_miss: <tag>` in the subtask's `summary.md` so repeat misses surface in retrospective.

## Related skills

- `project-config-template` → "Derived Context Cache" — authoritative definition of the combined cache file layout, manifest format, and generation protocol (consumer repo gets the cache written on every `init` / `update`).
- `project-config-mutate` — regenerates the cache after `add` / `remove` mutations. Read this when debugging a stale cache.
- `review-report` → "Stable Finding IDs" — the finding-ID contract that the Executor rework delta (cycle N > 2) relies on.
- `orchestrator-state` — schemas for the hot and history state files that the orchestrator reads to determine which subtask bundle to assemble.
- `orchestrator-dispatch` — wraps the bundle assembly flow with Pre-Dispatch Checklist and Post-Dispatch Gate.

---
name: context-minimizer
description: Owns dispatch-bundle composition — assembles role contract + project context + governance + artifact input within the per-role token ceiling and emits it as the inline payload of the Task prompt. Use for every agent delegation to produce the bundle. The pre-dispatch checklist, post-dispatch artifact gate, and rework routing are owned by orchestrator-dispatch (which calls this skill to compose the bundle).
stage: shared
---

# Context Minimizer — Dispatch Bundle Producer

Before every agent delegation the orchestrator MUST invoke this skill to produce a **dispatch bundle** — a single markdown payload that contains everything the target agent needs. The agent receives this payload inline in its Task `prompt` parameter and works from it directly, instead of independently loading governance files, canonical contracts, and PROJECT_CONFIG.md sections.

## Dispatch Bundle Protocol

1. Determine the target agent role and subtask context (domain, complexity, rework cycle if any).
2. Assemble the bundle content per the role-specific rules below — in memory, as a single markdown string.
3. Verify the assembled governance/context excerpts stay within the token ceiling for the target role.
4. Embed the bundle text directly inside the Task `prompt` parameter when dispatching the agent. Do NOT write the bundle to disk; do NOT pass a file path.
5. Append a one-line **bundle audit** to `summary.md` → `<!-- section:dispatch-bundles -->` (role, target id, cycle, token count, sections included, cache misses if any). The audit lives in the subtask's `summary.md` for subtask-level dispatches (lead, executor, reviewer, design-agent, integration-checker) and in the **task-level** `<artifact-root>/tasks/<task_id>/summary.md` for delivery-pm (which operates at task level and has no subtask folder).

If the assembled context exceeds the ceiling, re-excerpt until it fits — never silently exceed. Over-ceiling dispatch is an orchestration defect.

The bundle composes whatever `plugins:` and `skills:` are listed in the consumer's `PROJECT_CONFIG.md` for the target domain. Workflow integrity is enforced at the artifact-acceptance gate (Reviewer reading `ai-work.md`), not by filtering the skill list.

**Why inline.** Writing the bundle to `roles/<role>.md` and then telling the agent to `Read` it costs one extra disk write, one PostToolUse hook fire, and one extra Read in the subagent — for content the orchestrator already has in memory at dispatch time. Subagent system prompts already accept multi-KB payloads; inlining is the platform-idiomatic delivery. The bundle audit line in `summary.md` preserves the only data future review actually needs (what was sent, how big, which sections). Old `roles/` directories from pre-inline tasks are vestigial and may be deleted.

## Project-Level Context Cache (consumption protocol)

Per-role bundle assembly needs the same `PROJECT_CONFIG.md` sections repeatedly — the domain block, baselines, best-practices sub-blocks — and re-grepping PROJECT_CONFIG.md on every dispatch is wasted work. The init / update / mutate skills write a pre-extracted cache as a single combined file at `<artifact-root>/config/domain-contexts.cache.md`; this skill reads that file instead of extracting live whenever possible.

**Cache files:**
- `<artifact-root>/config/domain-contexts.cache.md` — combined file containing every cached section block back-to-back, each wrapped in its original `<!-- section:<tag> -->...<!-- /section:<tag> -->` anchors. Section bodies are byte-for-byte identical to what live extraction from PROJECT_CONFIG.md produces.
- `<artifact-root>/config/domain-contexts.cache.manifest.json` — completion marker + `sections` list of cached tags + `cache_path`.

(Legacy `<artifact-root>/config/domain-contexts/` directory with one file per tag is no longer written. If it still exists in a repo, the next `init` / `update` / `add` / `remove` removes it as part of regeneration.)

**Read protocol for any PROJECT_CONFIG.md section the bundle needs:**

1. Check `domain-contexts.cache.manifest.json` first. If missing or unreadable, skip to step 3 (fallback).
2. If the needed `<tag>` appears in `manifest.sections`, read `domain-contexts.cache.md` and grep the bytes between `<!-- section:<tag> -->` and `<!-- /section:<tag> -->` — same anchor-based extraction this skill applies on the fallback path, just against a smaller file. Use those bytes directly.
3. **Fallback** — if the manifest is missing, the tag is absent from `manifest.sections`, the cache file is unreadable, or the anchor pair is not found: extract the section live from `<artifact-root>/config/PROJECT_CONFIG.md` as this skill has always done. Emit a telemetry warning (`cache_miss: <tag>`) into the subtask's `summary.md` → Context Manifest so the reviewer rollup captures the miss. Never block dispatch on a cache miss.

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
- Role contract blocks — embedded in `${CLAUDE_PLUGIN_ROOT}/agents/<role>.md` between `<!-- role-contract:<role> -->` markers (read once per dispatch by `context-minimizer`).
- Artifact input — per-subtask and per-cycle, cannot be cached at project level.

## Bundle Format

The bundle is delivered inline as the body of the Task `prompt` parameter. Wrap the payload in stable boundary markers so the agent can locate sections deterministically.

**Artifact-root fact line.** Immediately after the `<!-- dispatch-bundle:start ... -->` opener, emit one HTML-comment fact line:

```
<!-- artifact-root: <absolute-path> -->
```

`<absolute-path>` is the absolute path returned by `hooks/lib/artifact-root.js → resolveArtifactRoot()` for the consumer repo. The orchestrator computes it once per task (it never changes within a task) and copies it verbatim into every dispatch bundle. Every dispatched agent MUST treat all relative artifact paths it sees in skills, governance, or contracts (e.g., `<artifact-root>/tasks/<task_id>/...`) as rooted at this absolute path. Agents MUST NOT hardcode `aiaw-data-...` literals or fall back to `ai-workflow-data/`.

**Stage fact line.** Immediately after the `artifact-root` line, emit one HTML-comment fact line:

```
<!-- stage: <intake|planning|execution|closure> -->
```

`<stage>` is read from `orchestration-state.json → stage` at dispatch time. Dispatched agents use this to validate their invocation context. If an agent detects intent mismatch (e.g. Reviewer dispatched while `stage: planning`), it should escalate via `blocker-escalation-report` with `route_to: chief-orchestrator` rather than proceed. The `pre-task-guard.js` Phase 3.5 hook is the structural backstop; this fact line gives agents in-band visibility for clearer error messages.



```markdown
<!-- dispatch-bundle:start role=<role> subtask=<subtask_id> cycle=<n> -->
<!-- artifact-root: <absolute-path-to-aiaw-data-<project>> -->
<!-- stage: <intake|planning|execution|closure> -->

## Role Contract
[read `${CLAUDE_PLUGIN_ROOT}/agents/<role>.md` and copy the `<!-- role-contract:<role> -->` … `<!-- /role-contract:<role> -->` block verbatim — only this marker block, not the surrounding human documentation]

## Project Context
[relevant domain section + baseline + role best-practices — pre-extracted from <artifact-root>/config/PROJECT_CONFIG.md]

## Governance
[only sections relevant to this role, within token ceiling — excerpted from governance files]

## Artifact Input
[specific ai-work.md sections this role needs — spec, tep, review-findings, etc.]

<!-- dispatch-bundle:end -->

[After the closing marker, append the role-specific instruction line — e.g. for executor:
"Implement the TEP above and append <!-- section:implementation --> to <artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md."]
```

The agent works from the inline payload (plus its own stub for tool/model config). It does NOT independently read canonical contracts, PROJECT_CONFIG.md, or governance files. It MUST still read the `ai-work.md` artifact for the subtask in order to append its own section — the bundle's `## Artifact Input` carries excerpts the agent needs at dispatch time, not the full artifact.

---

## Role Contract Blocks

Role contracts live inline in each plugin agent stub at `${CLAUDE_PLUGIN_ROOT}/agents/<role>.md`, fenced by `<!-- role-contract:<role> -->` … `<!-- /role-contract:<role> -->` markers (in a dedicated `## Role Contract` section near the end of each stub). At bundle-assembly time, read the per-role file, extract that marker block, and copy it verbatim into the bundle's `## Role Contract` section. The surrounding prose in the stub is human commentary and is NOT included in the bundle — only the marker block is load-bearing at runtime.

Roles `chief-orchestrator`, `init`, and `resume-orchestrator` do NOT have role-contract blocks (they are not dispatched via `context-minimizer` bundles); their canonical procedural docs live in `${CLAUDE_PLUGIN_ROOT}/ai/agents/<role>.md`.

---

## Context Bundle by Role

> **Role Contract for every role below.** Read `${CLAUDE_PLUGIN_ROOT}/agents/<role>.md` and copy the `<!-- role-contract:<role> -->` marker block verbatim into the bundle's `## Role Contract` section. Do not include the surrounding prose. This rule is identical for all roles per `## Role Contract Blocks` above and is not repeated per-section.

> **Cache resolution.** Every `Project Context from PROJECT_CONFIG.md` bullet below that names a `<!-- section:<tag> -->` resolves via the Project-Level Context Cache protocol above: grep the tag's anchor block out of `<artifact-root>/config/domain-contexts.cache.md` when the tag is in `domain-contexts.cache.manifest.json`, otherwise extract live from `PROJECT_CONFIG.md`. The per-role lists below describe **what** to include; the cache protocol describes **how** to read it.

### Quick reference — bundle sections by role

| Role                | Sections (PROJECT_CONFIG + governance + artifact)                                 | Token ceiling |
| ------------------- | --------------------------------------------------------------------------------- | ------------- |
| delivery-pm         | Task Packet + `domains` + `cross-domain-rules` + trigger rules                    | 2 000         |
| lead                | Subtask excerpt + `<domain>-baseline` + `agent-best-practices-lead` + tech stack  | 1 800         |
| executor            | TEP + `<domain>-baseline` + `agent-best-practices-executor` + DoD + PR lessons    | 1 500         |
| reviewer            | Implementation report + scope excerpt + review checklist + baseline + DoD + PR lessons | 2 400    |
| design-agent        | Delivery subtask + FE baseline + small context excerpt                            | 1 500         |
| integration-checker | Changed-side implementation + untouched-side contract + `api-baseline` + `auth-baseline` | 1 200  |

Use this table to decide *what* the bundle should carry. Per-role assembly procedures (cycle-N rework deltas, finding-ID extraction, role-contract block locations) live in `${CLAUDE_PLUGIN_ROOT}/skills/shared/context-minimizer/references/role-bundles.md`. Read the block matching the dispatch's target role. Content is stable across cycles — read once per session, not per dispatch.


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

Per-role bundle blocks above name the `<!-- section:<tag> -->` to extract from each artifact (`ai-work.md`, `task-data.md`, integration-check report). The full extraction rules — which sub-tags map to which artifact subsection, latest-cycle rules for `section:review`, baseline cache resolution, and per-governance-file extraction — live in `${CLAUDE_PLUGIN_ROOT}/skills/shared/context-minimizer/references/section-extraction.md`. Read that file when extracting a section type for the first time in a dispatch; the rules are stable across cycles, so you only need to read once per session.

The canonical registry of every `<!-- section:* -->` marker — writer, readers, location, required/optional/conditional, stage — lives in `${CLAUDE_PLUGIN_ROOT}/ai/core/SECTION_MARKERS.md`. When extracting a section whose name does not appear in the per-role bundle blocks above, consult the registry to confirm location and writer before falling back to the rules in `references/section-extraction.md`.

## Rules

- Never include a full governance file when a section suffices.
- Never include all subtask TEPs when only one subtask is being worked.
- For sectioned Delivery Plans, default to `delivery-subtask-*` only.
- If in doubt, exclude and note it — the agent can request more context via `blocker-escalation-report`.
- Bundles are NEVER written to disk. The audit line in `summary.md` → `<!-- section:dispatch-bundles -->` is the only on-disk record. Format: `- <role> for <subtask_id> (cycle <n>): <token_count> tokens; sections: <list>; cache_misses: <list-or-none>`.
- Any pre-existing `roles/<role>.md` files from before this change are vestigial and may be deleted by the orchestrator at task close.
- Always consult the Project-Level Context Cache (`<artifact-root>/config/domain-contexts.cache.manifest.json`) before extracting any PROJECT_CONFIG.md section. Live extraction from PROJECT_CONFIG.md is the fallback path, not the default — silently re-extracting when a cached copy exists wastes the work the init / mutate skills did. Record every cache miss as `cache_miss: <tag>` in the subtask's `summary.md` so repeat misses surface in retrospective.

## Optional: PR Lessons Injection (executor + reviewer bundles)

When assembling a bundle for **executor** or **reviewer** AND `<artifact-root>/knowledge/pr-lessons.md` exists and is non-empty, inject a `<!-- section:pr-lessons -->` block in `## Project Context`. Filter by TEP `target_files` (executor) or diff paths (reviewer); cap at top 10 by `Last seen`. Omit the section entirely when no lessons match — never inject an empty section.

The full filtering rules, block format, and `pr-lessons-check` boundary live in `${CLAUDE_PLUGIN_ROOT}/skills/shared/context-minimizer/references/pr-lessons-injection.md`. Read on first executor/reviewer bundle per session.

## Related skills

- `project-config-template` → "Derived Context Cache" — authoritative definition of the combined cache file layout, manifest format, and generation protocol (consumer repo gets the cache written on every `init` / `update`).
- `project-config-mutate` — regenerates the cache after `add` / `remove` mutations. Read this when debugging a stale cache.
- `review-report` → "Stable Finding IDs" — the finding-ID contract that the Executor rework delta (cycle N > 2) relies on.
- `orchestrator-state` — schemas for the hot and history state files that the orchestrator reads to determine which subtask bundle to assemble.
- `orchestrator-dispatch` — wraps the bundle assembly flow with Pre-Dispatch Checklist and Post-Dispatch Gate.

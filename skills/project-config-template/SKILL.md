---
name: project-config-template
description: Canonical skeleton for ai-workflow-data/config/PROJECT_CONFIG.md. Use when init writes the initial file or update refreshes owned sections. Emitted text must pass the hooks/evaluate-triggers.js regex.
---

# Project Config Template Skill

Produce the content for `ai-workflow-data/config/PROJECT_CONFIG.md`. All required anchors are present even when empty (per `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:produce-artifact-first -->`).

**Denylist enforcement.** When populating `<!-- section:<domain> -->` → `plugins:` and `skills:` lists, drop every candidate whose identifier matches an entry in `${CLAUDE_PLUGIN_ROOT}/ai/governance/FORBIDDEN_WORKFLOWS.md` → `<!-- section:denylist -->`. Do NOT emit `feature-dev`, `feature-dev:*`, `pr-review-toolkit:review-pr`, `pr-review-toolkit:code-reviewer`, `code-review:code-review`, or the role-scoped `superpowers:*` orchestration skills listed there — they orchestrate competing workflows and would be stripped at bundle assembly by the `context-minimizer` filter and hard-blocked at dispatch by the `guard-forbidden-workflows` hook. Helpers that are safe to list: `context7`, `figma`, `supabase`, domain-specific MCP servers, and the narrow `superpowers:*` / `pr-review-toolkit:*` entries named in `FORBIDDEN_WORKFLOWS.md` → `<!-- section:allowed-helpers -->`.

## Output Target

Return the full skeleton to the init agent. The agent writes it atomically after the `project-config-review` gate approves.

## Required Anchors (v1)

1. `<!-- section:domains -->` — declared_domains, detection_rules, decomposition_rule, escalation_rule.
2. `<!-- section:<domain> -->` — one per declared domain (skills, plugins, baseline anchor, validation_rules, forbidden_actions).
3. `<!-- section:<domain>-baseline -->` — persistent domain context.
4. `<!-- section:api-baseline -->` — BE REST contract expectations.
5. `<!-- section:auth-baseline -->` — auth / permission model baseline.
6. `<!-- section:project-best-practices -->` — universal project conventions (user-editable).
7. `<!-- section:agent-best-practices -->` — role-specific overlay (user-editable).
8. `<!-- section:extra-trigger-keywords -->` — project keyword overlay unioned with TRIGGER_RULES.
9. `<!-- section:cross-domain-rules -->` — rules spanning multiple domains (read by delivery-pm).
10. `<!-- section:quality-gates -->` — CI / test / lint / typecheck / build commands (read by reviewer and executor).

For `fe`-only or `be`-only projects, drop the unused domain and its baseline; trim `declared_domains` accordingly. Include `api-baseline` and `auth-baseline` only when BE is present.

## Skeleton

The canonical PROJECT_CONFIG.md skeleton (all required `<!-- section:* -->` anchors with placeholder YAML and ordering, plus the FE-only / BE-only trimming rule) lives at `${CLAUDE_PLUGIN_ROOT}/skills/project-config-template/references/skeleton.md`. Read it once at init; emit the bytes verbatim with placeholders filled from project discovery evidence per the rules below. The skeleton's anchors are the source of truth for "Required Anchors (v1)" above and for the regex validation in the next section.

## Validation Rules (MANDATORY before the init agent writes)

The emitted text must parse under these exact regex literals from `${CLAUDE_PLUGIN_ROOT}/hooks/evaluate-triggers.js`:

- **Section regex** (line 48-49): `<!--\s*section:([a-z0-9-]+)\s*-->([\s\S]*?)<!--\s*/section:\1\s*-->`
- **Agent-map line** (line 63): `^([A-Za-z][A-Za-z0-9_-]*):\s*(\[\s*\])?\s*$`
- **List-item line** (line 70): `^\s*-\s+(.+?)\s*$`

Before returning, the init agent must compile each emitted `<!-- section:... -->` block and confirm round-trip extraction works. Any deviation aborts the write with a diagnostic.

## Derived Context Cache (MANDATORY after every PROJECT_CONFIG.md write)

After atomically writing `ai-workflow-data/config/PROJECT_CONFIG.md`, regenerate the derived cache as a **single combined file** at `ai-workflow-data/config/domain-contexts.cache.md` plus its sibling `domain-contexts.cache.manifest.json`. The cache lets `context-minimizer` read pre-extracted section bytes instead of grepping PROJECT_CONFIG.md on every dispatch.

The cache used to fan out into ~13 per-tag files under `domain-contexts/`. That layout was collapsed to one file because every dispatch reads multiple sections anyway, and the per-file overhead was pure clutter (noisy git diffs, large directory listings, no perf benefit).

### Cacheable section tags

The cache contains **only** section tags that appear in the just-written PROJECT_CONFIG.md AND are in the cacheable set below. Tags absent from the config are not emitted (the manifest reflects this). A Python-only backend repo has no `fe` / `fe-baseline` blocks; a repo without auth has no `auth-baseline` block.

Cacheable set (these are the tags `context-minimizer` repeatedly extracts during bundle assembly):

- `domains` — read by Delivery PM
- `cross-domain-rules` — read by Delivery PM
- `<domain>` — one per declared domain (e.g. `fe`, `be`) — read by Lead / Executor / Reviewer
- `<domain>-baseline` — one per declared domain — read by Lead / Executor
- `api-baseline` — read by Executor / Integration Checker when BE declared
- `auth-baseline` — read by Executor / Integration Checker when BE declared
- `project-best-practices` — read by Lead / Executor
- `agent-best-practices-<role>` — one per role sub-block (`lead`, `executor`, `reviewer`) extracted from the `<!-- section:agent-best-practices -->` YAML — read by the matching role
- `quality-gates` — read by Executor / Reviewer

### Cache file format

`domain-contexts.cache.md` is the concatenation of every cacheable section block present in PROJECT_CONFIG.md, separated by a single blank line. Each section block is byte-for-byte identical to the source between `<!-- section:T -->` and `<!-- /section:T -->` (inclusive of the anchor comments) — no transformation, no reformatting. `context-minimizer` greps this file by anchor exactly the way it would grep PROJECT_CONFIG.md on the fallback path.

For the split `agent-best-practices-<role>` blocks: extract the YAML sub-block whose key matches the role (e.g. `lead:`) from `<!-- section:agent-best-practices -->`, preserve list-item indentation verbatim, and wrap it in a fresh `<!-- section:agent-best-practices-<role> -->` / `<!-- /section:agent-best-practices-<role> -->` anchor pair before appending to the combined file.

A leading line `# Derived context cache (auto-generated — do not edit)` is allowed before the first section block to make the file self-describing. Anything else outside section anchors is forbidden.

### Manifest

Write `ai-workflow-data/config/domain-contexts.cache.manifest.json` after the combined `.md` file:

```json
{
  "generated_at": "<ISO-8601 UTC>",
  "source_path": "ai-workflow-data/config/PROJECT_CONFIG.md",
  "source_sha256": "<hex digest of PROJECT_CONFIG.md bytes>",
  "cache_path": "ai-workflow-data/config/domain-contexts.cache.md",
  "sections": ["domains", "fe", "fe-baseline", "project-best-practices", "agent-best-practices-executor", ...]
}
```

`sections` lists every `<tag>` whose anchor appears inside `domain-contexts.cache.md`. `context-minimizer` reads this manifest first to decide cache-hit vs fallback-to-extraction.

### Generation protocol

1. After the atomic rename of `PROJECT_CONFIG.md`, compute its SHA-256.
2. Remove the legacy `ai-workflow-data/config/domain-contexts/` directory if present (one-time migration; safe — it is fully derived). Remove any prior `domain-contexts.cache.md` and `domain-contexts.cache.manifest.json`.
3. For each tag in the cacheable set, check whether the just-written PROJECT_CONFIG.md contains `<!-- section:<tag> -->`:
   - Yes → append the section's bytes (between and including the anchor comments) to the in-memory combined buffer, separated from the previous block by a single blank line.
   - No → skip; tag is absent from the manifest.
4. For `agent-best-practices-<role>`: if `<!-- section:agent-best-practices -->` exists and contains a top-level `<role>:` key with non-empty content, append a wrapped `<!-- section:agent-best-practices-<role> -->` block to the buffer. Empty role lists (`lead: []`) still produce an empty-list block — included so `context-minimizer` doesn't fall back for a section that is explicitly empty-by-design.
5. Write the buffer to `domain-contexts.cache.md.tmp`, `fsync`, then `rename` over `domain-contexts.cache.md`.
6. Write the manifest to `domain-contexts.cache.manifest.json.tmp`, `fsync`, then `rename`. The manifest write must follow the cache write so the manifest acts as a completion marker — readers that see the manifest can trust the cache file is consistent.

### Rules

- **Never hand-edit `domain-contexts.cache.md` or `domain-contexts.cache.manifest.json`.** They are derived; the source of truth is PROJECT_CONFIG.md.
- **Always regenerate the whole cache after any PROJECT_CONFIG.md write.** Partial regeneration is a bug surface.
- **The manifest is written last.** A missing or older-than-cache manifest signals an incomplete generation — readers must fall back to live extraction.
- **Cache is committed.** Both files are valid git artifacts alongside PROJECT_CONFIG.md — reviewable, diffable, and resolve cleanly under merge.

## Related skills

- `project-config-mutate` — owns `add` / `remove` mutations; MUST regenerate the cache after every successful write (see that skill's Write Protocol).
- `context-minimizer` → "Project-Level Context Cache (consumption protocol)" — the reader of this cache during dispatch bundle assembly.
- `project-config-review` — approval gate; surfaces cache invalidation as part of the mutation preview so users see the blast radius.

## Rules

- Every anchor listed above MUST be present, even when its value is `[]` or a comment-only YAML block.
- Fill every field from evidence or a user answer — never invent or paraphrase.
- Preserve the exact anchor names. No typos, no case differences, no extra whitespace inside the `<!-- section:... -->` comment.
- `declared_domains` must match the set of `<!-- section:<domain> -->` blocks that follow.
- `design_hook_domains` ⊆ `declared_domains`.
- `api-baseline` and `auth-baseline` are present only when BE is declared.
- Trailing newline is required at end-of-file.

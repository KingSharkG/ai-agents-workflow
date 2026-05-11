# Derived Context Cache — Format and Generation Protocol

After atomically writing `<artifact-root>/config/PROJECT_CONFIG.md`, regenerate the derived cache as a **single combined file** at `<artifact-root>/config/domain-contexts.cache.md` plus its sibling `domain-contexts.cache.manifest.json`. The cache lets `context-minimizer` read pre-extracted section bytes instead of grepping PROJECT_CONFIG.md on every dispatch.

The cache used to fan out into ~13 per-tag files under `domain-contexts/`. That layout was collapsed to one file because every dispatch reads multiple sections anyway, and the per-file overhead was pure clutter (noisy git diffs, large directory listings, no perf benefit).

## Cacheable section tags

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

## Cache file format

`domain-contexts.cache.md` is the concatenation of every cacheable section block present in PROJECT_CONFIG.md, separated by a single blank line. Each section block is byte-for-byte identical to the source between `<!-- section:T -->` and `<!-- /section:T -->` (inclusive of the anchor comments) — no transformation, no reformatting. `context-minimizer` greps this file by anchor exactly the way it would grep PROJECT_CONFIG.md on the fallback path.

For the split `agent-best-practices-<role>` blocks: extract the YAML sub-block whose key matches the role (e.g. `lead:`) from `<!-- section:agent-best-practices -->`, preserve list-item indentation verbatim, and wrap it in a fresh `<!-- section:agent-best-practices-<role> -->` / `<!-- /section:agent-best-practices-<role> -->` anchor pair before appending to the combined file.

A leading line `# Derived context cache (auto-generated — do not edit)` is allowed before the first section block to make the file self-describing. Anything else outside section anchors is forbidden.

## Manifest

Write `<artifact-root>/config/domain-contexts.cache.manifest.json` after the combined `.md` file:

```json
{
  "generated_at": "<ISO-8601 UTC>",
  "source_path": "<artifact-root>/config/PROJECT_CONFIG.md",
  "source_sha256": "<hex digest of PROJECT_CONFIG.md bytes>",
  "cache_path": "<artifact-root>/config/domain-contexts.cache.md",
  "sections": ["domains", "fe", "fe-baseline", "project-best-practices", "agent-best-practices-executor", ...]
}
```

`sections` lists every `<tag>` whose anchor appears inside `domain-contexts.cache.md`. `context-minimizer` reads this manifest first to decide cache-hit vs fallback-to-extraction.

## Generation protocol

1. After the atomic rename of `PROJECT_CONFIG.md`, compute its SHA-256.
2. Remove the legacy `<artifact-root>/config/domain-contexts/` directory if present (one-time migration; safe — it is fully derived). Remove any prior `domain-contexts.cache.md` and `domain-contexts.cache.manifest.json`.
3. For each tag in the cacheable set, check whether the just-written PROJECT_CONFIG.md contains `<!-- section:<tag> -->`:
   - Yes → append the section's bytes (between and including the anchor comments) to the in-memory combined buffer, separated from the previous block by a single blank line.
   - No → skip; tag is absent from the manifest.
4. For `agent-best-practices-<role>`: if `<!-- section:agent-best-practices -->` exists and contains a top-level `<role>:` key with non-empty content, append a wrapped `<!-- section:agent-best-practices-<role> -->` block to the buffer. Empty role lists (`lead: []`) still produce an empty-list block — included so `context-minimizer` doesn't fall back for a section that is explicitly empty-by-design.
5. Write the buffer to `domain-contexts.cache.md.tmp`, `fsync`, then `rename` over `domain-contexts.cache.md`.
6. Write the manifest to `domain-contexts.cache.manifest.json.tmp`, `fsync`, then `rename`. The manifest write must follow the cache write so the manifest acts as a completion marker — readers that see the manifest can trust the cache file is consistent.

## Rules

- **Never hand-edit `domain-contexts.cache.md` or `domain-contexts.cache.manifest.json`.** They are derived; the source of truth is PROJECT_CONFIG.md.
- **Always regenerate the whole cache after any PROJECT_CONFIG.md write.** Partial regeneration is a bug surface.
- **The manifest is written last.** A missing or older-than-cache manifest signals an incomplete generation — readers must fall back to live extraction.
- **Cache is committed.** Both files are valid git artifacts alongside PROJECT_CONFIG.md — reviewable, diffable, and resolve cleanly under merge.

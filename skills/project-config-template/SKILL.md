---
name: project-config-template
description: Canonical skeleton for <artifact-root>/config/PROJECT_CONFIG.md. Use when init writes the initial file or update refreshes owned sections. Emitted text must pass the hooks/pre-task-guard.js regex (Phase 4 — trigger evaluation).
---

# Project Config Template Skill

Produce the content for `<artifact-root>/config/PROJECT_CONFIG.md`. All required anchors are present even when empty (per `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:produce-artifact-first -->`).

**Helper preference.** When populating `<!-- section:<domain> -->` → `plugins:` and `skills:` lists, prefer narrow helpers (`context7`, `figma:*`, `supabase:*`, domain-specific MCP servers, `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `pr-review-toolkit:silent-failure-hunter`, etc.) over end-to-end workflow orchestrators. Workflow orchestrators (`feature-dev:*`, `pr-review-toolkit:review-pr`, `pr-review-toolkit:code-reviewer`, `code-review:code-review`, `superpowers:writing-plans`, `superpowers:subagent-driven-development`) may still be listed if a domain genuinely needs them, but Lead/Executor/Reviewer must route their output back through the TEP / `ai-work.md` / `review-report` artifact chain or Reviewer will reject the work.

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

The emitted text must parse under these exact regex literals from `${CLAUDE_PLUGIN_ROOT}/hooks/pre-task-guard.js` → Phase 4 (`parseKeywordSection`):

- **Section regex** (line 48-49): `<!--\s*section:([a-z0-9-]+)\s*-->([\s\S]*?)<!--\s*/section:\1\s*-->`
- **Agent-map line** (line 63): `^([A-Za-z][A-Za-z0-9_-]*):\s*(\[\s*\])?\s*$`
- **List-item line** (line 70): `^\s*-\s+(.+?)\s*$`

Before returning, the init agent must compile each emitted `<!-- section:... -->` block and confirm round-trip extraction works. Any deviation aborts the write with a diagnostic.

## Derived Context Cache (MANDATORY after every PROJECT_CONFIG.md write)

After every atomic write of `PROJECT_CONFIG.md`, regenerate the derived cache at `<artifact-root>/config/domain-contexts.cache.md` plus its sibling `domain-contexts.cache.manifest.json`. The full format, cacheable section list, manifest schema, and step-by-step generation protocol live in `${CLAUDE_PLUGIN_ROOT}/skills/project-config-template/references/cache-generation.md`. Read once per session — content is stable.

Quick rules (full detail in the reference):

- Cache contains only section tags present in the just-written PROJECT_CONFIG.md AND in the cacheable set.
- `domain-contexts.cache.md` concatenates section blocks byte-for-byte; the manifest is written **last** as the completion marker.
- Never hand-edit either file. Always regenerate the whole cache; partial regeneration is a bug.

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

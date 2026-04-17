---
name: project-config-mutate
description: Apply `add` or `remove` mutations to ai-workflow-data/config/PROJECT_CONFIG.md after the review gate. Validates target-type, computes unified diff, writes atomically.
---

# Project Config Mutate Skill

Apply a single `add` or `remove` to an existing `ai-workflow-data/config/PROJECT_CONFIG.md`. Computes the diff for `project-config-review` to present. Writes atomically only after that skill's gate approves.

## Output Target

`ai-workflow-data/config/PROJECT_CONFIG.md` in the consumer CWD. Atomic write: temp file + rename. Never writes before approval.

## Target-Type Map

| `target-type`       | Destination section                                                                 | Shape                                  | Domain scoping           |
|---------------------|-------------------------------------------------------------------------------------|----------------------------------------|--------------------------|
| `domain`            | `<!-- section:domains -->` → `declared_domains` + new `<!-- section:<domain> -->` + `<!-- section:<domain>-baseline -->` blocks | list entry + two new anchor blocks | n/a                      |
| `skill`             | `<!-- section:<domain> -->` → `skills`                                              | list entry (catalog-validated)         | required via `--domain` |
| `plugin`            | `<!-- section:<domain> -->` → `plugins`                                             | list entry (catalog-validated)         | required via `--domain` |
| `baseline`          | `<!-- section:<domain>-baseline -->`                                                | key: value                             | required via `--domain` |
| `validation-rule`   | `<!-- section:<domain> -->` → `validation_rules`                                    | list entry (free-form)                 | required via `--domain` |
| `forbidden-action`  | `<!-- section:<domain> -->` → `forbidden_actions`                                   | list entry (free-form)                 | required via `--domain` |
| `best-practice`     | `<!-- section:project-best-practices -->` (user-editable; explicit add allowed)     | list entry (free-form)                 | n/a                      |
| `cross-domain-rule` | `<!-- section:cross-domain-rules -->` → `rules`                                     | list entry (free-form)                 | n/a                      |

## Validation (before computing the diff)

1. **Target-type.** Must be one of the eight above. Anything else errors out with the list.
2. **Value shape.** Non-empty string after trim. For `baseline`, require `key=value` form.
3. **Catalog check.**
   - `skill`: value must match one of (a) a `name` in `${CLAUDE_PLUGIN_ROOT}/skills/*/SKILL.md` frontmatter, (b) a skill listed under any prefix in `${CLAUDE_PLUGIN_ROOT}/ai/governance/RESOLUTION_POLICY.md` → `<!-- section:external-skills -->`, or (c) a skill provided by a `claude-builtin` plugin that has a row in `<!-- section:registry -->` (skill referenced by its bare name, with the plugin's `source_ref` prefix implied).
   - `plugin`: value must appear in `${CLAUDE_PLUGIN_ROOT}/ai/governance/RESOLUTION_POLICY.md` → `<!-- section:registry -->` with `status: approved` (or `trial`). Deprecated plugins error. The row's `source` and `source_ref` columns are informational for the review summary but do not affect validation beyond presence.
4. **Domain scoping.** For target-types that require `--domain`, confirm the target domain is declared in `<!-- section:domains -->` → `declared_domains`. If not declared, error with the suggestion "run `ai-workflow add domain <name>` first".
5. **Idempotency.**
   - `add`: if the value already exists in the target list, return a no-op notice (not an error) and skip the write.
   - `remove`: if the value is absent, error out.

## Diff Computation

1. Parse the existing file via the regex in `project-config-template` → Validation Rules.
2. Locate the target section. For multi-domain target-types, locate `<!-- section:<domain> -->` or `<!-- section:<domain>-baseline -->` as applicable.
3. Apply the mutation in memory (add to list / remove from list / set key).
4. Serialise the target section back to Markdown with preserved trailing newline and two-space indent for YAML lists.
5. Produce a unified diff scoped to the target section; hand it to `project-config-review` for the change summary and approval gate.
6. For `skill` and `plugin` adds, the change summary passed to `project-config-review` SHOULD include the resolved `source` + `source_ref` from `<!-- section:registry -->` / `<!-- section:external-skills -->` as provenance context. This is presentation-only — the written PROJECT_CONFIG.md always stores bare names (no source metadata).

## Write Protocol

- Only after `project-config-review` returns `Approve and write`.
- Compute final file contents (target section replaced; all other sections byte-identical).
- Write to `<path>.tmp`, `fsync`, then `rename` over `<path>`.
- Re-run the `evaluate-triggers.js` regex against the written file to confirm the hook can still parse it. On parse failure: restore the previous file from in-memory cache, log a diagnostic, and error.

## Rules

- **No silent mutations.** Every write goes through `project-config-review` first.
- **No cross-section edits.** Each invocation touches exactly one target section.
- **User-editable sections.** Only `best-practice` writes into a user-editable section (`<!-- section:project-best-practices -->`); the CLI never touches it otherwise. Refuse any `remove` that would delete user-authored items that do not match a catalog entry — ask explicitly via the review gate.
- **Cross-domain-rule.** Targets the new `<!-- section:cross-domain-rules -->` anchor; do not attempt to embed it inside `<!-- section:domains -->`.
- **Preserve comment-only YAML.** If the target section's YAML block contains only comments, the mutation adds the appropriate top-level key and preserves the comments above it.
- **Atomicity.** Never partial-write. If any step fails, leave the original file untouched.

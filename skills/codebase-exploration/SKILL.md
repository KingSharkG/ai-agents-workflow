---
name: codebase-exploration
description: Trace execution paths, map architecture layers, and list 5–10 key files for a subtask before the TEP is drafted. Produces a section:exploration-notes fragment appended to ai-work.md by the Lead. Use before technical-execution-packet when the subtask touches an area the Lead has not already mapped.
---

# Codebase Exploration Skill

Before drafting the TEP, the Lead uses this skill to produce a structured exploration record: entry points, architecture layers, patterns in similar features, and the 5–10 key files the Executor (and the Lead's own TEP reasoning) will depend on. This replaces the implicit "read some files via Grep / filesystem MCP" that earlier versions left to the model's discretion — and closes the gap that made `feature-dev:code-explorer` look appealing during subtask execution.

## When to invoke

- **Always** at Lead startup for any subtask with `complexity ∈ {medium, hard}`.
- **When** `complexity = low` but the subtask's `target_files` list is incomplete or the `Domain Handoff Note` flags unfamiliar territory.
- **Skip** when the prior subtask's TEP already emitted an `exploration-notes` block covering the same area AND the current subtask's `target_files` sit entirely inside that area. Re-using exploration across sibling subtasks is preferred over re-exploring.

## Output Target

**Append** to `<!-- section:exploration-notes -->` in the subtask's `ai-work.md`, immediately above the TEP placeholder. The orchestrator-dispatch skill creates this placeholder alongside `section:tep` in the ai-work.md skeleton.

## How to explore (budget: ≤ 2 Lead turns)

1. **Identify the subtask intent surface.** From `<!-- section:spec -->`, extract verbs and nouns: "add X endpoint", "rename Y field", "reuse Z flow". These are your search seeds.
2. **Grep for seeds (structured, not free-form).** Use Grep (or the filesystem MCP `search_files`) to locate:
   - **Entry points** — route files, command handlers, top-level components, public exports. Limit to 3.
   - **Similar features** — at least one comparable implementation of the same verb/noun combination if one exists. This becomes the pattern reference.
   - **Call sites / consumers** — files that would be affected by the subtask's change. Limit to 5.
3. **Trace one golden path end-to-end.** For the most representative entry point, follow the call chain through each architecture layer (presentation → orchestration → domain → data or the project's equivalent). Note the layer each file belongs to. Stop at 6 files or one full traversal, whichever comes first.
4. **Record patterns, not code.** Describe the shape (pattern name, invariant, transformation) — do NOT paste large code blocks. The Executor reads the real files at implementation time; this skill's job is navigation.

Keep the total output under 120 lines. If the subtask is too broad to fit, emit a `blocker-escalation-report` with `blocker_type: scope-too-broad` instead of writing an overstuffed exploration record.

## Output Template

Append inside `<!-- section:exploration-notes -->`:

```markdown
<!-- section:exploration-metadata -->
## Metadata
- **task_id**: <from Delivery Plan>
- **subtask_id**: <from Delivery Plan>
- **domain**: frontend | backend
- **turns_used**: <integer, ≤ 2>
- **created_at**: <ISO 8601 UTC>
<!-- /section:exploration-metadata -->

<!-- section:exploration-entry-points -->
## Entry Points
- `<path>` — <role: route / handler / component / export>
<!-- /section:exploration-entry-points -->

<!-- section:exploration-layers -->
## Architecture Layers (golden path)
Ordered from outermost to storage. One file per layer when applicable.

1. **<layer name, e.g. Presentation>** — `<path>` — <one-line role>
2. **<layer name, e.g. Orchestration>** — `<path>` — <one-line role>
3. ...
<!-- /section:exploration-layers -->

<!-- section:exploration-similar-features -->
## Similar Features (pattern references)
- `<path or area>` — <what it does that mirrors the subtask; the pattern name to reuse>
<!-- /section:exploration-similar-features -->

<!-- section:exploration-key-files -->
## Key Files (5–10)
The Executor's TEP `target_files` list should be drawn from this set.

| Path | Why it matters | In TEP? |
| ---- | -------------- | ------- |
| `<path>` | <reason> | yes / no (use "yes" only for files in target_files) |
<!-- /section:exploration-key-files -->

<!-- section:exploration-open-questions -->
## Open Questions
<Issues the Lead could not resolve during exploration and must surface in the TEP's clarifying-questions section, or raise as a blocker. Each item: one line.>
- <question or "none">
<!-- /section:exploration-open-questions -->
```

## Rules

- **No code dumps.** One-line annotations per file; paste actual code only inside the TEP's `tep-context-bundle` when it's truly needed for the Executor.
- **At least one similar-feature reference when the subtask is a new instance of an existing pattern** (new CRUD entity, new auth strategy variant, new list screen, etc.). If none exists, state `similar-features: none found — treat as greenfield` and flag in `open-questions`.
- **Never** launch parallel sub-Task dispatches from inside this skill; Lead owns exploration directly. Output from spawned dispatchers does not flow back into `ai-work.md` and Reviewer will reject the subtask.
- **This skill IS the ai-agents-workflow exploration entry point.** `feature-dev:code-explorer` / `feature-dev:code-architect` may be invoked as helpers, but their output must be reformatted into the `<!-- section:exploration-notes -->` shape and recorded in `ai-work.md` — output that does not flow back through the artifact chain will be rejected at review.
- **Every `target_files` path in the subsequent TEP MUST appear in `exploration-key-files`** with `In TEP? = yes`. The Executor, the Reviewer, and the orchestrator rollup all treat this mapping as the audit trail.
- If exploration reveals the subtask is infeasible as planned (missing dependency, conflicting invariant, scope gap), **stop** and emit a `blocker-escalation-report` routed to `delivery-pm` — do not proceed to TEP drafting.

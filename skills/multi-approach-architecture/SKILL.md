---
name: multi-approach-architecture
description: Surface 2–3 trade-off approaches (minimal / clean / pragmatic) before committing to a TEP. Use when complexity is medium or hard AND the approach is non-trivial. Produces a section:architecture-options fragment the Lead appends to ai-work.md before drafting the TEP.
---

# Multi-Approach Architecture Skill

When a subtask's approach is non-trivial, the Lead enumerates 2–3 competing approaches with explicit trade-offs rather than silently picking one. This replaces the implicit single-design path that earlier Lead contracts produced — and closes the gap that made `feature-dev:code-architect`'s multi-option ritual appealing at dispatch time.

## When to invoke

- **Invoke** when `complexity ∈ {medium, hard}` AND at least one of:
  - The subtask can be implemented in materially different ways (new abstraction vs. inline change; stateful vs. stateless; at-rest vs. in-flight transform; etc.).
  - The Lead's first-pass design would couple together concerns that later subtasks might want to change independently.
  - The Delivery Plan's `subtask_risk` flags architecture ambiguity.
- **Skip** when `complexity = low`, when the Delivery Plan already narrows the approach, or when exploration-notes already established that one pattern dominates the codebase and the subtask is a straightforward instance of it.
- **Never** use this skill as a substitute for `blocker-escalation-report` when the right answer is "we need user input." Multi-approach design is for technical trade-offs the Lead can adjudicate; requirements ambiguity goes into `<!-- section:tep-clarifying-questions -->`.

## Output Target

**Append** to `<!-- section:architecture-options -->` in the subtask's `ai-work.md`, between `<!-- section:exploration-notes -->` and `<!-- section:tep -->`. The orchestrator-dispatch skeleton creates the placeholder.

## How to design (budget: ≤ 2 Lead turns)

1. **Anchor on the codebase pattern.** From `<!-- section:exploration-notes -->` → `exploration-similar-features`, identify the dominant existing pattern. Option A is almost always "extend that pattern as-is."
2. **Vary one axis, not many.** Each alternative option varies ONE architectural axis (coupling, locality, statefulness, abstraction level). Do NOT invent options that simultaneously differ in multiple dimensions — comparisons become impossible.
3. **Select and justify.** The Lead picks one option before writing the TEP, and records a one-line reason. The TEP's `tep-implementation-steps` must match the selected option.

Keep total output under 90 lines. If three meaningful options don't exist, present two; if only one meaningful option exists, skip the skill entirely and write `<!-- section:architecture-options -->` as empty (the orchestrator treats an empty block as "no meaningful trade-off").

## Output Template

Append inside `<!-- section:architecture-options -->`:

```markdown
<!-- section:architecture-metadata -->
## Metadata
- **task_id**: <from Delivery Plan>
- **subtask_id**: <from Delivery Plan>
- **axis_varied**: <e.g., coupling | locality | statefulness | abstraction>
- **options_considered**: <integer, 2 or 3>
- **created_at**: <ISO 8601 UTC>
<!-- /section:architecture-metadata -->

<!-- section:architecture-option-a -->
## Option A — <one-line label, anchored on existing pattern>
**Summary:** <2–3 sentences of what this option does and how it reuses the dominant pattern from exploration-notes.>

**Trade-offs:**
- Pros: <bullet list, 1–3 items>
- Cons: <bullet list, 1–3 items>
- Risk areas: <what is fragile about this option>

**TEP implications:** `target_files` would be <files>; `implementation_steps` would be <count> steps of <character>.
<!-- /section:architecture-option-a -->

<!-- section:architecture-option-b -->
## Option B — <one-line label, varies ONE axis from A>
**Summary:** <2–3 sentences; state explicitly which axis differs from A.>

**Trade-offs:**
- Pros: <bullet list, 1–3 items>
- Cons: <bullet list, 1–3 items>
- Risk areas: <what is fragile about this option>

**TEP implications:** <same shape as A>
<!-- /section:architecture-option-b -->

<!-- section:architecture-option-c -->
## Option C — <omit block entirely when only two meaningful options exist>
**Summary:** <as above>

**Trade-offs:** <as above>

**TEP implications:** <as above>
<!-- /section:architecture-option-c -->

<!-- section:architecture-selected -->
## Selected: <A | B | C>
**Reason:** <one or two sentences citing the codebase pattern, risk profile, or explicit PROJECT_CONFIG rule that decides the choice. Reference `PROJECT_CONFIG.md#<domain>.validation_rules` when a rule decides the call.>

**Decision-Fork note:** When the gap between the top two options is narrow and the choice is reversible without rework, record the not-chosen option here as an escape hatch the TEP can reference if Executor finds a blocker.
<!-- /section:architecture-selected -->
```

## Rules

- **The selected option MUST be either A, B, or C** — never "hybrid of B and C" (hybrids defeat the purpose of separate options; if a hybrid is the right answer, present it as a named option with its own trade-off table).
- **The TEP's `tep-implementation-steps` must match the selected option.** The Reviewer will cross-check. Silent drift between the selected option and the TEP implementation is a finding.
- **Do NOT invoke `superpowers:brainstorming`, `feature-dev:feature-dev`, or any other workflow orchestrator** to populate options — those are denylisted for Lead and would re-introduce the hijack this skill was designed to prevent. Generate the options directly from exploration-notes + the Lead's own reasoning.
- **When only one meaningful option exists**, emit an empty `<!-- section:architecture-options -->` block with a short comment like `<!-- single meaningful approach; skipping multi-option analysis -->` and proceed to TEP. Do NOT fabricate weak options.
- **Cost control:** every dispatch of this skill is accounted under the Lead's turn budget (≤ 2 turns as noted above). If exploration-notes plus architecture-options together would push the Lead past its budget, shrink exploration-notes first — this skill is the higher-leverage artifact.

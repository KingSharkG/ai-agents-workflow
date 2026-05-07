---
name: project-config-review
description: Review-and-comment gate before any write to PROJECT_CONFIG.md. Invocation order → **third**: runs after `project-config-template` (init/update) or `project-config-mutate` (add/remove) has proposed changes, and before the proposing skill is allowed to write to disk. Shows change summary plus preview or diff, requires explicit approval, loops on comments. Use on every init, update, add, or remove mutation.
stage: project-config
---

# Project Config Review Skill

Present the proposed config changes to the user and require explicit approval before any write. Loop on comments until approved.

## Output Target

Interactive — two consecutive `AskUserQuestion` calls with free-form notes collection between them. No file is written by this skill.

## Presentation Format

### 1. Change summary (always)

A bullet list of adds / changes / removes, grouped by owned section. Format:

```markdown
## Proposed changes

### `<!-- section:domains -->`
- add: declared_domains = [fe, be]
- add: design_hook_domains = [fe]

### `<!-- section:fe-baseline -->`
- add: router = next-app-router
- add: data_layer = server-components

### `<!-- section:quality-gates -->`
- add: test = "pnpm test"
- add: lint = "pnpm lint"

### `<!-- section:project-best-practices -->`
- unchanged (user-editable)
```

### 2. Preview (init) or unified diff (update / add / remove)

- **init** — the full proposed file, fenced as markdown.
- **update / add / remove** — a unified diff scoped to owned sections only. User-editable sections must appear as `unchanged (user-editable)` context only.

### 3. Approval question

```
AskUserQuestion:
  question: "Apply these changes to <artifact-root>/config/PROJECT_CONFIG.md?"
  header: "Config review"
  options:
    - label: "Approve and write"
      description: "Write the file now. Creates <artifact-root>/ and <artifact-root>/tasks/.gitkeep if missing."
    - label: "Revise with comments"
      description: "Keep iterating — describe what to change next."
```

### 4. Comment loop (only if "Revise with comments")

```
AskUserQuestion:
  question: "What should change? (Notes will be applied to the proposal.)"
  header: "Revision notes"
  options:
    - label: "Wrong domain classification"
      description: "The detected classification is incorrect."
    - label: "Wrong baseline values"
      description: "Framework / router / auth provider is wrong."
    - label: "Missing or extra entries"
      description: "A skill, plugin, or rule is missing or unneeded."
    - label: "Other"
      description: "Describe the change in free text."
```

The tool's built-in "Other" option always collects free-form text. Integrate the comments into the proposal and re-enter step 1. Loop until the user picks `Approve and write`.

## Rules

- **Never write before approval.** The approval question is the gate; no file mutation is allowed before the user picks `Approve and write`.
- **Preserve user-editable sections.** In `update`/`add`/`remove` diffs, user-editable sections are shown as `unchanged (user-editable)` context only. If the user explicitly asks to change them in a comment, route the change through the corresponding `add` target-type (never rewrite in bulk).
- **Group by section.** The change summary is grouped by owned section for readability. Never interleave changes across sections in a single bullet.
- **Don't hide removals.** Every removal must appear explicitly in the summary and the diff.
- **Comment integration is not free-form editing.** When the user's notes require a change that goes beyond owned sections, say so and stop — do not write to user-editable sections without an explicit `add`.
- **Loop cap: 5 iterations.** If the user has not approved after 5 revise cycles, pause and ask whether to continue or abort. Prevents runaway loops.

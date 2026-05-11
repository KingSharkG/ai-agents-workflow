# PR Lessons Injection — Reference

Loaded by `context-minimizer/SKILL.md` when assembling **executor** or **reviewer** bundles. Read on first such bundle per session.

## When to inject

Inject a `<!-- section:pr-lessons -->` block in the bundle's `## Project Context` when assembling for **executor** or **reviewer** AND `<artifact-root>/knowledge/pr-lessons.md` exists and is non-empty.

## Filter input differs by role

- **Executor** (pre-implementation): filter by the TEP's `target_files` paths/extensions. The diff doesn't exist yet, so match on the files Executor is about to touch.
- **Reviewer** (post-implementation): filter by the changed-file paths/extensions in the diff.

In both cases the rough match is: language tag matches file extension; area tag matches a path segment. Cap at the top 10 by `Last seen` desc to keep the bundle small.

## Block format

```
<!-- section:pr-lessons -->
## PR Lessons (relevant to this <diff|task>)
- <slug>: <rule> — Fix: <fix> [Source: <first source url>]
- ...
<!-- /section:pr-lessons -->
```

Use `this task` in the heading for executor bundles and `this diff` for reviewer bundles so the agent knows what the lessons were filtered against.

## Empty-result handling

If the file is missing, empty, or no lesson tags intersect the target paths, omit the section entirely (do NOT inject an empty section). The agent stubs handle the absent case by emitting "PR Lessons: 0 loaded" once.

## Why both roles consult lessons

Executor consultation lets known issues be *avoided* during implementation rather than only *flagged* at review, reducing rework cycles. Reviewer consultation remains the safety net for cases where Executor's lesson set didn't catch something or where the diff drifted from the TEP's `target_files`.

## Boundary with `pr-lessons-check`

This injection is the canonical path for in-bundle lesson consultation. The `pr-lessons-check` skill is for direct (out-of-bundle) invocation by the user before commit / PR creation. Do not invoke `pr-lessons-check` from inside `context-minimizer` — bundle assembly stays read-only and side-effect-free.

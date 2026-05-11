---
name: implementation-report
description: Generate a structured Implementation Report after FE or BE execution. Use after code changes and command runs.
stage: execution
---

# Implementation Report Skill

Produce this report immediately after completing a subtask. Record everything that happened — do not summarize or omit failures.

## Output Target

**Append** to `<!-- section:implementation -->` in the subtask's `ai-work.md`. The section placeholder MUST already exist — if absent, raise a Blocker Escalation Report. Also write the diagnostics footer to `<subtask_id>/summary.md` per `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-telemetry/references/artifact-footer-protocol.md` (role: `executor`).

**Ultra-light path:** When the subtask qualifies for the ultra-light tier, append the compact `impl-ultra` block inside `<!-- section:implementation -->` instead of the full template below. Do NOT append to `task-data.md`.

## Output Template

Append inside `<!-- section:implementation -->`:

```markdown
<!-- section:impl-metadata -->
## Metadata
- **task_id**: <from TEP or spec>
- **subtask_id**: <from TEP or spec>
- **domain**: <subtask domain from <artifact-root>/config/PROJECT_CONFIG.md#declared_domains>
- **executor**: executor
- **created_at**: <ISO 8601 UTC>
<!-- /section:impl-metadata -->

<!-- section:impl-summary -->
## Summary of Changes
<2–4 sentences describing what was implemented>
<!-- /section:impl-summary -->

<!-- section:impl-files-changed -->
## Files Changed
- `<path>` — <what changed and why>
<!-- /section:impl-files-changed -->

<!-- section:impl-tests-run -->
## Tests Run
```bash
<exact command>
```
Result: passed | failed | skipped
<paste failing output if any>
<!-- /section:impl-tests-run -->

<!-- section:impl-dynamic-skills -->
## Dynamic Skills Used
- <skill name> — <why it was needed> (or "none")
<!-- /section:impl-dynamic-skills -->

<!-- section:impl-plugins-used -->
## Plugins Used
- <plugin name> — <why it was needed> (or "none")
<!-- /section:impl-plugins-used -->

<!-- section:impl-unresolved-issues -->
## Unresolved Issues
- <issue or "none">
<!-- /section:impl-unresolved-issues -->

<!-- section:impl-project-state -->
## Project State Update Needed
yes | no
<if yes: what section and what change> <!-- optional audit metadata; not a workflow gate -->
<!-- /section:impl-project-state -->
```

Then write the diagnostics footer (role: `executor`) per the artifact-footer protocol referenced above.

## Output Size Guidelines

These are soft targets — complex subtasks may exceed them, but typical reports should stay within these bounds to keep ai-work.md manageable across multiple cycles:

- `impl-summary`: ≤4 sentences
- `impl-files-changed`: ≤20 rows. For large diffs, group related files (e.g., "5 translation files updated with identical structure") instead of listing each individually.
- `impl-tests-run`: ≤15 lines including command and output. Truncate passing test output to the summary line; include full output only for failures.
- `impl-dynamic-skills` / `impl-plugins-used`: 1 line each unless >3 items used.

## Rules
- `impl-files-changed` must list every file that was modified, created, or deleted.
- `impl-tests-run` must include the actual command — not just "tests passed".
- `impl-plugins-used` must list every MCP plugin invoked during the run, or `none`.
- Never write "none" for unresolved issues if there are open questions or workarounds.
- `impl-project-state` is audit metadata for the orchestrator, not a workflow gate.
- **`pr-lessons-check` consultation is MANDATORY** before claiming implementation complete. The full protocol (when to invoke, what to record in `impl-dynamic-skills`, how to handle matches, audit-line format) lives in `${CLAUDE_PLUGIN_ROOT}/skills/pr-lessons-check/references/consultation-protocol.md`. Skipping the consultation is a protocol violation; reviewers will flag it.

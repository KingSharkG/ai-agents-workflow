---
name: implementation-report
description: Generate a structured Implementation Report after FE or BE execution. Use after code changes and command runs.
---

# Implementation Report Skill

Produce this report immediately after completing a subtask. Record everything that happened — do not summarize or omit failures.

## Output Target

**Append** to `<!-- section:implementation -->` in the subtask's `ai-work.md`. The section placeholder MUST already exist — if absent, raise a Blocker Escalation Report. Also append one `### <role>` subsection to `<!-- section:context-manifest -->` and one line to `<!-- section:telemetry -->`.

**Ultra-light path:** When the subtask qualifies for the ultra-light tier, append the compact `impl-ultra` block inside `<!-- section:implementation -->` instead of the full template below. Do NOT append to `task-data.md`.

## Output Template

Append inside `<!-- section:implementation -->`:

```markdown
<!-- section:impl-metadata -->
## Metadata
- **task_id**: <from TEP or spec>
- **subtask_id**: <from TEP or spec>
- **domain**: <subtask domain from ai-workflow-data/config/PROJECT_CONFIG.md#declared_domains>
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

Then append to `<!-- section:context-manifest -->`:

```markdown
### executor
| path | bucket | bytes |
| ---- | ------ | ----- |
| ... | ... | ... |
Totals: governance 0 | artifact 0 | source 0 | schema 0 | docs 0
```

Then append to `<!-- section:telemetry -->`:

```
executor | <turns_used>/<turns_budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>
```

## Rules
- `impl-files-changed` must list every file that was modified, created, or deleted.
- `impl-tests-run` must include the actual command — not just "tests passed".
- `impl-plugins-used` must list every MCP plugin invoked during the run, or `none`.
- Never write "none" for unresolved issues if there are open questions or workarounds.
- `impl-project-state` is audit metadata for the orchestrator, not a workflow gate.

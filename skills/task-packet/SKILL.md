---
name: task-packet
description: Create a structured Task Packet from a raw user request or business requirement. Use when intake begins and a clean orchestration artifact is needed.
---

# Task Packet Skill

Create a compact artifact with the fields below. Use only information actually present — mark assumptions explicitly.

## Output Target

Write to `<artifact-root>/tasks/<task_id>/task-data.md` (create new file). Wrap the entire content in `<!-- section:task-packet -->` ... `<!-- /section:task-packet -->`. The Delivery PM will append `<!-- section:delivery-plan -->` to the same file in the next step — do not create a separate `task-packet.md`.

## Output Template

```markdown
# Task Data

<!-- section:task-packet -->
## Task Packet

<!-- section:task-metadata -->
### Metadata
- **task_id**: TP-<NNN>
- **task_title**: <short title>
- **requested_by**: <user | system | upstream agent> <!-- optional audit metadata -->
- **priority**: high | medium | low <!-- optional audit metadata -->
- **created_at**: <ISO 8601 UTC>
<!-- /section:task-metadata -->

<!-- section:task-business-goal -->
### Business Goal
<one sentence — the problem being solved; optional audit context>
<!-- /section:task-business-goal -->

<!-- section:task-requirements-excerpt -->
### Requirements Excerpt
<relevant lines from PROJECT_CONFIG baselines or the task request; quote directly, do not paraphrase>
<!-- /section:task-requirements-excerpt -->

<!-- section:task-scope-estimate -->
### Scope Estimate
- **target_domains**: frontend | backend | design | domain (list all that apply)
- **high_level_scope**: <2–4 bullet points describing what will change>
<!-- /section:task-scope-estimate -->

<!-- section:task-known-blockers -->
### Known Blockers
- <blocker or "none"> <!-- optional audit context -->
<!-- /section:task-known-blockers -->

<!-- section:task-assumptions -->
### Assumptions
- <assumption or "none"> <!-- optional audit context -->
<!-- /section:task-assumptions -->

<!-- section:task-context-manifest -->
### Context Manifest
*(no files read; all context received via prompt)*
Totals: governance 0 | artifact 0 | source 0 | schema 0 | docs 0
<!-- /section:task-context-manifest -->

<!-- section:task-telemetry -->
### Telemetry
<turns_used>/<turns_budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>
<!-- /section:task-telemetry -->

<!-- /section:task-packet -->
```

## Rules
- `task_id` must be unique; use the next sequential number by scanning `<artifact-root>/tasks/` folder names.
- Do not invent requirements — only use what is explicitly stated.
- `task_title`, Requirements Excerpt, and Scope Estimate are the workflow-driving body; `requested_by`, `priority`, Business Goal, Known Blockers, and Assumptions are audit metadata and may be omitted if genuinely unavailable.
- If `requested_by` is unknown, prefer `user`; it remains optional audit metadata.
- The Delivery PM will append `<!-- section:delivery-plan -->` to this same file. Do not pre-create that section.

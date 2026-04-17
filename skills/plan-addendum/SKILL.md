---
name: plan-addendum
description: Produce a structured Design Review Addendum for subtasks in design-hook domains. Use when the Design Agent must emit an auditable addendum that Lead will merge into the TEP.
---

# Plan Addendum Skill

Use this skill to produce the Design Review Addendum for subtasks whose domain is listed in `ai-workflow-data/config/PROJECT_CONFIG.md#<!-- section:domains -->` → `design_hook_domains`.

Domain validation no longer has its own addendum — it is absorbed by the Lead internally. See `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` → `<!-- section:domain-validation-note -->`.

## Output Target

**Append** to `<!-- section:plan-addendum -->` in the subtask's `ai-work.md`. The placeholder MUST already exist — if absent, raise a Blocker Escalation. Also append one `### design-agent` subsection to `<!-- section:context-manifest -->` and one line to `<!-- section:telemetry -->`.

## Output Template

Append inside `<!-- section:plan-addendum -->`:

```markdown
<!-- section:design-metadata -->
## Metadata
- **task_id**: <from spec section>
- **subtask_id**: <from spec section>
- **agent**: design-agent
- **created_at**: <ISO 8601 UTC>
<!-- /section:design-metadata -->

<!-- section:design-findings -->
## UX Findings
- <finding or "none">
<!-- /section:design-findings -->

<!-- section:design-constraints -->
## Required Constraints for TEP
- <specific Lead-facing constraint to merge into the TEP>
<!-- /section:design-constraints -->

<!-- section:design-open-questions -->
## Open Questions
- <question or "none">
<!-- /section:design-open-questions -->
```

Then append to `<!-- section:context-manifest -->`:

```markdown
### design-agent
| path | bucket | bytes |
| ---- | ------ | ----- |
Totals: governance 0 | artifact 0 | source 0 | schema 0 | docs 0
```

Then append to `<!-- section:telemetry -->`:

```
design-agent | <turns_used>/<turns_budget> turns | tokens: ~<in>/~<out> | skills: <low|medium|high> | plugins: <low|medium|high> | <ok|OVER_BUDGET>
```

## Rules

- Write the addendum content first, then finalize manifests and telemetry.
- Keep the content specific enough that the Lead can merge it into the TEP without follow-up questions.
- Do not emit executor-facing implementation steps.

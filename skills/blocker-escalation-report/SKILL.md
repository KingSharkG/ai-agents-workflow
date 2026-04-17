---
name: blocker-escalation-report
description: Produce a structured Blocker Escalation Report when the workflow cannot progress — used after review cycle 3 is exhausted, a missing-context blocker cannot be resolved, or an agent reaches an unresolvable decision point.
---

# Blocker Escalation Report

Use this skill to produce a **Blocker Escalation Report**. This is the structured exit path when the workflow cannot progress and requires human input or re-routing.

## When to Use

- Review cycle count has reached the complexity-tied cap and issues remain unresolved
- An executor or lead agent cannot proceed without information not present in the artifact chain
- An ambiguous requirement cannot be resolved by the responsible Lead's domain-validation pass
- An external dependency (third-party API, undelivered upstream) blocks implementation
- Executor or Lead detects the Delivery Plan itself is defective (route_to: delivery-pm)
- The chief-orchestrator must escalate to the user rather than silently stalling
- The required `section:tep`, `section:spec`, or `section:implementation` placeholder is absent from `ai-work.md`

## Output Target

**Append** to `<!-- section:escalation-N -->` in the subtask's `ai-work.md`. The orchestrator assigns N (incrementing per escalation event within the subtask) and writes the placeholder before this skill runs. Also write diagnostics (telemetry line + context manifest subsection) to `<subtask_id>/summary.md`.

## Output Format

Append inside `<!-- section:escalation-N -->`:

```markdown
<!-- section:blocker-metadata -->
## Metadata
- **task_id**: <from the originating task>
- **subtask_id**: <from the Delivery Plan, if applicable>
- **blocked_agent**: <name of the agent that hit the blocker>
- **escalated_by**: <name of the agent producing this report>
- **timestamp**: <ISO 8601 UTC>
- **cycle_count**: <current review cycle number, if applicable>
<!-- /section:blocker-metadata -->

<!-- section:blocker-type -->
## Blocker Type
<!-- Select one: -->
- [ ] missing-context — required information is absent from all artifacts
- [ ] ambiguous-requirement — Task Packet or PROJECT_CONFIG baseline is unclear and inference would be unsafe
- [ ] external-dependency — blocked on an undelivered or third-party resource
- [ ] cycles-exhausted — complexity-tied review cycle cap reached without resolution
- [ ] plan-defective — Delivery Plan scope / dependencies / subtask boundaries are wrong (route_to: delivery-pm)
- [ ] missing-skeleton-section — required section placeholder absent from ai-work.md
<!-- /section:blocker-type -->

<!-- section:blocker-what-is-blocked -->
## What Is Blocked
<!-- One sentence: the specific action that cannot proceed. -->
<!-- /section:blocker-what-is-blocked -->

<!-- section:blocker-what-was-tried -->
## What Was Tried
<!-- Bullet list: what the blocked agent attempted and why it was insufficient. -->
<!-- /section:blocker-what-was-tried -->

<!-- section:blocker-required-input -->
## Required Input
<!-- Precise question(s) or decision(s) needed to unblock. -->
<!-- /section:blocker-required-input -->

<!-- section:blocker-suggested-rerouting -->
## Suggested Re-routing
<!-- Set `route_to:` — one of: lead | delivery-pm | user. -->
<!-- /section:blocker-suggested-rerouting -->
```

Then write diagnostics to `<subtask_id>/summary.md`:

- Append your telemetry line under `## Telemetry` (with status: `escalated`)
- Append your `### <blocked-agent>` context manifest subsection under `## Context Manifest`

## Rules

- A Blocker Escalation Report is a terminal artifact for its subtask. Do not attempt further implementation while it is open.
- The chief-orchestrator must surface the `required_input` to the user immediately after receiving this artifact.
- If re-routing to Delivery PM when the plan is defective, attach the escalation section content as context — do not summarize it in prose.
- After resolution, the orchestrator updates the TEP section or triggers a Lead re-run; do not resume from the stalled implementation section.
- The orchestrator's Artifact Gate still applies — section must be non-empty after the agent returns.

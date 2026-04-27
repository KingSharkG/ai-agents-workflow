# summary.md skeleton

Write to `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/summary.md`:

```markdown
# Subtask Summary — <subtask_id>

## Status
- **workflow_state**: approved | blocked-on-user | pending-integration-check | needs-replan
- **review_verdict**: approved | changes_requested | needs-replan
- **cycle_count**: <N>
- **updated_at**: <ISO 8601 UTC>

## Acceptance Signals
| Signal | State | Evidence | Notes |
| ------ | ----- | -------- | ----- |
| <acceptance signal from spec> | pass | executed | verified in simulator |
| <acceptance signal from spec> | pass | inspected | verified by code inspection |

## Files Changed
[list from impl-files-changed in section:implementation]

## Dispatch Bundles
| Role | Token Ceiling | Sections Included |
|------|--------------|-------------------|
| lead | 1800 | spec, fe-baseline, project-best-practices, lead-best-practices |
| executor | 1500 | tep, fe-baseline, DoD |
| reviewer | 2400 | implementation, spec, review-checklist, fe-baseline, DoD |

## Telemetry
lead | 3/4 turns | tokens: ~2400/~800 | skills: low | plugins: low | ok
executor | 5/6 turns | tokens: ~1800/~1200 | skills: medium | plugins: low | ok
reviewer | 2/3 turns | tokens: ~1600/~600 | skills: low | plugins: low | ok

## Context Manifest
### lead
| path | bucket | bytes |
| ---- | ------ | ----- |
| roles/lead.md (dispatch bundle) | governance | 1240 |
| ai-work.md (section:spec) | artifact | 890 |

Totals: governance 1240 | artifact 890 | source 0 | schema 0 | docs 0

### executor
| path | bucket | bytes |
| ---- | ------ | ----- |
| roles/executor.md (dispatch bundle) | governance | 1100 |
| ai-work.md (section:tep) | artifact | 2400 |
| src/components/Auth.tsx | source | 3200 |

Totals: governance 1100 | artifact 2400 | source 3200 | schema 0 | docs 0

### reviewer
| path | bucket | bytes |
| ---- | ------ | ----- |
| roles/reviewer.md (dispatch bundle) | governance | 2100 |
| ai-work.md (section:implementation) | artifact | 1500 |

Totals: governance 2100 | artifact 1500 | source 0 | schema 0 | docs 0

## Notes
[completion_summary text — 1–3 sentences describing what was delivered]

## Open Gates
- none
```

The orchestrator creates this skeleton (with empty placeholders for Dispatch Bundles, Telemetry, Context Manifest) alongside the ai-work.md skeleton. Each agent appends its telemetry line and context manifest subsection. The orchestrator populates the Dispatch Bundles table after each agent dispatch. The Reviewer finalizes the status fields, acceptance-signal table, Files Changed, Notes, and Open Gates.

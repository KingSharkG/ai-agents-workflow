# summary.md skeleton

Write to `<artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/summary.md`:

```markdown
# Subtask Summary — <subtask_id>

## Status

- **workflow_state**: approved | blocked-on-user | pending-integration-check | needs-replan
- **review_verdict**: approved | changes_requested | needs-replan
- **cycle_count**: <N>
- **updated_at**: <ISO 8601 UTC>

## Acceptance Signals

| Signal                        | State | Evidence  | Notes                       |
| ----------------------------- | ----- | --------- | --------------------------- |
| <acceptance signal from spec> | pass  | executed  | verified in simulator       |
| <acceptance signal from spec> | pass  | inspected | verified by code inspection |

## Files Changed

[list from impl-files-changed in section:implementation]

## Dispatch Bundles

<!-- section:dispatch-bundles -->

- lead for FEAT-V1-007-A1 (cycle 1): ~1800 tokens; sections: spec, fe-baseline, project-best-practices, lead-best-practices; cache_misses: none
- executor for FEAT-V1-007-A1 (cycle 1): ~1500 tokens; sections: tep, fe-baseline, DoD; cache_misses: none
- reviewer for FEAT-V1-007-A1 (cycle 1): ~2400 tokens; sections: implementation, spec, review-checklist, fe-baseline, DoD; cache_misses: none
<!-- /section:dispatch-bundles -->

## Telemetry

lead | 3/4 turns | tokens: ~2400/~800 | skills: low | plugins: low | ok
executor | 5/6 turns | tokens: ~1800/~1200 | skills: medium | plugins: low | ok
reviewer | 2/3 turns | tokens: ~1600/~600 | skills: low | plugins: low | ok

## Context Manifest

### lead

| path                      | bucket     | bytes |
| ------------------------- | ---------- | ----- |
| inline dispatch bundle    | governance | 1240  |
| ai-work.md (section:spec) | artifact   | 890   |

Totals: governance 1240 | artifact 890 | source 0 | schema 0 | docs 0

### executor

| path                     | bucket     | bytes |
| ------------------------ | ---------- | ----- |
| inline dispatch bundle   | governance | 1100  |
| ai-work.md (section:tep) | artifact   | 2400  |
| src/components/Auth.tsx  | source     | 3200  |

Totals: governance 1100 | artifact 2400 | source 3200 | schema 0 | docs 0

### reviewer

| path                                | bucket     | bytes |
| ----------------------------------- | ---------- | ----- |
| inline dispatch bundle              | governance | 2100  |
| ai-work.md (section:implementation) | artifact   | 1500  |

Totals: governance 2100 | artifact 1500 | source 0 | schema 0 | docs 0

## Notes

[completion_summary text — 1–3 sentences describing what was delivered]

## Open Gates

- none
```

The orchestrator creates this skeleton (with empty `<!-- section:dispatch-bundles -->`, Telemetry, and Context Manifest placeholders) alongside the ai-work.md skeleton. Each agent appends its telemetry line and context manifest subsection. The orchestrator appends one audit line to `<!-- section:dispatch-bundles -->` after each successful dispatch. The Reviewer finalizes the status fields, acceptance-signal table, Files Changed, Notes, and Open Gates.

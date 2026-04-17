# Workflow Fix Checklist

## P0

- [x] Define `normal` vs `degraded-inline` workflow modes in the orchestration playbook
- [x] Require degraded mode to record blockers and avoid synthetic role execution
- [x] Tighten task completion semantics around open gates and pending user actions
- [x] Make mandatory Integration Checker gates explicit in the routing rules

## P1

- [x] Standardize subtask `summary.md` structure around Status, Acceptance Signals, Telemetry, Context Manifest, Notes, and Open Gates
- [x] Update reviewer instructions to replace placeholder text rather than append contradictory status blocks
- [x] Prohibit `section:telemetry` and `section:context-manifest` inside `ai-work.md`
- [x] Update the chief-orchestrator contract to match the new summary/task-state model

## P2

- [x] Add evidence-state guidance (`executed`, `inspected`, `deferred`, `blocked`, `pending`) for acceptance signals
- [x] Strengthen artifact validation for summary headings and stale placeholder drift
- [x] Strengthen orchestration-state validation for mode, pending gates, and overclaimed completion
- [x] Warn when dispatch bundles are written during degraded mode

## Follow-up

- [ ] Update any orchestrator implementation prompts that still treat task-summary file existence as the sole completion signal
- [ ] Generate one fresh task in a consumer repo and confirm the new hooks catch misplaced diagnostics and stale summary placeholders
- [ ] Backfill any examples/templates outside the patched files that still use the old summary schema

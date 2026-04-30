# State File Schemas

The orchestrator persists state across two files inside `ai-workflow-data/tasks/<task_id>/`. See SKILL.md → "State Management Rhythm" for when each is read/written.

## `orchestration-state.json` (hot state)

```json
{
  "schema_version": 2,
  "task_id": "<task_id>",
  "classification": "direct-answer | plan-only | execution-simple | execution-full",
  "mode": "normal | degraded-inline",
  "phase": "planning | planned | execution | blocked | answered | complete",
  "current_subtask": "<subtask_id> | null",
  "pending_subtasks": ["..."],
  "blocked_gates": ["integration-check:TP-042-E2"],
  "pending_user_actions": ["run yarn install in projects/frontend/mobile"],
  "subtask_offsets": {
    "<subtask_id>": { "start_line": 157, "end_line": 195 }
  },
  "gates": {
    "p1_approved": false,
    "p1_approved_at": null,
    "p1_approved_signature": null,
    "p1_revise_count": 0
  },
  "task_summary_path": "ai-workflow-data/tasks/<task_id>/summary.md"
}
```

**`schema_version`** — integer. `2` is the first version that carries the `gates` object and is enforced by `hooks/guard-pre-dispatch-p1.js`. Files lacking this field are treated as legacy v1 and pass the P1 gate without check; on first orchestrator touch they MUST be upgraded in place to `schema_version: 2` with `gates.p1_approved: true`, `gates.p1_approved_at: <upgrade-timestamp>`, and `gates.p1_approved_signature: "legacy-migration"` so future re-plans / rework re-engage the gate.

**`gates.p1_approved`** — boolean. The orchestrator sets this to `true` only after `AskUserQuestion` returns `Approve plan` at the P1 gate. Any subsequent `Revise plan` resets it to `false` (and clears the timestamp + signature) before re-presenting the revised plan. The runtime hook `guard-pre-dispatch-p1.js` reads this field to block subtask agent dispatches (`lead`, `executor`, `reviewer`, `design-agent`, `integration-checker`) when it is not `true`.

**`gates.p1_approved_signature`** — sha256 hex digest of the bytes the user actually approved (the rendered Block 1 + Block 2 + Block 3 of the P1 presentation, normalized). Lets the orchestrator detect "user approved an old plan that has since been silently revised" — if a revision has changed the plan since approval, the signature mismatches and the gate must be re-presented.

**`gates.p1_revise_count`** — integer. Persists the cumulative count of `Revise plan` selections at P1 across the lifetime of this task (including across `/continue` resumes). Incremented on every `Revise plan`; never reset by `Approve plan` (so the cap also bounds the total churn, not just consecutive cycles). The `orchestrator-user-gates` skill reads this field to enforce the 5-iteration revise cap — at `p1_revise_count >= 5`, the orchestrator must surface a continue-or-abort prompt instead of re-presenting silently.

## `orchestration-history.json` (history; written once per subtask completion)

```json
{
  "task_id": "<task_id>",
  "completed_subtasks": [
    {
      "subtask_id": "...",
      "verdict": "approved",
      "cycles": 1,
      "summary_path": "...",
      "sections": ["spec", "tep", "implementation", "review"]
    }
  ],
  "trigger_decisions": {
    "<subtask_id>": { "design_agent": "skipped|required", "lead": "required|direct-executor", "integration_checker": "skipped|required|conditional" }
  }
}
```

**`completed_subtasks[].sections`** — the list of `<!-- section:... -->` tag slugs (without the `section:` prefix) that the Artifact Gate verified non-empty in this subtask's `ai-work.md` at the moment of closure. Populated during Post-Approval Closure by greping the subtask's `ai-work.md` once, so P4 can validate the task-level artifact chain from the map instead of re-opening every subtask file. Valid values per stage are defined by `orchestrator-dispatch` skill → "Artifact Gate" stage-based section requirements. An ultra-light subtask records `["spec", "implementation", "review"]` (no TEP); a standard subtask records `["spec", "tep", "implementation", "review"]`; a cross-domain subtask with integration check adds `"integration-check"`. Escalation sections (`escalation-1`, `escalation-2`, ...) are appended when present.

`task_id` is duplicated across both files as a consistency key — when reading both at a gate, verify the two `task_id` values match; a mismatch signals corruption and should trigger a blocker escalation rather than silent proceed.

## Migration

### v1 → v2 (P1 gate enforcement)

On first orchestrator touch of any task whose `orchestration-state.json` lacks `schema_version` (legacy v1, pre-`gates`-field), upgrade in place:

1. Read the current `orchestration-state.json`.
2. Add `schema_version: 2` and `gates: { p1_approved: true, p1_approved_at: <ISO-8601 of upgrade>, p1_approved_signature: "legacy-migration", p1_revise_count: 0 }`. The "approved-by-default" treatment is intentional — these tasks were created and approved under the prior protocol; re-prompting for approval mid-execution would block in-flight work for no safety benefit.
3. Write atomically (temp-file + rename).
4. Future `Revise plan` actions on the upgraded task reset `gates.p1_approved` to `false` exactly as for newly-created tasks.

The runtime hook `guard-pre-dispatch-p1.js` allows dispatch on missing `schema_version` and prints a one-line stderr warning naming the task id, so legacy tasks can complete their next dispatch even if the orchestrator has not yet performed the upgrade.

### Legacy field split (history vs hot state)

On first read after upgrade, if `orchestration-history.json` is absent but `orchestration-state.json` contains `completed_subtasks` or `trigger_decisions`, split the state:

1. Read the current `orchestration-state.json`.
2. Extract `completed_subtasks` and `trigger_decisions` into a new `orchestration-history.json`; set `task_id` from the hot file.
3. Rewrite `orchestration-state.json` without those fields.
4. Both writes go through temp-file + rename for atomicity. The history file is written first, so a crash mid-migration leaves the hot file intact with the legacy fields (readers that see legacy fields in the hot file must tolerate them for one more dispatch cycle).

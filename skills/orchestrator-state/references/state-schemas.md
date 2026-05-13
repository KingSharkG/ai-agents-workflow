# State File Schemas

The orchestrator persists state across two files inside `<artifact-root>/tasks/<task_id>/`. See SKILL.md → "State Management Rhythm" for when each is read/written.

## `orchestration-state.json` (hot state)

```json
{
  "schema_version": 3,
  "task_id": "<task_id>",
  "classification": "direct-answer | plan-only | execution-trivial | execution-simple | execution-full",
  "mode": "normal | degraded-inline",
  "phase": "planning | planned | execution | blocked | complete",
  // ^ Note: `answered` exists in the conceptual enum for `direct-answer` tasks
  //   but never appears in a persisted state file — those tasks create zero
  //   artifacts. Listed here for completeness only; readers MUST NOT treat its
  //   absence from a persisted file as malformed.
  "stage": "intake | planning | execution | closure",
  "previous_stage": null,
  "stage_history": [
    {
      "stage": "intake",
      "entered_at": "2026-05-07T10:00:00Z",
      "exited_at": "2026-05-07T10:00:30Z",
      "exit_reason": "classified"
    }
  ],
  "stage_reopen_count": 0,
  "current_subtask": "<subtask_id> | null",
  "pending_subtasks": ["..."],
  "pending_subtasks_needing_rereview": [],
  "last_completed_seq": 0,
  "blocked_gates": ["integration-check:TP-042-E2"],
  "pending_user_actions": ["run yarn install in projects/frontend/mobile"],
  "subtask_offsets": {
    "<subtask_id>": { "start_line": 157, "end_line": 195 }
  },
  "gates": {
    "p1_approved": false,
    "p1_approved_at": null,
    "p1_approved_signature": null,
    "p1_revise_count": 0,
    "p1_signature_at_stage_entry": null
  },
  "task_summary_path": "<artifact-root>/tasks/<task_id>/summary.md"
}
```

### Field reference (scannable summary)

| Field | Type | Required? | Mutable? | Notes |
|---|---|---|---|---|
| `schema_version` | int | Y | once (on upgrade) | Currently `3` |
| `task_id` | string | Y | no | Mirrored in history file as consistency key |
| `classification` | enum | Y | once (P1 override only) | `direct-answer \| plan-only \| execution-trivial \| execution-simple \| execution-full` |
| `mode` | enum | Y | yes (degraded recovery) | `normal \| degraded-inline` |
| `phase` | enum | Y | yes | `planning \| planned \| execution \| blocked \| complete` (`answered` conceptual-only — see schema example) |
| `stage` | enum | Y (v3+) | yes (on transition) | `intake \| planning \| execution \| closure` |
| `previous_stage` | enum or null | Y (v3+) | yes (on transition) | `null` on first stage entry |
| `stage_history[]` | array | Y (v3+) | append-only | `{ stage, entered_at, exited_at, exit_reason }` per entry |
| `stage_reopen_count` | int ≥ 0 | Y (v3+) | yes (incr only) | Soft cap at `>= 3` |
| `current_subtask` | string or null | Y | yes | Set when first agent dispatches; cleared on subtask close |
| `pending_subtasks[]` | array | Y | yes | Consumed FIFO per plan order |
| `pending_subtasks_needing_rereview[]` | array | Y (v3+) | yes | Filled by auto-diff on reopen; cleared on re-approval |
| `last_completed_seq` | int ≥ 0 | Y | yes (incr only) | Mirrors `history.completed_subtasks.length` |
| `blocked_gates[]` | array | Y | yes | Open workflow gates |
| `pending_user_actions[]` | array | Y | yes | External actions waited on |
| `subtask_offsets` | object | Y | once (after Delivery PM) | Subtask → line range in `task-data.md` |
| `gates.p1_approved` | bool | Y | yes | Reset on `Revise plan` |
| `gates.p1_approved_at` | ISO-8601 or null | Y | yes | Set on Approve, cleared on Revise |
| `gates.p1_approved_signature` | sha256 hex or null | Y | yes | Set on Approve, cleared on Revise |
| `gates.p1_revise_count` | int ≥ 0 | Y | yes (incr only) | Lifetime counter, soft cap at 5 |
| `gates.p1_signature_at_stage_entry` | sha256 hex or null | Y (v3+) | yes | Snapshot on every entry to `planning` |
| `task_summary_path` | string | Y (post-intake) | once | Canonical task-level summary path |

(Each row's full semantics live in the prose below — the table is for scannability; the prose is authoritative on edge cases.)

**`schema_version`** — integer. Current value is `3`. The v2→v3 bump adds the top-level lifecycle stage tracking (`stage`, `previous_stage`, `stage_history[]`, `stage_reopen_count`, `pending_subtasks_needing_rereview[]`, `gates.p1_signature_at_stage_entry`). v3 has **no migration path** — see "Migration" below.

**`stage`** — string. The coarse-grained lifecycle stage of the task. One of `intake | planning | execution | closure`. Coexists with the finer-grained `phase` field (which describes execution-cursor state inside a stage). Every state mutation MUST set this field; the orchestrator is responsible for stage transitions per the rules in `SKILL.md` → "Stage Discipline".

**`previous_stage`** — string or null. The stage the task was in immediately before the current `stage`. Used to disambiguate stage reopens (e.g., `previous_stage: "execution"` after a `needs-replan` rewinds to `planning`). `null` on the very first stage entry. **Exception — trivial-path Step 2 compound init**: the execution-trivial flow writes a single initial state with `previous_stage: "intake"` and a `stage_history[]` of two entries (closed intake + open execution) because it collapses the `intake → execution` transition into the first write. Readers MUST NOT treat `previous_stage === null` as the sole signal of "freshly initialized task" — also accept the trivial-init shape (`previous_stage: "intake"` + `stage_history.length === 2` + `stage_history[0].exit_reason === "classified"`).

**`stage_history[]`** — array of `{ stage, entered_at, exited_at, exit_reason }` objects, one per stage entry, in chronological order. The most recent entry corresponds to the current `stage`; if the current stage is non-terminal in this lifecycle the entry is "open" with `exited_at: null` and `exit_reason: null`. Closed entries have both fields set. `exit_reason` enum: `classified | p1-approved-execute | p1-approved-stop | p1-signature-unchanged | p1-rejected | needs-replan | p2-replan | reversal | all-subtasks-approved | p4-approved | completed-without-p4 | escalated | overridden-continue`. The `completed-without-p4` value is used for closure entries that terminate the task without firing P4 (the documented default for `plan-only` and `execution-trivial` paths); it lets the closure entry be closed cleanly rather than left open with `exited_at: null`.

**`stage_reopen_count`** — non-negative integer. Counts the number of times the task has rewound to an earlier stage (`execution → planning` for needs-replan / p2-replan, `closure → execution` for reversal). Initialized to `0`. Incremented after each successful reopen. The `orchestrator-user-gates` skill enforces a soft cap at `>= 3` — the would-be 4th reopen triggers a `blocker-escalation-report` AND a "Continue anyway / Abort task" P-gate.

**`pending_subtasks_needing_rereview[]`** — array of subtask IDs that must re-enter the review cycle after a reopen, populated by the auto-diff procedure (`SKILL.md` → "Auto-diff for affected subtasks"). Subtasks not in this list retain their prior `verdict: approved` status across the reopen. **Clear point:** each subtask ID is removed from this array the moment its re-review completes with `verdict: approved` (post-approval closure step in `SKILL.md`). The array is `[]` when all queued re-reviews have closed; the orchestrator MUST NOT carry stale IDs into a subsequent reopen — the next reopen's auto-diff overwrites the array from scratch, but cleanup-on-close keeps the field meaningful as a live "who still owes a re-review" cursor.

**`gates.p1_signature_at_stage_entry`** — sha256 hex digest of the normalized delivery-plan section bytes, snapshotted on **every** entry to `planning` (both the initial `intake → planning` transition AND any `execution → planning` soft reopen). Per `${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/references/stage-discipline.md`, this gives the orchestrator a stable baseline to compare against on the next `planning → execution` transition: if the new plan's signature matches the snapshot, the re-entry is silent; if it differs, P1 must re-fire. In a persisted state file, `null` appears only for `execution-trivial` tasks (which jump `intake → execution` and never enter the planning stage). Direct-answer tasks never persist a state file at all, so the field is conceptually `null` for them but never observed on disk.

**`gates.p1_approved`** — boolean. The orchestrator sets this to `true` only after `AskUserQuestion` returns `Approve plan` at the P1 gate. Any subsequent `Revise plan` resets it to `false` (and clears the timestamp + signature) before re-presenting the revised plan. The runtime hook `pre-task-guard.js` (Phase 3) reads this field to block subtask agent dispatches (`lead`, `executor`, `reviewer`, `design-agent`, `integration-checker`) when it is not `true`.

**`gates.p1_approved_signature`** — sha256 hex digest of the bytes the user actually approved (the rendered Block 1 + Block 2 + Block 3 of the P1 presentation, normalized). Lets the orchestrator detect "user approved an old plan that has since been silently revised" — if a revision has changed the plan since approval, the signature mismatches and the gate must be re-presented.

**`gates.p1_revise_count`** — integer. Persists the cumulative count of `Revise plan` selections at P1 across the lifetime of this task (including across `/continue` resumes). Incremented on every `Revise plan`; never reset by `Approve plan` (so the cap also bounds the total churn, not just consecutive cycles). The `orchestrator-user-gates` skill reads this field to enforce the 5-iteration revise cap — at `p1_revise_count >= 5`, the orchestrator must surface a continue-or-abort prompt instead of re-presenting silently.

**`task_summary_path`** — string. Absolute (or artifact-root-relative) path to `<artifact-root>/tasks/<task_id>/summary.md` — the finalized task-level summary the orchestrator (via `telemetry-summary`) writes at task closure. Initialized to the canonical path string the moment the orchestrator writes the *first* `orchestration-state.json` after the intake-stage state file (i.e., on the `intake → planning` transition, before any subtask agent runs). The validator (`hooks/validate-artifact-chain.js`) treats this field as optional during `stage: intake` and required for every later stage, mirroring this convention. Resume-orchestrator reads it to locate the task summary file without re-deriving the path. Never mutated after first set — the path is purely a function of `task_id` and the artifact-root layout.

**`last_completed_seq`** — integer. Mirrors `orchestration-history.json` → `completed_subtasks.length`. Initialized to `0`; incremented by exactly 1 in step 2 of the post-subtask transactional sequence (see SKILL.md → "State Management Rhythm" — history is written first, then this field is incremented). The P4 consistency check requires `state.last_completed_seq === history.completed_subtasks.length`, every history entry has a non-empty `sections[]` array, and history `subtask_id`s are disjoint from `state.pending_subtasks`. Mismatch triggers a `blocker-escalation-report` and recovery prompt — there is NO silent fallback for `schema_version >= 2` tasks. Legacy state without this field gets one-shot per-subtask grep fallback and emits a `legacy-history` telemetry line.

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

### v2 → v3 (stage lifecycle tracking)

There is **no programmatic migration** from v2 to v3. The v3 fields (`stage`, `previous_stage`, `stage_history[]`, `stage_reopen_count`, `pending_subtasks_needing_rereview[]`, `gates.p1_signature_at_stage_entry`) are written by the orchestrator on every state mutation under v3; the runtime hook (`pre-task-guard.js` Phase 3.5, landed in commit B of the stage refactor) silently no-ops on state files that lack `stage`, so a stale v2 state file is functionally invisible to the stage guard but will misbehave under v3 orchestrator logic that assumes the new fields exist.

**Policy:** wipe `<artifact-root>/tasks/` on upgrade and start fresh. The plugin currently has a single user; migration tooling is not warranted. If you need to keep an in-flight v2 task, complete it under the v2 plugin version before upgrading.

### v1 → v2 (P1 gate enforcement)

On first orchestrator touch of any task whose `orchestration-state.json` lacks `schema_version` (legacy v1, pre-`gates`-field), upgrade in place:

1. Read the current `orchestration-state.json`.
2. Add `schema_version: 2` and `gates: { p1_approved: true, p1_approved_at: <ISO-8601 of upgrade>, p1_approved_signature: "legacy-migration", p1_revise_count: 0 }`. The "approved-by-default" treatment is intentional — these tasks were created and approved under the prior protocol; re-prompting for approval mid-execution would block in-flight work for no safety benefit.
3. Write atomically (temp-file + rename).
4. Future `Revise plan` actions on the upgraded task reset `gates.p1_approved` to `false` exactly as for newly-created tasks.

The runtime hook `pre-task-guard.js` (Phase 3) allows dispatch on missing `schema_version` and prints a one-line stderr warning naming the task id, so legacy tasks can complete their next dispatch even if the orchestrator has not yet performed the upgrade.

### Legacy field split (history vs hot state)

**Owner:** the `orchestrator-state` skill performs this split — it owns every write to both state files, and any reader that encounters legacy fields in the hot file delegates to the skill before continuing. No other skill or hook should attempt the split.

On first read after upgrade, if `orchestration-history.json` is absent but `orchestration-state.json` contains `completed_subtasks` or `trigger_decisions`, split the state:

1. Read the current `orchestration-state.json`.
2. Extract `completed_subtasks` and `trigger_decisions` into a new `orchestration-history.json`; set `task_id` from the hot file.
3. Rewrite `orchestration-state.json` without those fields.
4. Both writes go through temp-file + rename for atomicity. The history file is written first, so a crash mid-migration leaves the hot file intact with the legacy fields (readers that see legacy fields in the hot file must tolerate them for one more dispatch cycle).
5. Emit a `legacy-split-migrated` telemetry line into the task-level `summary.md` so retrospective captures the migration event.

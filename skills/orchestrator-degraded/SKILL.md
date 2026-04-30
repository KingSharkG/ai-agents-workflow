---
name: orchestrator-degraded
description: Degraded-inline mode protocol, hook-block disambiguation, and recovery rules. Use when a dispatch fails or is blocked, to decide whether to self-correct or enter degraded mode.
---

# Orchestrator Degraded Mode — Dispatch Failure Handling

When agent dispatch fails or is blocked, this skill decides whether the orchestrator can self-correct or must enter `mode: degraded-inline`.

## Hook block ≠ tool unavailable

Before concluding that agent dispatch is unavailable, inspect the error:

- If the `Agent` call was blocked with a `[pre-task-guard] BLOCKED:` message, this is a **recoverable pre-condition failure** — NOT tool unavailability. The hook is telling you that a required artifact is missing. Correct action:
  1. Read the BLOCKED message to identify the missing file (`ai-work.md` or `orchestration-state.json`).
  2. Create the missing artifact using the appropriate protocol (see `orchestrator-dispatch` skill → Subtask Skeleton / Pre-Dispatch Checklist).
  3. Re-run the Pre-Dispatch Checklist to confirm all files exist.
  4. Retry the dispatch. Do NOT enter `degraded-inline` for this case.

Only enter `degraded-inline` when dispatch fails for a reason you **cannot self-correct**: the tool is absent from your tool list, the user explicitly denied the call, or the harness returned a non-hook error that makes dispatch structurally impossible.

## Entering `mode: degraded-inline`

If agent dispatch is genuinely unavailable, blocked by the harness, or explicitly denied, the orchestrator MUST switch to `mode: degraded-inline` in `orchestration-state.json`.

In `mode: degraded-inline`:

1. Record the blocker and any required user action.
2. Request explicit user waiver before continuing past intake / blocker documentation.
3. Do NOT create dispatch bundles under `roles/`.
4. Do NOT fabricate role-owned artifacts or claim that Lead / Executor / Reviewer / Integration Checker ran.
5. Keep mandatory workflow gates open (`pending-integration-check`, `blocked-on-user`, etc.) until they are genuinely satisfied.

Returning normal-looking workflow artifacts while dispatch is unavailable is an orchestration defect.

## Recovery from degraded-inline

When the user resumes via `/continue`, the orchestrator re-tests dispatch availability. If agent dispatch is now available, switch `mode` back to `normal` in `orchestration-state.json` and resume the normal workflow from the current resume point. If dispatch is still unavailable, surface the blocker again and remain in `degraded-inline`.

## Hard constraint

`degraded-inline` mode is strictly for dispatch/tooling failures. It MUST NOT be used for `direct-answer` or `plan-only` classification paths (see `orchestrator-intake` skill → Hard Constraints).

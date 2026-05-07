# Subtask Skeleton + Pre-Dispatch Checklist

Procedural detail for the orchestrator's "before any dispatch" steps. Read once per session — content is stable. The Artifact Gate, Post-Dispatch File Verification, and clarifying-questions hold remain in `SKILL.md` since they apply at gate-time and are referenced from multiple places in the orchestration flow.

## Subtask Skeleton (MANDATORY before any agent dispatch)

Before dispatching any agent for a subtask, the orchestrator MUST write the `ai-work.md` skeleton using the template in `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:ai-work-skeleton -->`.

1. Extract `<!-- section:delivery-subtask-<id> -->` from `task-data.md`.
2. Write `<artifact-root>/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` with the spec copied into `<!-- section:spec -->` and all other section placeholders present.
3. Write `<subtask_id>/summary.md` with placeholder sections for Status, Acceptance Signals, Files Changed, Dispatch Bundles, Telemetry, Context Manifest, Notes, and Open Gates (see `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:summary-skeleton -->`).
4. The skeleton creation counts as the orchestrator's write before any agent is dispatched.

Ultra-light subtasks use the ultra-light skeleton template (no `section:tep` or `section:plan-addendum` placeholders).

## Pre-Dispatch Checklist (MANDATORY — execute before EVERY agent dispatch)

Before dispatching any agent for subtask `<subtask_id>`, run these file-existence checks via Bash. Do NOT skip this step — hooks may not fire on nested subagent dispatches, making this the primary enforcement mechanism.

```bash
test -f <artifact-root>/tasks/<task_id>/<subtask_id>/ai-work.md && echo "ai-work.md: OK" || echo "MISSING: ai-work.md"
test -f <artifact-root>/tasks/<task_id>/orchestration-state.json && echo "state: OK" || echo "MISSING: orchestration-state.json"
```

The Pre-Dispatch Checklist only tests `orchestration-state.json` (hot state). It does NOT require `orchestration-history.json` to exist — the history file is created on the first subtask completion, not at task start, and is only read at gates/resume. See the `orchestrator-state` skill for the hot/history split. Bundles are inline in the Task prompt and not on disk; the `context-minimizer` invocation that produces them is a separate obligation enforced at the role-contract level (see "Bundle composition obligation" below).

If ANY check prints "MISSING":

1. **STOP** — do NOT dispatch the agent.
2. Create the missing file using the appropriate protocol:
   - `ai-work.md` → write skeleton from `ARTIFACT_DISCIPLINE.md` → `<!-- section:ai-work-skeleton -->`
   - `orchestration-state.json` → write initial hot state per `orchestrator-state` skill
3. Re-run the checklist to confirm all files now exist.
4. Only then proceed with the agent dispatch.

This checklist applies to ALL agent dispatches including Lead, Executor, Reviewer, Design Agent, and Integration Checker. It does NOT apply to Delivery PM (which operates at task level, not subtask level).

## Bundle composition obligation

Even though the bundle is no longer a file, the orchestrator MUST still invoke `context-minimizer` before each dispatch and embed the resulting payload inline in the Task `prompt`. After dispatch returns, the orchestrator MUST append a one-line audit entry to `<subtask_id>/summary.md` → `<!-- section:dispatch-bundles -->` capturing role, subtask, cycle, token count, sections included, and any cache misses. Reviewer reads these audit lines to verify the bundle obligation was honored. Skipping `context-minimizer` and dispatching with an unstructured prompt is an orchestration defect — Reviewer will reject the work as out-of-protocol.

---
name: orchestrator-dispatch
description: Dispatch bundle protocol, subtask skeleton, pre-dispatch checklist, post-dispatch artifact gate, and token-saving / delta-review rules. Use before EVERY agent dispatch (except direct-answer and Delivery PM task-level intake) and after every return.
---

# Orchestrator Dispatch — Bundle, Skeleton, Gate

Every agent dispatch MUST be preceded by the Pre-Dispatch Checklist and followed by the Artifact Gate. This skill owns all procedures from "orchestrator is about to dispatch an agent" through "orchestrator has accepted the returned artifact."

## Dispatch Bundle Model

All agents (Lead, Executor, Reviewer, Delivery PM, Design Agent, Integration Checker) receive their context via a **dispatch bundle** — a single markdown file written by the orchestrator before each dispatch. Agents do NOT independently read canonical contracts, PROJECT_CONFIG.md sections, or governance files.

Dispatch bundles are valid only in `mode: normal`. In `mode: degraded-inline`, the orchestrator MUST NOT create `roles/<role>.md` files or record synthetic dispatch outcomes for those roles.

**Bundle path convention:**
- Subtask agents: `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/roles/<role>.md`
- Delivery PM: `ai-workflow-data/tasks/<task_id>/roles/delivery-pm.md`

**Startup sequence:**
1. Harness reads the stub (`agents/<role>.md`) — spins up with tools, model, permissionMode.
2. Agent reads the dispatch bundle at the path provided in the orchestrator's prompt.
3. Agent performs the work and appends its artifact section.

Bundle contents are assembled by the `context-minimizer` skill — see `${CLAUDE_PLUGIN_ROOT}/skills/context-minimizer/SKILL.md` → "Bundle Format" for the section list (role contract, project context, governance, artifact input).

Menu guard rail: the agent's allowed skills for the subtask are `base_skills ∪ domain.skills`; allowed plugins are `base_plugins ∪ domain.plugins`. Both lists are included in the dispatch bundle's Project Context section.

**Retention:** Bundles persist after agent completion. Their key data (role, token ceiling used, sections included) is summarized into `<subtask_id>/summary.md` by the orchestrator. Bundle files may then be deleted.

## Dispatch Bundle Protocol (MANDATORY)

Before every agent dispatch, the orchestrator MUST:

1. Run the `context-minimizer` skill for the target agent role to assemble the bundle content.
2. Write the bundle file to `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/roles/<role>.md` (for delivery-pm: `ai-workflow-data/tasks/<task_id>/roles/delivery-pm.md`).
3. Verify the assembled governance/context excerpts stay within the ceiling defined in the `context-minimizer` skill's "Token Ceilings per Role" table. If exceeded, re-excerpt until it fits — never silently exceed.
4. Pass the bundle file path in the agent's dispatch prompt.

Agents read ONLY the dispatch bundle (plus their own stub for tool/model config). Violation of this protocol is an orchestration defect.

## Subtask Skeleton (MANDATORY before any agent dispatch)

Before dispatching any agent for a subtask, the orchestrator MUST write the `ai-work.md` skeleton using the template in `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:ai-work-skeleton -->`.

1. Extract `<!-- section:delivery-subtask-<id> -->` from `task-data.md`.
2. Write `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/ai-work.md` with the spec copied into `<!-- section:spec -->` and all other section placeholders present.
3. Write `<subtask_id>/summary.md` with placeholder sections for Status, Acceptance Signals, Files Changed, Dispatch Bundles, Telemetry, Context Manifest, Notes, and Open Gates (see `${CLAUDE_PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md` → `<!-- section:summary-skeleton -->`).
4. The skeleton creation counts as the orchestrator's write before any agent is dispatched.

Ultra-light subtasks use the ultra-light skeleton template (no `section:tep` or `section:plan-addendum` placeholders).

## Pre-Dispatch Checklist (MANDATORY — execute before EVERY agent dispatch)

Before dispatching any agent for subtask `<subtask_id>`, run these file-existence checks via Bash. Do NOT skip this step — hooks may not fire on nested subagent dispatches, making this the primary enforcement mechanism.

```bash
test -f ai-workflow-data/tasks/<task_id>/<subtask_id>/ai-work.md && echo "ai-work.md: OK" || echo "MISSING: ai-work.md"
test -f ai-workflow-data/tasks/<task_id>/<subtask_id>/roles/<role>.md && echo "bundle: OK" || echo "MISSING: dispatch bundle"
test -f ai-workflow-data/tasks/<task_id>/orchestration-state.json && echo "state: OK" || echo "MISSING: orchestration-state.json"
```

The Pre-Dispatch Checklist only tests `orchestration-state.json` (hot state). It does NOT require `orchestration-history.json` to exist — the history file is created on the first subtask completion, not at task start, and is only read at gates/resume. See the `orchestrator-state` skill for the hot/history split.

If ANY check prints "MISSING":

1. **STOP** — do NOT dispatch the agent.
2. Create the missing file(s) using the appropriate protocol:
   - `ai-work.md` → write skeleton from `ARTIFACT_DISCIPLINE.md` → `<!-- section:ai-work-skeleton -->`
   - `roles/<role>.md` → invoke the `context-minimizer` skill for the target role
   - `orchestration-state.json` → write initial hot state per `orchestrator-state` skill
3. Re-run the checklist to confirm all files now exist.
4. Only then proceed with the agent dispatch.

This checklist applies to ALL agent dispatches including Lead, Executor, Reviewer, Design Agent, and Integration Checker. It does NOT apply to Delivery PM (which operates at task level, not subtask level).

### Clarifying-Questions Hold (Executor / Integration Checker dispatches only)

After the Lead returns, but BEFORE dispatching Executor (or Integration Checker when it would precede implementation), inspect the subtask's `ai-work.md` for a non-empty `<!-- section:tep-clarifying-questions -->` block:

```bash
awk '/<!-- section:tep-clarifying-questions -->/,/<!-- \/section:tep-clarifying-questions -->/' \
  ai-workflow-data/tasks/<task_id>/<subtask_id>/ai-work.md \
  | grep -E '^\s*[0-9]+\.\s+\*\*' | head -1
```

If the grep returns a line (i.e., at least one numbered question exists), enter the **clarifying-questions hold**:

1. **Do NOT dispatch Executor.** Pause the subtask.
2. Present each question to the user verbatim via `AskUserQuestion`, one question per call (respecting the AskUserQuestion 2–4-options constraint; use "Other" for free text when the question cannot be pre-multi-choiced).
3. Record each answer as an `### Answered <YYYY-MM-DD HH:MM UTC>` subsection appended inside `<!-- section:tep-clarifying-questions -->`.
4. Update `orchestration-state.json` → `pending_user_actions` to clear the hold once every question carries an answer.
5. Only when every question has an `Answered` subsection does Executor dispatch resume.

This hold is a first-class user gate (sibling to P1 / P2 / P4). It does NOT require a P-number because it is subtask-local, but it is surfaced through the same `orchestrator-user-gates` skill so the UX is consistent.

An empty `<!-- section:tep-clarifying-questions -->` block, or its absence entirely, means no hold — proceed with Executor dispatch normally.

## Artifact Gate (MANDATORY — evaluate after every dispatch returns)

Every agent dispatch must terminate in one of exactly two valid outcomes:

- The agent has appended the expected section to `ai-work.md` (and written `summary.md` if the agent is the Reviewer), OR
- A **Blocker Escalation Report** appended to `<!-- section:escalation-N -->` in `ai-work.md` via the `blocker-escalation-report` skill.

Reject any dispatch result that:

1. Returns with **no section appended** to `ai-work.md` (agent returns prose only, returns mid-investigation, or times out mid-turn).
2. Is **missing the telemetry line** in `<subtask_id>/summary.md` → `## Telemetry`.
3. Is **missing the context manifest subsection** `### <role>` in `<subtask_id>/summary.md` → `## Context Manifest`.

**Stage-based section requirements** (check after each agent):

| Stage | Required in ai-work.md |
|-------|------------------------|
| subtask-initialized | `section:spec` non-empty; sibling `summary.md` exists with `## Status`, `## Telemetry`, `## Context Manifest`, and `## Open Gates` headings |
| after-design-agent | + `section:plan-addendum` non-empty (if triggered) |
| after-lead | + `section:tep` non-empty |
| after-executor | + `section:implementation` non-empty |
| after-integration-checker | + `section:integration-check` non-empty (if triggered) |
| after-reviewer | + `section:review` non-empty; `<subtask_id>/summary.md` exists |
| escalation | + `section:escalation-N` matching count |
| task-done | task-root `ai-workflow-data/tasks/<task_id>/summary.md` exists AND `## Task Status` says `workflow_state: complete` with zero open gates and zero pending user actions |

**Escalation-N assignment rule:** Before appending an escalation section, count all existing `<!-- section:escalation-* -->` blocks in the subtask's `ai-work.md` and set N = count + 1. Always recount from the file — never rely on in-memory state.

On rejection for reason (1), do NOT re-dispatch the same agent. Inspect `ai-work.md` to determine what partial work occurred, then route to the relevant Lead for re-validation or surface the gap to the user.

## Post-Dispatch File Verification

After every agent dispatch returns, run:

```bash
ls ai-workflow-data/tasks/<task_id>/<subtask_id>/
head -20 ai-workflow-data/tasks/<task_id>/<subtask_id>/summary.md
```

Verify:

1. `ai-work.md` exists and was modified (not just the skeleton).
2. `summary.md` contains diagnostic headings (`## Telemetry`, `## Context Manifest`).
3. If `ai-work.md` is missing entirely, this indicates the Pre-Dispatch Checklist was skipped — flag as an orchestration defect and do NOT proceed to the next agent in the chain.

After accepting a subtask completion, read `<subtask_id>/summary.md` (written by Reviewer) and extend `ai-workflow-data/tasks/<task_id>/summary.md` with a new row in the **Context Breakdown** table using the manifest totals from `<!-- section:context-manifest -->`, and refresh the **Repeat reads** line. Use the `telemetry-summary` skill for the exact template.

## Token-saving rules

- Dispatch bundles replace direct governance reads — agents receive only pre-curated excerpts within token ceilings
- Only send the relevant section from `ai-work.md`, not the full file
- Only send target files/modules, not the whole repo
- For `task-data.md`, send only the matching `delivery-subtask-*` section by default
- For orchestrator closure, read `<subtask_id>/summary.md` directly
- For Lead intake on subtasks with a design addendum, send only the `design-*` body sections from `<!-- section:plan-addendum -->`
- For Integration Checker, prefer `impl-files-changed`, `impl-tests-run`, and direct contract excerpts from `<!-- section:implementation -->`
- `delivery-routing`, `delivery-context-manifest`, and `delivery-telemetry` are orchestrator-facing sections and should NOT be included in dispatch bundles
- Follow the single-fact-per-artifact rule — reference earlier sections by name instead of repeating content
- Orchestrator MUST use `subtask_offsets` from `orchestration-state.json` for targeted reads of `task-data.md` — never load the full file after the planning phase

## Delta-review protocol (rework cycles)

For review cycle N > 1, dispatch bundles carry only delta context. The canonical rules — Medium/Low routing (Executor → Reviewer direct), High routing (Executor → Lead → Executor → Reviewer), and the cycle-N>2 finding-ID delta — live in `${CLAUDE_PLUGIN_ROOT}/skills/context-minimizer/SKILL.md` under `### executor` → "Rework bundle (cycle N > 1)" / "Executor rework bundle (cycle N > 2) — finding-ID delta", and under `### reviewer` → "Re-review bundle". Apply those rules when invoking `context-minimizer` for the rework dispatch; do not duplicate them here.

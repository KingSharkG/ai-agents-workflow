---
name: orchestrator-dispatch
description: Owns dispatch orchestration — subtask skeleton, pre-dispatch checklist, post-dispatch artifact gate, clarifying-questions hold, rework routing, and token-saving rules. Use before EVERY agent dispatch (except direct-answer and Delivery PM task-level intake) and after every return. Bundle composition itself is delegated to context-minimizer.
stage: shared
---

# Orchestrator Dispatch — Bundle, Skeleton, Gate

Every agent dispatch MUST be preceded by the Pre-Dispatch Checklist and followed by the Artifact Gate. This skill owns all procedures from "orchestrator is about to dispatch an agent" through "orchestrator has accepted the returned artifact."

## Dispatch Bundle Model

All agents (Lead, Executor, Reviewer, Delivery PM, Design Agent, Integration Checker) receive their context via a **dispatch bundle** — a single markdown payload composed in memory by the orchestrator and embedded inline in the Task `prompt` parameter at dispatch time. Bundles are NOT written to disk. Agents do NOT independently read canonical contracts, PROJECT_CONFIG.md sections, or governance files.

Dispatch bundles are valid only in `mode: normal`. In `mode: degraded-inline`, the orchestrator MUST NOT compose synthetic bundles or record synthetic dispatch outcomes for those roles.

**Startup sequence:**
1. Harness reads the stub (`agents/<role>.md`) — spins up with tools, model, permissionMode.
2. Agent receives the inline dispatch bundle as the body of its Task prompt (between `<!-- dispatch-bundle:start ... -->` and `<!-- dispatch-bundle:end -->` markers).
3. Agent performs the work and appends its artifact section to `ai-work.md`.

Bundle contents are assembled by the `context-minimizer` skill — see `${CLAUDE_PLUGIN_ROOT}/skills/shared/context-minimizer/SKILL.md` → "Bundle Format" for the section list (role contract, project context, governance, artifact input) and the inline-delivery rules.

Menu guard rail: the agent's allowed skills for the subtask are `base_skills ∪ domain.skills`; allowed plugins are `base_plugins ∪ domain.plugins`. Both lists are included in the dispatch bundle's Project Context section.

**Audit trail:** The only on-disk record of a bundle is a one-line entry in `<subtask_id>/summary.md` → `<!-- section:dispatch-bundles -->`: `- <role> for <subtask_id> (cycle <n>): <token_count> tokens; sections: <list>; cache_misses: <list-or-none>`. Reviewer reads these lines as part of the rollup.

## Dispatch Bundle Protocol (MANDATORY)

Before every agent dispatch, the orchestrator MUST:

1. Run the `context-minimizer` skill for the target agent role to assemble the bundle content in memory.
2. Verify the assembled governance/context excerpts stay within the ceiling defined in the `context-minimizer` skill's "Token Ceilings per Role" table. If exceeded, re-excerpt until it fits — never silently exceed.
3. Embed the bundle text inline in the Task `prompt` parameter when dispatching the agent (wrapped in the `<!-- dispatch-bundle:start ... -->` / `<!-- dispatch-bundle:end -->` markers). Append the role-specific instruction line after the closing marker.
4. Append a one-line bundle audit to `<subtask_id>/summary.md` → `<!-- section:dispatch-bundles -->` capturing role, target subtask, cycle, token count, sections included, and any cache misses.

Agents work from the inline bundle (plus their own stub for tool/model config). Violation of this protocol is an orchestration defect.

## Subtask Skeleton + Pre-Dispatch Checklist (MANDATORY)

The full procedure — skeleton creation steps, ultra-light variant, the file-existence bash checklist, and the missing-file recovery protocol — lives in `${CLAUDE_PLUGIN_ROOT}/skills/shared/orchestrator-dispatch/references/pre-dispatch-procedure.md`. Read once per session.

These checks are MANDATORY before every agent dispatch (including Lead, Executor, Reviewer, Design Agent, Integration Checker). They do NOT apply to Delivery PM (task-level, not subtask-level).

### Clarifying-Questions Hold (Executor / Integration Checker dispatches only)

After the Lead returns, but BEFORE dispatching Executor (or Integration Checker when it would precede implementation), inspect the subtask's `ai-work.md` for a non-empty `<!-- section:tep-clarifying-questions -->` block:

```bash
awk '/<!-- section:tep-clarifying-questions -->/,/<!-- \/section:tep-clarifying-questions -->/' \
  <artifact-root>/tasks/<task_id>/<subtask_id>/ai-work.md \
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

Reject any dispatch result that violates the footer protocol (`${CLAUDE_PLUGIN_ROOT}/skills/shared/orchestrator-telemetry/references/artifact-footer-protocol.md`). Specifically, reject if the result:

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
| task-done | task-root `<artifact-root>/tasks/<task_id>/summary.md` exists AND `## Task Status` says `workflow_state: complete` with zero open gates and zero pending user actions |

**Escalation-N assignment rule:** Before appending an escalation section, count all existing `<!-- section:escalation-* -->` blocks in the subtask's `ai-work.md` and set N = count + 1. Always recount from the file — never rely on in-memory state.

On rejection for reason (1), do NOT re-dispatch the same agent. Inspect `ai-work.md` to determine what partial work occurred, then route to the relevant Lead for re-validation or surface the gap to the user.

## Post-Dispatch File Verification

After every agent dispatch returns, run:

```bash
ls <artifact-root>/tasks/<task_id>/<subtask_id>/
head -20 <artifact-root>/tasks/<task_id>/<subtask_id>/summary.md
```

Verify:

1. `ai-work.md` exists and was modified (not just the skeleton).
2. `summary.md` contains diagnostic headings (`## Telemetry`, `## Context Manifest`).
3. If `ai-work.md` is missing entirely, this indicates the Pre-Dispatch Checklist was skipped — flag as an orchestration defect and do NOT proceed to the next agent in the chain.

After accepting a subtask completion, read `<subtask_id>/summary.md` (written by Reviewer) and extend `<artifact-root>/tasks/<task_id>/summary.md` with a new row in the **Context Breakdown** table using the manifest totals from `<!-- section:context-manifest -->`, and refresh the **Repeat reads** line. Use the `telemetry-summary` skill for the exact template.

## Token-saving rules

- Dispatch bundles replace direct governance reads — agents receive only pre-curated excerpts within token ceilings, delivered inline in the Task prompt (no extra disk read)
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

For review cycle N > 1, dispatch bundles carry only delta context. The canonical rules — Medium/Low routing (Executor → Reviewer direct), High routing (Executor → Lead → Executor → Reviewer), and the cycle-N>2 finding-ID delta — live in `${CLAUDE_PLUGIN_ROOT}/skills/shared/context-minimizer/SKILL.md` under `### executor` → "Rework bundle (cycle N > 1)" / "Executor rework bundle (cycle N > 2) — finding-ID delta", and under `### reviewer` → "Re-review bundle". Apply those rules when invoking `context-minimizer` for the rework dispatch; do not duplicate them here.

## Reopen detection — `needs-replan` and reversal triggers (schema_version 3+)

The canonical reopen protocol (Reviewer `needs-replan`, P2-elected replan, `reversal-packet`, soft cap at `stage_reopen_count >= 3`, auto-diff for `pending_subtasks_needing_rereview[]`) lives in `${CLAUDE_PLUGIN_ROOT}/skills/shared/orchestrator-state/references/stage-discipline.md`. The orchestrator MUST evaluate it on every dispatch return and every P2 gate close BEFORE proceeding to the next subtask. Skipping the check is an orchestration defect — a `needs-replan` verdict with no stage rewind leaves the orchestrator stuck (planning-stage agents are not legal in `stage=execution`).

---
name: review-report
description: Generate a structured Review Report with severity-tagged findings. Use after code and architecture review.
---

# Review Report Skill

Produce this report after reviewing an Implementation Report (and Integration Check Report if available). Be specific — vague findings do not unblock rework.

## Output Target

> **SECTION NAME IS MANDATORY**: Write review content inside `<!-- section:review -->` / `<!-- /section:review -->`.
> Do NOT use `section:review-report`, `section:review-cycle*`, or any other variant.
> Close ALL sections with `<!-- /section:X -->` — never `<!-- end:X -->`.

**Two outputs in the same turn (both mandatory):**

1. **First action**: The orchestrator creates `<subtask_id>/summary.md` skeleton alongside ai-work.md (with diagnostic section placeholders and earlier agents' telemetry/manifest already appended). Verify it exists before appending to `ai-work.md`.
2. **Append** `### Cycle N` block to `<!-- section:review -->` in the subtask's `ai-work.md`.
3. **Last action**: Finalize `summary.md` with actual status fields, acceptance-signal evidence states, files, your telemetry line, your context manifest subsection, notes, and open gates.

**Ultra-light path:** Append the compact `review-ultra` block inside `<!-- section:review -->` in `ai-work.md`. Still finalize `summary.md`.

## Output Template

### 1. summary.md

Write to `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/summary.md` using the skeleton in `${CLAUDE_PLUGIN_ROOT}/skills/review-report/references/summary-skeleton.md`. The orchestrator pre-creates the skeleton (with empty placeholders for Dispatch Bundles, Telemetry, Context Manifest) alongside `ai-work.md`; each agent appends its telemetry line and context manifest subsection along the way; the Reviewer finalizes Status, Acceptance Signals, Files Changed, Notes, and Open Gates.

### 2. Append inside `<!-- section:review -->`

Append a `### Cycle <N>` block using the template in `${CLAUDE_PLUGIN_ROOT}/skills/review-report/references/review-cycle-template.md`. The template lays out `section:review-metadata`, `section:review-verdict`, `section:review-findings` (with the per-finding record schema), `section:review-resolved`, `section:review-low-confidence`, `section:review-summary`, and `section:review-completion-summary`. After appending the cycle block, write the diagnostics block (telemetry line + `### reviewer` context-manifest subsection + finalized Status / Acceptance Signals / Notes / Open Gates) to `<subtask_id>/summary.md`.

## Output Size Guidelines

These are soft targets to keep ai-work.md manageable — complex subtasks may exceed them:

- **Findings per cycle:** ≤10 items. If more issues exist, group related ones (e.g., "3 instances of missing error handling" as a single finding with multiple locations).
- **Per finding:** ≤5 lines for `description` + `rework_direction` combined. Quote specific code/field names, not entire blocks.
- **Completion summary:** ≤3 sentences.
- **Review summary:** ≤3 sentences.

## Rules
- `verdict` must be `approved` only when zero high/medium **confidence-filtered** findings remain (i.e., in `section:review-findings`). Low-confidence observations in `section:review-low-confidence` do NOT block approval.
- `cycle_count` must be read from the previous `### Cycle N` subsection — do not reset or invent it.
- `rework_direction` must be specific enough that the executor can act without asking follow-up questions.
- Every finding must carry a `root_cause_category` AND a `confidence` integer.

### Stable Finding IDs (Cycle N > 1)

On the first cycle, number findings sequentially: `F-001`, `F-002`, etc. On subsequent cycles:

1. **Read the previous `### Cycle N-1` subsection's `section:review-findings` block** before writing the new cycle. Build a set `prior_ids = {F-001, F-003, ...}` from it.
2. For each issue you would write in Cycle N:
   - If it is the **same finding** (same defect, same location or clearly-equivalent location after code movement) as one in `prior_ids`: **reuse the original ID**, set `status: persisted` (no material progress) or `status: regressed` (Executor's fix introduced a new manifestation of the same root cause).
   - If it is a genuinely **new** issue: assign the next unused ID from the cycle-1 sequence (`F-<max(prior_ids) + 1>`), set `status: new` (or omit the field — `new` is the default).
3. For every prior-cycle ID **not** in the new Cycle N findings, add a bullet to `<!-- section:review-resolved -->` naming the ID and the cycle it first appeared in.
4. Never renumber existing IDs. A finding that originated as `F-003` in Cycle 1 is `F-003` forever, even if Cycle 2 resolves `F-001` and `F-002`.

**Why this matters.** Executor rework bundles in cycles ≥ 3 carry only delta findings (new + persisted + regressed) rather than the full Cycle N-1 findings list — see `context-minimizer` → "Executor rework bundle (cycle N > 2)". Stable IDs make that delta computable without natural-language matching.

**When unsure whether two findings are "the same"**: if the root-cause-category, location, and rework-direction all match and the new description would repeat the prior one, reuse the ID. If any of those three diverge in a material way, assign a new ID.

## Related skills

- `context-minimizer` → "Executor rework bundle (cycle N > 2) — finding-ID delta" — the reader of stable IDs. The delta protocol only works when IDs survive across cycles as specified above.
- `technical-execution-packet` — the TEP's `shared_artifacts` metadata flag drives the reviewer cross-subtask skip clause.
- `blocker-escalation-report` — escalation path when rework cap is reached with unresolved confidence-filtered findings.
- **Confidence rubric** (target calibration — pick the lowest threshold that still fits):
  - `90–100`: reproducible failure or violates a cited rule (quote the rule + diff); the Executor must act.
  - `75–89`: confident the concern is real but the exact rework direction has a small degree of judgment; the Executor must act.
  - `50–74`: plausible issue but evidence is partial (single code path, no failing test, no cited rule). Goes under `section:review-low-confidence` — record for audit, do not request rework.
  - `< 50`: do NOT write it. Low-confidence noise degrades the rework loop.
- If `cycle_count` reaches the complexity-tied cap and confidence-filtered findings remain, use `blocker-escalation-report` instead.
- Do not write findings for issues outside the approved subtask scope.
- When `review_verdict = approved`, `completion_summary` must be filled; write it into both `section:review-completion-summary` and `summary.md`.
- `summary.md` is MANDATORY — write it even for ultra-light subtasks.
- Every acceptance signal in `summary.md` MUST include both:
  - `State`: `pass | fail | deferred | blocked | pending`
  - `Evidence`: `executed | inspected | deferred | blocked | pending`
- Runtime, auth-flow, network, device, simulator, and manual-QA behaviors may be `State: pass` only when `Evidence: executed`.
- If review is clean but an external gate remains open, set `workflow_state` accordingly (`blocked-on-user` or `pending-integration-check`) instead of overstating the subtask as complete.
- Do not leave stale text like "skeleton summary" or "reviewer fills this later" in the finalized `summary.md`.

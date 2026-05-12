# P1 Gate — Approval Menu, Signature Semantics, Loop Cap

Detailed rules for the P1 (Delivery Plan Approval) gate. Read alongside `SKILL.md` → "P1 — Delivery Plan Approval" when presenting the gate or recording its outcome.

## Options depend on classification

- For `plan-only`:
  - `Approve plan and stop` — sets `phase: planned`, `gates.p1_approved: true`, records `gates.p1_approved_at` and `gates.p1_approved_signature` in `orchestration-state.json`, then exits; resumable via `/continue`. Leave `gates.p1_revise_count` untouched (it is a lifetime counter, not a consecutive one).
  - `Approve plan and execute` — overrides classification to `execution-simple` or `execution-full` (ask which if ambiguous), sets `gates.p1_approved: true`, records timestamp + signature, continues to Step 5.
  - `Revise plan` — collect free-form notes via a follow-up `AskUserQuestion`, reset `gates.p1_approved: false` (clear timestamp + signature), increment `gates.p1_revise_count` by 1, route notes back to Delivery PM, re-present.
  - `Abort task` — mark task as aborted.

- For `execution-simple` / `execution-full`:
  - `Approve plan` — set `gates.p1_approved: true`, record `gates.p1_approved_at: <ISO-8601 UTC>` and `gates.p1_approved_signature: <sha256 of normalized Block 1 + Block 2 + Block 3 bytes>`, then proceed to execution. Leave `gates.p1_revise_count` untouched.
  - `Revise plan` — collect notes via a follow-up `AskUserQuestion`, reset `gates.p1_approved: false` (clear timestamp + signature), increment `gates.p1_revise_count` by 1, route notes back to Delivery PM, re-present. Loop until approved.
  - `Abort task` — mark task as aborted.

## Signature semantics

Compute `gates.p1_approved_signature` as the sha256 hex digest of the concatenated bytes the user just saw and approved: Block 1 line + Block 2 markdown table + Block 3 file list, normalized (trim trailing whitespace per line, single `\n` line separators, no trailing blank line). Persist alongside `gates.p1_approved_at`. Before any subtask dispatch, the orchestrator recomputes the signature against the current delivery plan; mismatch means the plan was revised after approval and the gate must be re-presented (reset `gates.p1_approved: false` and loop).

## Loop cap (5 iterations) + soft warning at 3

Mirror the cap in `project-config-review`, but persist the counter in state so it survives `/continue` resumes. The orchestrator reads `gates.p1_revise_count` from `orchestration-state.json` before presenting Block 4 and adjusts the surface accordingly:

- **`>= 3` and `< 5`** — present the standard Approve / Revise / Abort menu, but prepend a soft-warning line to the question text: `"You've revised this plan <N> times. Consider whether the remaining concerns are best addressed via Revise (Delivery PM re-shapes the plan) or via Approve + raise the issues during execution as Blocker Escalations."` Do NOT block; the user can still pick Revise.
- **`>= 5`** — replace the standard menu with a continue-or-abort prompt:
  - `Continue iterating` — re-present the standard Approve / Revise / Abort menu (each subsequent `Revise plan` continues to increment the counter; the prompt repeats every 5 cycles).
  - `Abort task` — mark task as aborted.

`gates.p1_revise_count` is incremented on every `Revise plan` and never reset by `Approve plan` (the cap bounds total churn, not just consecutive cycles). Defaults to `0` for new tasks; legacy v1 tasks upgrade to `0` per `orchestrator-state` → "Migration".

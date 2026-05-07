---
name: orchestrator-intake
description: Classify an incoming task into one of five paths (direct-answer, plan-only, execution-trivial, execution-simple, execution-full) using checklist-based rules, then confirm the chosen path with the user via a mandatory radio-button popup before any pipeline work begins. Use at Step 0 before any artifact creation.
stage: intake
---

# Orchestrator Intake — Task Classification

Classify the incoming task description into exactly one of five paths, then ALWAYS confirm the choice with the user via `AskUserQuestion` before doing anything else. Classification is Step 0 of the default flow and MUST happen before any artifact is created or any agent is dispatched.

## Step 0a — Ambiguity Check (Pre-Classification)

Before applying classification rules, evaluate whether the request is ambiguous enough to warrant clarification. If **any** of these signals fire, ask 1–3 targeted questions via `AskUserQuestion` first, then re-evaluate with the answers folded into the request before classification.

**Ambiguity triggers (any one fires the clarify gate):**

- Request length < 8 words AND contains an imperative verb but no concrete target (e.g., "fix the bug", "improve performance", "refactor that").
- Conflicting signals: question phrasing AND imperative verb in the same message (e.g., "how does X work and update it to Y").
- Risk-area keyword present (`auth`, `migration`, `schema`, etc. — see "Risk-area keyword sets" below) but no scope indicators (no file path, no specific identifier, no LOC hint, no bounded surface).
- Vague modifier verbs without object: `clean up`, `polish`, `make it better`, `improve`, `tidy` with no `<X>` target.
- Multi-intent: 2+ unrelated imperative verbs (e.g., "add X and refactor Y and migrate Z").

**Skip the clarify gate when:**

- Request explicitly names a file/path/identifier and an action.
- Request is a clear question (matches `direct-answer` MUST-pass cleanly, no imperatives).
- Request is a canonical trivial pattern (`rename X→Y`, `bump version`, `fix typo`, `remove unused import`).

**Clarify gate behavior:** ≤3 questions max in a single `AskUserQuestion` call. Typical questions:

- "What's the target file or area?"
- "What outcome do you want?"
- "Should this be planned only or fully implemented?"

After answers, proceed to classification using the enriched description. The ambiguity check runs **once per task** — after clarification, classification proceeds without a second clarify round. The mandatory classification popup (Confirm-and-Override Protocol) still fires after Step 0a regardless of whether the clarify gate ran.

## Classification Paths

| Path | When to use | Behavior |
|------|-------------|----------|
| `direct-answer` | Question, explanation, advice, summary — no code change implied | Answer inline using available tools. Write a minimal `task-data.md` containing only the `<!-- section:intake-classification -->` block (for telemetry); do NOT create `orchestration-state.json` or dispatch any agent. Exit after answering. |
| `plan-only` | User explicitly requests only a plan, proposal, design outline, or implementation approach | Create Task Packet + Delivery Plan. Stop after P1 gate. Set `phase: planned` in `orchestration-state.json`. Do NOT dispatch Executor, Reviewer, or any subtask agent. |
| `execution-trivial` | Tiny, mechanical change with zero design or scope ambiguity | Compressed flow: skip Delivery PM, skip P1 gate, skip Lead. Orchestrator → Executor (with inline TEP) → Reviewer. Single `ai-work.md` and `summary.md`. No `orchestration-history.json`. |
| `execution-simple` | Small, low-risk code change with bounded scope but enough substance for a plan + review cadence | Run the normal workflow. Include a hint in the Delivery PM dispatch bundle to favor `complexity: low` subtasks, lightweight paths, and ultra-light tier where eligible. |
| `execution-full` | Everything else (default) | Run the full 15-step workflow unchanged. |

## Classification Rules + Risk Keywords + Confirm Protocol

The full checklist-driven rule set, the risk-area keyword sets that force `execution-full`, and the mandatory `AskUserQuestion` Confirm-and-Override protocol (payload, recommended-marker rule, user-facing-to-internal mapping, no-text-fallback policy) live in `${CLAUDE_PLUGIN_ROOT}/skills/intake/orchestrator-intake/references/classification-rules.md`. Read once per session — these rules are stable across tasks.

**Quick summary** (full detail in the reference):
1. Apply path checklists in order: `direct-answer` → `plan-only` → `execution-trivial` → `execution-simple` → `execution-full`. First match whose MUST-pass holds and MUST-NOT-pass is empty wins. Default `execution-full`.
2. Risk-area keywords (`auth`, `migration`, `schema`, `endpoint`, `concurrency`, `feature flag`, …) disqualify `trivial`/`simple` and force `full`.
3. ALWAYS fire the four-option `AskUserQuestion` popup (Direct answer / Plan only / Execute lightweight / Execute full) with the heuristic pick marked `(Recommended)`. The popup is the only legal classification surface — no text fallback.

## Hard Constraints

- The `AskUserQuestion` confirm step is non-negotiable for every request. There is no shortcut path that skips it.
- `direct-answer` MAY write a minimal `task-data.md` containing only `<!-- section:intake-classification -->` (with `heuristic_verdict`, `final_path`, `signals`, `timestamp`) when an `<artifact-root>` exists. If no artifact root has been initialized in the consumer repo, skip the persistence step rather than forcing the user to run `/init` for a question — the inline answer still proceeds. `direct-answer` MUST NOT create `orchestration-state.json`, dispatch any agent, or invoke any governance skill beyond `task-packet`'s minimal classification block.
- `plan-only` MUST NOT auto-continue past the P1 gate into execution. To execute after seeing the plan, the user must explicitly choose `Approve plan and execute` at P1 or resume later via `/continue`.
- `execution-trivial` skips Delivery PM, P1 gate, and Lead. The orchestrator auto-records `gates.p1_approved: true` with `gates.p1_approved_signature: "trivial-path-auto"` when it writes initial `orchestration-state.json` so `pre-task-guard` (Phase 3) allows the executor dispatch. The TEP is composed inline in the Task prompt instead of being produced by Lead. The `ai-work.md` skeleton requirement still applies (enforced by `pre-task-guard` Phase 2).
- `execution-simple` MUST go through the P1 gate the same way `execution-full` does. Low complexity affects bundle hints inside subtask dispatch (lightweight TEP, ultra-light tier where eligible) — it never bypasses planning or user approval. The runtime hook `hooks/pre-task-guard.js` (Phase 3) blocks subtask agent dispatch on any non-trivial task whose `orchestration-state.json` does not record `gates.p1_approved: true`.
- `degraded-inline` mode is strictly for dispatch/tooling failures. It MUST NOT be used for `direct-answer`, `plan-only`, or `execution-trivial` classification paths.
- Classification is recorded in `<!-- section:intake-classification -->` of `task-data.md` for ALL paths (including `direct-answer`). The block carries `heuristic_verdict`, `final_path`, `signals[]`, and the ISO-8601 timestamp.

## Output

After classification + confirmation, the orchestrator:

1. Writes the `<!-- section:intake-classification -->` block to `task-data.md` (always, including `direct-answer`).
2. For `direct-answer`: produce the inline answer, then (when `<artifact-root>` exists) write a minimal `<artifact-root>/tasks/<task_id>/summary.md` containing the classification block, the user's question, and a 3–5 line answer recap. No `orchestration-state.json`, no per-subtask folders, no agent dispatch. See `telemetry-summary` skill → "Non-execution path summaries" for the schema.
3. For all other paths: continue to Step 1 of the default flow with `classification = final_path`. Persist `classification` to `orchestration-state.json` once the file is created (Step 6a). For `execution-trivial`, the same write also sets `gates.p1_approved: true` and `gates.p1_approved_signature: "trivial-path-auto"`.

## intake-classification block schema

```markdown
<!-- section:intake-classification -->
### Intake Classification
- **heuristic_verdict**: <direct-answer | plan-only | execution-trivial | execution-simple | execution-full>
- **final_path**: <same enum — equals heuristic_verdict if user confirmed, differs if user overrode>
- **user_action**: <confirmed | overrode>
- **signals**: <comma-separated list of the rule conditions that fired, e.g., "interrogative phrasing; no imperative verb"; or "single file; ≤5 LOC; no risk keywords">
- **risk_keywords_matched**: <comma-separated list, or "none">
- **timestamp**: <ISO-8601 UTC>
<!-- /section:intake-classification -->
```

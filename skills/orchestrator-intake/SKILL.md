---
name: orchestrator-intake
description: Classify an incoming task into one of five paths (direct-answer, plan-only, execution-trivial, execution-simple, execution-full). Use at Step 0 before any artifact creation. Enforces hard constraints per path and drives the ambiguity-resolution question.
---

# Orchestrator Intake — Task Classification

Classify the incoming task description into exactly one of five paths. Classification is Step 0 of the default flow and MUST happen before any artifact is created or any agent is dispatched.

## Classification Paths

| Path | When to use | Behavior |
|------|-------------|----------|
| `direct-answer` | Question, explanation, advice, summary — no code change implied | Answer inline using available tools. Do NOT create `task-data.md`, `orchestration-state.json`, or dispatch any agent. Exit after answering. |
| `plan-only` | User explicitly requests only a plan, proposal, design outline, or implementation approach | Create Task Packet + Delivery Plan. Stop after P1 gate. Set `phase: planned` in `orchestration-state.json`. Do NOT dispatch Executor, Reviewer, or any subtask agent. |
| `execution-trivial` | Tiny, mechanical change with zero design or scope ambiguity: typo fix, single-string update, single-line value bump, single-import add, single-comment edit | Compressed flow: skip Delivery PM, skip P1 gate, skip Lead. Orchestrator → Executor (with inline TEP) → Reviewer. Single `ai-work.md` and `summary.md`. No `orchestration-history.json`. (Dispatch bundles are inline in the Task prompt for every classification — that is no longer trivial-specific.) |
| `execution-simple` | Small, low-risk code change: single-file scope, no schema/API/auth/migration change, but enough substance to warrant a plan and review cadence | Run the normal workflow. Include a hint in the Delivery PM dispatch bundle to favor `complexity: low` subtasks, lightweight paths, and ultra-light tier where eligible. |
| `execution-full` | Everything else (default) | Run the full 15-step workflow unchanged. |

## Heuristics (evaluated in priority order — first match wins)

1. **`direct-answer`**: Interrogative phrasing (contains `?` and reads as a question), OR keywords like "explain", "what is", "how does", "why", "compare", "summarize", "tell me about", "what are the options" — AND no code change is implied or requested. Counter-signal: if the question implies "and then do it", classify as execution instead.

2. **`plan-only`**: User explicitly says "just plan", "plan only", "design only", "outline", "proposal", "don't implement", "don't execute", "draft a plan", "scope this out", "how would we approach this". Must be distinguished from `direct-answer` — if the user wants a delivery plan artifact (not just a chat response), it is `plan-only`.

3. **`execution-trivial`**: Mechanical change with no design judgment required. Strong signals: "fix typo", "fix spelling", "rename X to Y" (single identifier), "bump version to N", "update string", "add a comment", "remove unused import". MUST satisfy ALL of: (a) single-file scope, (b) the change can be specified in one short sentence, (c) zero risk to API contracts / schemas / auth / data, (d) no judgment about *what* to do (only *where* to do it). If any of these fail, classify as `execution-simple` instead.

4. **`execution-simple`**: Single-file change implied, low-complexity signals ("add field", "change color", "add import" with non-trivial logic), AND no schema/API/auth/migration keywords present. Scope is clearly bounded to one module but the change has enough substance that a plan + review cadence adds value.

5. **`execution-full`**: Default for any request that does not match heuristics 1–4 above.

## Ambiguity Rule

If the orchestrator cannot confidently classify the request (e.g., "update the login page" — could be simple or complex), it MUST ask ONE clarifying question via `AskUserQuestion` with these options:

- "Quick answer / explanation only"
- "Just plan it, don't implement"
- "Tiny mechanical change (typo / rename / bump)"
- "Implement it (small change)"
- "Implement it (full workflow)"

## Hard Constraints

- `direct-answer` MUST NOT create `task-data.md`, dispatch any agent, or invoke any governance skill.
- `plan-only` MUST NOT auto-continue past the P1 gate into execution. If the user wants to execute after seeing the plan, they must explicitly choose "Approve plan and execute" at P1, or resume later via `/continue`.
- `execution-trivial` skips Delivery PM, P1 gate, and Lead. The orchestrator auto-records `gates.p1_approved: true` with `gates.p1_approved_signature: "trivial-path-auto"` when it writes initial `orchestration-state.json` so `pre-task-guard` (Phase 3) allows the executor dispatch. The TEP is composed inline in the Task prompt instead of being produced by Lead. The `ai-work.md` skeleton requirement still applies (enforced by `pre-task-guard` Phase 2).
- `execution-simple` MUST go through the P1 gate the same way `execution-full` does. Low complexity affects bundle hints inside subtask dispatch (lightweight TEP, ultra-light tier where eligible) — it never bypasses planning or user approval. The runtime hook `hooks/pre-task-guard.js` (Phase 3) blocks subtask agent dispatch on any non-trivial task whose `orchestration-state.json` does not record `gates.p1_approved: true`.
- `degraded-inline` mode is strictly for dispatch/tooling failures. It MUST NOT be used for `direct-answer`, `plan-only`, or `execution-trivial` classification paths.
- Classification is recorded in `orchestration-state.json` (for paths that create artifacts) and in `<!-- section:intake-classification -->` of `task-data.md`. For `direct-answer`, nothing is persisted.

## Output

After classification, the orchestrator:

1. For `direct-answer`: proceed to answer inline and exit.
2. For all other paths: continue to Step 1 (create `task-data.md` with `<!-- section:intake-classification -->` recording classification path, confidence, signals, timestamp).

Persist the `classification` field to `orchestration-state.json` once the file is created (Step 6a). For `execution-trivial`, the same write also sets `gates.p1_approved: true` and `gates.p1_approved_signature: "trivial-path-auto"`.

---
name: orchestrator-intake
description: Classify an incoming task into one of four paths (direct-answer, plan-only, execution-simple, execution-full). Use at Step 0 before any artifact creation. Enforces hard constraints per path and drives the ambiguity-resolution question.
---

# Orchestrator Intake — Task Classification

Classify the incoming task description into exactly one of four paths. Classification is Step 0 of the default flow and MUST happen before any artifact is created or any agent is dispatched.

## Classification Paths

| Path | When to use | Behavior |
|------|-------------|----------|
| `direct-answer` | Question, explanation, advice, summary — no code change implied | Answer inline using available tools. Do NOT create `task-data.md`, `orchestration-state.json`, or dispatch any agent. Exit after answering. |
| `plan-only` | User explicitly requests only a plan, proposal, design outline, or implementation approach | Create Task Packet + Delivery Plan. Stop after P1 gate. Set `phase: planned` in `orchestration-state.json`. Do NOT dispatch Executor, Reviewer, or any subtask agent. |
| `execution-simple` | Small, low-risk code change: single-file scope, no schema/API/auth/migration change | Run the normal workflow. Include a hint in the Delivery PM dispatch bundle to favor `complexity: low` subtasks, lightweight paths, and ultra-light tier where eligible. |
| `execution-full` | Everything else (default) | Run the full 15-step workflow unchanged. |

## Heuristics (evaluated in priority order — first match wins)

1. **`direct-answer`**: Interrogative phrasing (contains `?` and reads as a question), OR keywords like "explain", "what is", "how does", "why", "compare", "summarize", "tell me about", "what are the options" — AND no code change is implied or requested. Counter-signal: if the question implies "and then do it", classify as execution instead.

2. **`plan-only`**: User explicitly says "just plan", "plan only", "design only", "outline", "proposal", "don't implement", "don't execute", "draft a plan", "scope this out", "how would we approach this". Must be distinguished from `direct-answer` — if the user wants a delivery plan artifact (not just a chat response), it is `plan-only`.

3. **`execution-simple`**: Single-file change implied, low-complexity signals ("rename", "fix typo", "update string", "add field", "change color", "bump version", "add import"), AND no schema/API/auth/migration keywords present. Scope is clearly bounded to one module.

4. **`execution-full`**: Default for any request that does not match the above three paths.

## Ambiguity Rule

If the orchestrator cannot confidently classify the request (e.g., "update the login page" — could be simple or complex), it MUST ask ONE clarifying question via `AskUserQuestion` with these options:

- "Quick answer / explanation only"
- "Just plan it, don't implement"
- "Implement it (small change)"
- "Implement it (full workflow)"

## Hard Constraints

- `direct-answer` MUST NOT create `task-data.md`, dispatch any agent, or invoke any governance skill.
- `plan-only` MUST NOT auto-continue past the P1 gate into execution. If the user wants to execute after seeing the plan, they must explicitly choose "Approve plan and execute" at P1, or resume later via `/continue`.
- `degraded-inline` mode is strictly for dispatch/tooling failures. It MUST NOT be used for `direct-answer` or `plan-only` classification paths.
- Classification is recorded in `orchestration-state.json` (for paths that create artifacts) and in `<!-- section:intake-classification -->` of `task-data.md`. For `direct-answer`, nothing is persisted.

## Output

After classification, the orchestrator:

1. For `direct-answer`: proceed to answer inline and exit.
2. For all other paths: continue to Step 1 (create `task-data.md` with `<!-- section:intake-classification -->` recording classification path, confidence, signals, timestamp).

Persist the `classification` field to `orchestration-state.json` once the file is created (Step 6a).

---
name: orchestrator-intake
description: Classify an incoming task into one of five paths (direct-answer, plan-only, execution-trivial, execution-simple, execution-full) using checklist-based rules, then confirm the chosen path with the user via a mandatory radio-button popup before any pipeline work begins. Use at Step 0 before any artifact creation.
---

# Orchestrator Intake — Task Classification

Classify the incoming task description into exactly one of five paths, then ALWAYS confirm the choice with the user via `AskUserQuestion` before doing anything else. Classification is Step 0 of the default flow and MUST happen before any artifact is created or any agent is dispatched.

## Classification Paths

| Path | When to use | Behavior |
|------|-------------|----------|
| `direct-answer` | Question, explanation, advice, summary — no code change implied | Answer inline using available tools. Write a minimal `task-data.md` containing only the `<!-- section:intake-classification -->` block (for telemetry); do NOT create `orchestration-state.json` or dispatch any agent. Exit after answering. |
| `plan-only` | User explicitly requests only a plan, proposal, design outline, or implementation approach | Create Task Packet + Delivery Plan. Stop after P1 gate. Set `phase: planned` in `orchestration-state.json`. Do NOT dispatch Executor, Reviewer, or any subtask agent. |
| `execution-trivial` | Tiny, mechanical change with zero design or scope ambiguity | Compressed flow: skip Delivery PM, skip P1 gate, skip Lead. Orchestrator → Executor (with inline TEP) → Reviewer. Single `ai-work.md` and `summary.md`. No `orchestration-history.json`. |
| `execution-simple` | Small, low-risk code change with bounded scope but enough substance for a plan + review cadence | Run the normal workflow. Include a hint in the Delivery PM dispatch bundle to favor `complexity: low` subtasks, lightweight paths, and ultra-light tier where eligible. |
| `execution-full` | Everything else (default) | Run the full 15-step workflow unchanged. |

## Classification Rules (checklist-driven)

Evaluate paths in priority order. The first path whose **MUST-pass** list fully holds AND whose **MUST-NOT-pass** list has no match is the heuristic verdict. If no path matches before `execution-full`, default to `execution-full`.

### 1. `direct-answer`

**MUST-pass (ALL):**
- Request reads as a question, summary, or explanation request. Detected by interrogative punctuation (`?`) OR opening with one of: `explain`, `what`, `why`, `how does`, `how do`, `compare`, `summarize`, `tell me`, `should we`, `what's the difference`, `what are the options`, `describe`.
- No imperative verb targeting code present. The disqualifying verb set: `add`, `fix`, `rename`, `remove`, `delete`, `implement`, `build`, `make it`, `update <X> to <Y>`, `change`, `refactor`, `migrate`, `wire up`, `create`, `write`, `convert`, `replace`.
- No file path, function name, or identifier presented as a write target (e.g., `src/foo.ts:42` or `function `bar`` is fine to *reference* in the question; presenting it as something to modify disqualifies).

**MUST-NOT (any one disqualifies):**
- Trailing imperative ("…and do it", "…then implement", "…and fix it").
- Follow-up imperative anywhere in the same message after the question.

### 2. `plan-only`

**MUST-pass (ANY one is sufficient):**
- One of these explicit phrases appears: `just plan`, `plan only`, `plan it`, `design only`, `outline`, `draft a plan`, `scope this out`, `don't implement`, `don't execute`, `proposal`, `approach for`, `how would we approach`, `what's the plan`.
- Question-form that explicitly requests a deliverable artifact (e.g., "give me a plan for X", "produce a design doc for X").

**MUST-NOT:**
- An execution imperative without one of the above plan markers.

### 3. `execution-trivial`

**MUST-pass (ALL):**
- Single file touched (declared explicitly in request OR inferable to exactly one path).
- Estimated diff size ≤ 5 lines AND ≤ 1 logical change.
- Change describable in one short sentence with no judgment about *what* to change (only *where*). Canonical examples: `rename X→Y` (single non-exported identifier), `bump version 1.2.3→1.2.4`, `fix typo recieve→receive`, `add missing import of Z`, `add a single comment`, `remove unused import`.
- Risk-area keyword set is empty (see "Risk-area keyword sets" below).
- No new public/exported symbol added; no public/exported symbol removed; no signature change.

**MUST-NOT (any one disqualifies):**
- Touches more than one file.
- Renames an exported identifier (multi-file blast radius).
- Touches a config that drives runtime behavior (env var, feature flag, IaC, CI workflow).
- Modifies a test in a way that changes the behavior under test (vs. fixing a typo in a test name).

### 4. `execution-simple`

**MUST-pass (ALL):**
- Bounded surface: estimated ≤ 2 files AND ≤ 50 changed LOC.
- Risk-area keyword set is empty.
- No new endpoint, no new DB column/table, no new external dependency.
- No cross-cutting concern change (no auth pattern, no logging-format change, no error-handling pattern change).
- Scope is clearly stated; no vague modifiers ("improve", "clean up", "make better").

**MUST-NOT (any one disqualifies):**
- Any condition that would have made it `execution-trivial` if it also satisfied trivial's MUST-pass list (i.e., if it's actually trivial, don't classify as simple — stay on trivial).
- Any risk-area keyword present.
- More than 2 files OR more than ~50 LOC estimated.

### 5. `execution-full`

**Trigger (ANY one is sufficient):**
- Risk-area keyword present in request.
- Estimated > 2 files OR > 50 LOC.
- New module, component, route, page, or migration explicitly mentioned.
- Words `refactor`, `redesign`, `migrate`, `rewrite`, `overhaul` in the request.
- Vague scope ("improve X", "clean up Y", "make it better", "polish Z") with no bounded surface.
- Failed all of paths 1–4.

## Risk-area keyword sets

A match against ANY of these keywords (case-insensitive, word-boundary match) disqualifies `execution-trivial` and `execution-simple` and forces `execution-full` (subject to user override at the confirm step).

- **Schema/data**: `migration`, `migrate`, `schema`, `column`, `table`, `index`, `drop`, `alter`, `seed`, `backfill`, `foreign key`, `constraint`.
- **API/contract**: `endpoint`, `route` (when used as a noun for HTTP routes), `request body`, `response shape`, `contract`, `payload`, `versioning`, `deprecate`, `breaking change`.
- **Auth/security**: `auth`, `authentication`, `authorization`, `role`, `permission`, `token`, `session`, `OAuth`, `JWT`, `RBAC`, `secret`, `credential`, `password`, `encryption`.
- **Reliability/perf**: `concurrency`, `race condition`, `lock`, `transaction`, `idempotency`, `retry`, `cache invalidation`, `rate limit`, `backpressure`.
- **Cross-cutting**: `logger` (when changing the pattern, not a single log line), `observability`, `tracing`, `metrics`, `error handling` (pattern-level), `feature flag` (when introducing).

## Confirm-and-Override Protocol (mandatory)

After heuristics produce a verdict, the orchestrator MUST call `AskUserQuestion` exactly once before doing anything else — including before the `direct-answer` reply. The UI renders this as a radio-button popup. The user's choice — confirm or override — is the `final_path`; the heuristic's pick is preserved as `heuristic_verdict`.

**AskUserQuestion payload:**

```yaml
question: "How should I handle this request?"
header: "Classification"
multiSelect: false
options:
  - label: "Direct answer"            # heuristic 'direct-answer' → append " (Recommended)"
    description: "Answer inline. No artifacts, no pipeline."
  - label: "Plan only"                # heuristic 'plan-only' → append " (Recommended)"
    description: "Produce a delivery plan, stop at P1. Resumable via /continue."
  - label: "Execute (lightweight)"    # heuristic 'execution-trivial' OR 'execution-simple' → append " (Recommended)"
    description: "Run the pipeline with a compressed or lightweight path."
  - label: "Execute (full pipeline)"  # heuristic 'execution-full' → append " (Recommended)"
    description: "Run the full 15-step orchestration."
```

Append ` (Recommended)` to exactly one option's `label` — the one matching the heuristic verdict — so the UI surfaces it as the default-selected radio. The four options are always presented; the recommended marker is the only thing that changes.

**User-facing → internal path mapping:**

| User picks | Internal `final_path` |
|------------|-----------------------|
| Direct answer | `direct-answer` |
| Plan only | `plan-only` |
| Execute (lightweight) | If heuristic verdict was `execution-trivial`, keep `execution-trivial`. Otherwise `execution-simple`. |
| Execute (full pipeline) | `execution-full` |

The `execution-trivial` / `execution-simple` distinction is an internal optimization (skip Delivery PM/P1/Lead vs. lightweight TEP). The user does not pick between them directly — the heuristic chooses, and an "Execute (lightweight)" pick honors the heuristic's sub-choice.

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
2. For `direct-answer`: produce the inline answer and exit. No further artifacts, no `orchestration-state.json`.
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

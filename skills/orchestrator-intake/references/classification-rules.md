# Classification Rules — Reference

Loaded by `orchestrator-intake/SKILL.md`. Read on first classification per session.

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
- Batch/repetitive mechanical operation: the request implies 2+ instances of the same transformation at non-contiguous sites (rename, replace, update, fix). Two or more separate Edit calls exceed "≤1 logical change" and are incompatible with trivial capacity. Reclassify as `execution-simple`.
- Request contains quantifiers implying multiplicity: "all", "every", "each", explicit counts (e.g. "16 methods", "5 occurrences"), "throughout the file", "everywhere it appears". These signal multi-site edits incompatible with the "≤ 5 lines AND ≤ 1 logical change" MUST-pass.

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

**No text-fallback.** If `AskUserQuestion` is unavailable in your tool allowlist, do **not** print the four options as chat text and proceed. Instead, halt with a structured error: emit a one-line message identifying that `AskUserQuestion` is missing from the orchestrator's tool allowlist and exit. Inlining the popup as text and continuing has produced silent skip-dispatch regressions where the user replies, the agent treats the conversation as already in answer mode, and the entire pipeline is bypassed. The popup is the only legal classification surface.

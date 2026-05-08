# Artifact Footer Protocol

Every dispatched agent that appends content to `ai-work.md` MUST also write a diagnostics footer to the sibling `<subtask_id>/summary.md` in the same turn. This file is the single canonical statement of that requirement; all writer-skills (`implementation-report`, `review-report`, `technical-execution-packet`, `plan-addendum`, `blocker-escalation-report`, etc.) link here instead of re-stating it.

## What goes in the footer

The footer has exactly two parts. Both are required; missing either is grounds for the orchestrator to mark the dispatch a no-op (see `orchestrator-dispatch` SKILL → "Post-dispatch artifact gate").

1. **Telemetry line** — appended under `## Telemetry` in `<subtask_id>/summary.md`. One line per dispatch. Format and field semantics live in the parent `orchestrator-telemetry` SKILL.md.

2. **Context manifest subsection** — appended under `## Context Manifest` in `<subtask_id>/summary.md` as `### <role>` where `<role>` matches the dispatched agent role (`executor`, `reviewer`, `lead`, `design-agent`, `delivery-pm`, `integration-checker`, or — for blocker escalations — the role of the blocked agent). Bucket taxonomy and required fields live in the parent `orchestrator-telemetry` SKILL.md.

Each agent's `### <role>` subsection is per-dispatch; later cycles append a new subsection rather than overwriting. The Reviewer's finalization step in `review-report` separately fills the rest of `summary.md` (Status, Acceptance Signals, Files Changed, Notes, Open Gates) — those are NOT part of this footer protocol.

## When to write it

After the agent's primary artifact write to `ai-work.md` succeeds, in the same turn, before returning. Skills MUST sequence the writes so the footer cannot be lost on early return:

1. Append the agent's content to its `<!-- section:* -->` placeholder in `ai-work.md`.
2. Append the telemetry line to `summary.md` → `## Telemetry`.
3. Append the `### <role>` context manifest subsection to `summary.md` → `## Context Manifest`.

## When the footer is NOT required

- Direct-answer and trivial-flow paths that never create a `<subtask_id>/` skeleton (no `summary.md` exists).
- Pure orchestrator-internal writes (e.g., the `<!-- section:dispatch-bundles -->` audit line is recorded by the orchestrator itself, not the dispatched agent).

## Audit references

- `skills/shared/orchestrator-telemetry/SKILL.md` — telemetry line format, context manifest bucket taxonomy.
- `skills/shared/orchestrator-dispatch/SKILL.md` — post-dispatch artifact gate that enforces this protocol.
- `skills/execution/review-report/references/summary-skeleton.md` — `summary.md` skeleton showing where each footer piece lands.

# Per-Role Bundle Assembly Rules

Lookup table for the per-role contents of a dispatch bundle. Read the role block matching the target agent of the current dispatch.

The two upstream rules from `SKILL.md` → `## Context Bundle by Role` apply to every block below and are not repeated per-role:

1. **Role Contract.** Read `${CLAUDE_PLUGIN_ROOT}/agents/<role>.md` and copy the `<!-- role-contract:<role> -->` marker block verbatim into the bundle's `## Role Contract` section. The block lives in a dedicated `## Role Contract` section near the end of each stub; surrounding prose is human commentary only. (Roles `chief-orchestrator`, `init`, and `resume-orchestrator` do not have a role-contract block — they aren't dispatched via this skill.)
2. **Cache resolution.** Every `<!-- section:<tag> -->` listed below resolves via the Project-Level Context Cache: grep the tag's anchor block out of `<artifact-root>/config/domain-contexts.cache.md` when the tag is in `domain-contexts.cache.manifest.json`, otherwise extract live from `PROJECT_CONFIG.md`.

---

### delivery-pm

**Project Context from** `PROJECT_CONFIG.md`:
- `<!-- section:domains -->` — declared_domains, detection_rules, decomposition_rule, escalation_rule
- `<!-- section:cross-domain-rules -->` — ordering rules

**Governance:**
- `${CLAUDE_PLUGIN_ROOT}/ai/governance/TRIGGER_RULES.md` — full (short, always relevant for routing recommendations)

**Artifact Input:**
- `section:task-packet` from `task-data.md` (full)

**Exclude:** PROJECT_CONFIG.md baseline sections, REVIEW_CHECKLIST, all other agent contracts

---

### lead (TEP creation + validation)

**Project Context from** `PROJECT_CONFIG.md`:
- `<!-- section:<domain> -->` block (skills, plugins, baseline anchors, validation_rules, forbidden_actions)
- Referenced baseline anchors (`<!-- section:<domain>-baseline -->` plus `<!-- section:auth-baseline -->` / `<!-- section:api-baseline -->` when the subtask touches auth or a REST contract)
- `<!-- section:project-best-practices -->`
- `lead:` sub-block of `<!-- section:agent-best-practices -->`

**Governance:**
- None required in bundle (Lead does not need TRIGGER_RULES or REVIEW_CHECKLIST)

**Artifact Input:**
- `section:spec` from `ai-work.md` (already extracted by orchestrator from `task-data.md`). Never send the full task-data.md.
- When a design addendum exists (only for domains in `design_hook_domains`), include only body sections from `section:plan-addendum`:
  `design-findings`, `design-constraints`, `design-open-questions`, `domain-invariants`, `domain-role-checks`, `domain-status-checks`, `domain-clarifications`.

**Exclude:** addendum metadata/footer, REVIEW_CHECKLIST, other Delivery Plan subtasks, `delivery-routing`, `delivery-context-manifest`, `delivery-telemetry`, other agents' contracts

---

### executor

**Project Context from** `PROJECT_CONFIG.md`:
- `<!-- section:<domain> -->` block (for baseline anchors, validation_rules, forbidden_actions)
- Referenced baseline anchors — **skip if the TEP's `<!-- section:tep-context-bundle -->` already contains the same baseline content** (Lead embeds baselines in the TEP context_bundle for medium/hard subtasks; re-including them wastes ~300-500 tokens)
- `<!-- section:project-best-practices -->`
- `executor:` sub-block of `<!-- section:agent-best-practices -->`

**Governance:**
- `${CLAUDE_PLUGIN_ROOT}/ai/core/PROJECT_CONSTITUTION.md` — Definition of Done section only

**Artifact Input:**
- `section:tep` from `ai-work.md` (current subtask only)
- On focused rework cycles: only `<!-- section:review-findings -->` from the last `### Cycle N` in `section:review`, not the full section.

**Exclude:** TRIGGER_RULES, other subtask TEPs

**Lightweight path (`complexity: low`, no TEP):**
- Include `section:spec` from `ai-work.md` instead of TEP.
- Do not include `delivery-routing`, `delivery-context-manifest`, or `delivery-telemetry`.

**Rework bundle (cycle N > 1):**
- Include only: current diff or changed files, latest `review-findings` from last `### Cycle N`, latest `impl-summary` and `impl-tests-run`, relevant acceptance slice from `spec`.
- For High findings routed through Lead: include only the impacted TEP slice and latest finding payload, not the full prior package.
- Do NOT include: full implementation section, full review history, full baseline, full checklist.

**Executor rework bundle (cycle N > 2) — finding-ID delta:**

Starting with the third cycle the finding set has typically churned: some Cycle N-1 findings were resolved, some persist, a few may be new or regressed. Sending the full Cycle N-1 `review-findings` wastes tokens on findings the Executor has already addressed. Use the stable `F-<id>` fields (see `review-report` → "Stable Finding IDs") to send only the delta:

1. Parse `section:review-findings` from Cycle N-1.
2. Keep only findings whose `status` is `new`, `persisted`, or `regressed`. Drop any finding absent from Cycle N-1 altogether (it was resolved and appears in `section:review-resolved` — Executor does not need it).
3. For `persisted` findings, **prepend a one-line context note**: `This finding persisted from Cycle <M>. Prior rework attempt did not resolve it.` This signals to the Executor that a different approach is warranted.
4. For `regressed` findings, note `This finding regressed — same root cause re-emerged after Cycle <M> fix.`

Cycle 2 executor rework still receives the full Cycle 1 findings (no prior IDs to diff against). The delta kicks in only from Cycle 3 onward.

For Lead re-validation on High findings: same rule — send only the delta findings plus the impacted TEP slice.

---

### design-agent (FE subtasks only)

**Project Context from** `PROJECT_CONFIG.md`:
- FE section only (`<!-- section:fe-baseline -->`)

**Governance:**
- None required in bundle

**Artifact Input:**
- `section:spec` from `ai-work.md` for the active FE subtask
- Relevant FE context excerpt from the touched area (screen contract, navigation rule, type surface, or repo map) when the subtask depends on existing app behavior
- `section:tep` from `ai-work.md` only when revising an already-shaped FE subtask after blocker or rework feedback

**Exclude:** BE baseline, REVIEW_CHECKLIST, other agents' contracts

---

### integration-checker

**Project Context from** `PROJECT_CONFIG.md`:
- `<!-- section:api-baseline -->` and `<!-- section:auth-baseline -->` only

**Governance:**
- None required in bundle

**Artifact Input:**
- Changed-side `section:implementation` extracts from `ai-work.md` — prefer `impl-files-changed`, `impl-tests-run`, `impl-unresolved-issues`; include full section only when sub-sections are unavailable.
- Latest approved artifact or current live contract surface from the untouched side when only one side changed
- Relevant changed FE/BE contract excerpts from source or diff when possible

**Exclude:** TRIGGER_RULES

---

### reviewer

**Project Context from** `PROJECT_CONFIG.md`:
- Relevant layer section only (domain validation_rules)

**Governance:**
- `${CLAUDE_PLUGIN_ROOT}/ai/governance/REVIEW_CHECKLIST.md` — always: `<!-- section:core-review -->`, `<!-- section:severity -->`, `<!-- section:rework-policy -->`; add `<!-- section:domain-review -->` for domain subtasks; add `<!-- section:integration-review -->` when paired cross-domain subtask changed both sides or Integration Check Report included
- `${CLAUDE_PLUGIN_ROOT}/ai/core/PROJECT_CONSTITUTION.md` — `<!-- section:definition-of-done -->` section only

**Artifact Input:**
- `section:implementation` from `ai-work.md` (current cycle)
- Changed files or diff for the current cycle
- `section:spec` from `ai-work.md` for the active subtask
- Integration Check Report (if available for this cycle)

**Exclude:** TRIGGER_RULES, all other agent contracts

**Re-review bundle (rework cycle N > 1):**
- Include only: updated `<!-- section:implementation -->` (current cycle), changed files or diff (current cycle), `<!-- section:spec -->` acceptance signals.
- Do NOT include: full prior review cycles, full TEP, full baseline.
- **Governance reduction:** Each reviewer dispatch is a new agent instance with no memory of prior cycles. However, if the re-review is for Medium/Low findings only (no scope change), include a condensed governance reminder instead of full sections: include only `<!-- section:severity -->` and `<!-- section:rework-policy -->` (skip `core-review`, `domain-review`, `integration-review`). Add a one-liner: `Review protocol: same as Cycle 1 — focus on whether findings from Cycle N-1 are resolved.` This saves ~800-1,200 tokens per rework cycle. For High findings or scope changes, include full governance as in Cycle 1.

**Ultra-light subtask bundle adjustment:**

When the subtask is ultra-light (`complexity: low` AND `<!-- section:impl-files-changed -->` lists exactly one non-manifest file AND TEP has no `shared_artifacts` flag), the reviewer's Cross-Subtask Consistency Check is skip-eligible per `agents/reviewer.md` → role contract → "Cross-subtask consistency check". In this case:

- Omit the "Cross-Subtask Consistency Check" instructions block from the bundle — don't include the protocol text for a check the reviewer is going to skip.
- Include instead a one-line note in the bundle's `## Governance` section: `Cross-subtask consistency check: skip-eligible — see reviewer.md skip clause. Record the skip rationale in review-summary.`
- The reviewer still evaluates skip eligibility at review time (the reviewer sees the actual `impl-files-changed` in the artifact input and confirms the file count / manifest-absence before skipping). The bundle adjustment just avoids shipping ~200–400 tokens of protocol text the reviewer won't follow.

For non-ultra-light subtasks, include the full Cross-Subtask Consistency Check block as usual.

---

### orchestrator (post-approval summary)

No dispatch bundle needed — the orchestrator reads artifacts directly. For post-approval:

**Include:**
- `section:review` sections `review-verdict` and `review-completion-summary` from `ai-work.md` (approved cycle only)
- `<subtask_id>/summary.md` (written by Reviewer)
- `${CLAUDE_PLUGIN_ROOT}/ai/core/PROJECT_CONSTITUTION.md` — Definition of Done section only

**Exclude:** PROJECT_CONFIG.md baseline sections, TRIGGER_RULES

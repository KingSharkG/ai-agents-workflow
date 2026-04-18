# ORCHESTRATION — Dispatch Bundle Model & Token-saving

<!-- section:dispatch-bundles -->

## Dispatch Bundle Model

All agents (Lead, Executor, Reviewer, Delivery PM, Design Agent, Integration Checker) receive their context via a **dispatch bundle** — a single markdown file written by the orchestrator before each dispatch. Agents do NOT independently read canonical contracts, PROJECT_CONFIG.md sections, or governance files.

Dispatch bundles are valid only in `mode: normal`. In `mode: degraded-inline`, the orchestrator MUST NOT create `roles/<role>.md` files or record synthetic dispatch outcomes for those roles.

**Bundle path convention:**
- Subtask agents: `ai-workflow-data/tasks/<task_id>/[phase-X/]<subtask_id>/roles/<role>.md`
- Delivery PM: `ai-workflow-data/tasks/<task_id>/roles/delivery-pm.md`

**Startup sequence (replaces the former six-step load order):**
1. Harness reads the stub (`.claude/agents/<role>.md`) — spins up with tools, model, permissionMode.
2. Agent reads the dispatch bundle at the path provided in the orchestrator's prompt.
3. Agent performs the work and appends its artifact section.

**Bundle contents (assembled by orchestrator via `context-minimizer` skill):**
- Role contract excerpts (mission, skill rituals, forbidden actions) — from `${CLAUDE_PLUGIN_ROOT}/ai/agents/<role>.md`
- Pre-extracted PROJECT_CONFIG.md sections (domain, baselines, role best-practices) — from `ai-workflow-data/config/PROJECT_CONFIG.md`
- Governance excerpts within token ceilings — from governance files
- Artifact input (the specific ai-work.md sections this role needs)

Menu guard rail: the agent's allowed skills for the subtask are `base_skills ∪ domain.skills`; allowed plugins are `base_plugins ∪ domain.plugins`. Both lists are included in the dispatch bundle's Project Context section.

**Retention:** Bundles persist after agent completion. Their key data (role, token ceiling used, sections included) is summarized into `<subtask_id>/summary.md` by the orchestrator. Bundle files may then be deleted.

Adding a new domain to a project = one new `<!-- section:<domain> -->` block (plus a matching `<!-- section:<domain>-baseline -->`) in `ai-workflow-data/config/PROJECT_CONFIG.md` plus an entry in `declared_domains`. Zero changes to canonical contracts or harness stubs.

The `init` agent (canonical contract: `${CLAUDE_PLUGIN_ROOT}/ai/agents/init.md`; stub: `${CLAUDE_PLUGIN_ROOT}/agents/init.md`) generates `ai-workflow-data/config/PROJECT_CONFIG.md` by analyzing the consumer project, mapping evidence to the plugin's catalog, asking scoped multiple-choice questions, and running a review-and-comment gate before writing. It owns only `ai-workflow-data/config/PROJECT_CONFIG.md` and ensures `ai-workflow-data/tasks/.gitkeep` exists — never role contracts, stubs, constitution, or this playbook. Modes: `init` | `update` | `add` | `remove`.

<!-- /section:dispatch-bundles -->

<!-- section:token-saving -->

## Token-saving

### General rules

- Dispatch bundles replace direct governance reads — agents receive only pre-curated excerpts within token ceilings
- Only send the relevant section from `ai-work.md`, not the full file
- Only send target files/modules, not the whole repo
- For `task-data.md`, send only the matching `delivery-subtask-*` section by default
- For orchestrator closure, read `<subtask_id>/summary.md` directly
- For Lead intake on subtasks with a design addendum, send only the `design-*` body sections from `<!-- section:plan-addendum -->`
- For Integration Checker, prefer `impl-files-changed`, `impl-tests-run`, and direct contract excerpts from `<!-- section:implementation -->`
- `delivery-routing`, `delivery-context-manifest`, and `delivery-telemetry` are orchestrator-facing sections and should not be included in dispatch bundles
- Follow the single-fact-per-artifact rule — reference earlier sections by name instead of repeating content
- Orchestrator MUST use `subtask_offsets` from `orchestration-state.json` for targeted reads of `task-data.md` — never load the full file after the planning phase

### Delta-review protocol (rework cycles)

For review cycle N > 1, the dispatch bundle for the target agent includes only delta context:

**Medium/Low findings — Executor goes directly back to Reviewer:**

The executor's rework dispatch bundle includes:
- Current diff or changed files
- Latest `review-findings` from last `### Cycle N` in `<!-- section:review -->`
- Latest `impl-summary` and `impl-tests-run`
- Relevant acceptance slice from `<!-- section:spec -->`
- Do NOT resend: full implementation section, full review history, full baseline, full checklist

The reviewer's re-review dispatch bundle includes:
- Updated `<!-- section:implementation -->` (current cycle only)
- Changed files or diff (current cycle only)
- `<!-- section:spec -->` acceptance signals
- Do NOT resend: full prior review cycles, full TEP, full baseline

**High findings touching TEP-defined logic — Executor routes through Lead:**

The lead's re-validation dispatch bundle includes:
- Impacted TEP slice only (not full TEP)
- Latest finding payload from `review-findings`
- Do NOT resend: full prior review package, full implementation section

The executor's rework bundle (after Lead re-validates) includes:
- Updated TEP slice (if Lead revised it)
- Latest `review-findings`
- Do NOT resend: full TEP, full review history

**Severity routing (unchanged):**
- `High` findings touching TEP-defined logic route: Executor → Lead → Executor → Reviewer
- `Medium` and `Low` findings route: Executor → Reviewer (direct)

<!-- /section:token-saving -->

#!/usr/bin/env node
/**
 * PreToolUse hook: pre-task-guard (consolidated)
 *
 * Single Task-matcher PreToolUse entry point. Replaces the previous trio of
 * scripts (guard-subtask-skeleton.js + guard-pre-dispatch-p1.js +
 * evaluate-triggers.js) that each spawned a Node process and re-parsed the
 * same tool input + state file.
 *
 * Pipeline (first failure short-circuits with exit 1):
 *   Phase 0 — plan-mode check (blocking, chief only) — was check-plan-mode.js
 *   Phase 1 — parse tool input + locate active task (one-shot)
 *   Phase 2 — skeleton check  (blocking) — was guard-subtask-skeleton.js
 *   Phase 3 — P1 gate check   (blocking) — was guard-pre-dispatch-p1.js
 *   Phase 4 — trigger eval    (non-blocking, stdout) — was evaluate-triggers.js
 *
 * Behavior is byte-equivalent to running the three scripts back-to-back:
 *   - same blocks, same diagnostic strings
 *   - same stdout assessment for trigger evaluation
 *   - same exemption list (chief-orchestrator → exempt from all)
 *
 * Env vars read:
 *   CLAUDE_TOOL_INPUT_SUBAGENT_TYPE — agent role being dispatched
 *   CLAUDE_TOOL_INPUT_PROMPT        — agent prompt (parsed for task_id + subtask_id)
 *   CLAUDE_PLUGIN_ROOT              — plugin installation root (via lib/plugin-root)
 *
 * argv (for compatibility with legacy evaluate-triggers entry):
 *   argv[2] — optional target agent override; falls back to subagentType env
 *   argv[3] — optional ARTIFACT_PATH override; falls back to ARTIFACT_PATH env
 *
 * Exit semantics:
 *   0 — allow
 *   1 — block (stderr carries the actionable message)
 */

const fs = require('fs');
const path = require('path');
const { resolvePluginRoot, getPluginVersion } = require('./lib/plugin-root');
const { resolveArtifactRoot } = require('./lib/artifact-root');
const {
  bareRole,
  parseTaskIdFromPrompt,
  taskPrefixFor,
  mostRecentTaskDir,
} = require('./lib/active-task');
const { isPlanModeActiveForTranscript } = require('./lib/plan-mode-check');
const { PLAN_MODE_MESSAGE } = require('./lib/plan-mode-message');

const PLUGIN_ROOT = resolvePluginRoot();
const CWD = process.cwd();

// Resolve the consumer-repo artifact root once. When the resolver fails (no
// artifact folder, or legacy ./ai-workflow-data/ still present) we surface the
// diagnostic only on dispatch attempts that actually need a task directory.
const ARTIFACT = resolveArtifactRoot();
const ARTIFACT_ROOT = ARTIFACT.root; // absolute path or null
const TASKS_ROOT = ARTIFACT_ROOT ? path.join(ARTIFACT_ROOT, 'tasks') : null;

// ---------- Phase 1: parse tool input + locate active task (one-shot) ----------

const rawSubagentType = process.env.CLAUDE_TOOL_INPUT_SUBAGENT_TYPE || '';
const subagentType = bareRole(rawSubagentType);
const prompt = process.env.CLAUDE_TOOL_INPUT_PROMPT || '';

// ---------- Phase 0: plan-mode check (blocking, chief-orchestrator only) ----------
//
// Block dispatch of chief-orchestrator while Claude Code's native plan mode is
// active. The orchestrator performs file writes (task-data.md,
// orchestration-state.json, ai-work.md skeletons) which violate plan mode's
// read-only contract. Folded in from the standalone hooks/check-plan-mode.js.
//
// Kill switch: AIAW_DISABLE_PLAN_MODE_GUARD=1 bypasses this check (intended
// only for emergency override if detection misbehaves).
if (
  subagentType === 'chief-orchestrator' &&
  process.env.AIAW_DISABLE_PLAN_MODE_GUARD !== '1'
) {
  // Read stdin payload (best-effort, non-blocking) to recover transcript_path.
  let payload = {};
  try {
    const stat = fs.fstatSync(0);
    if (!(stat && stat.isCharacterDevice() && process.stdin.isTTY)) {
      const raw = fs.readFileSync(0, 'utf8');
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch (_) {
          payload = {};
        }
      }
    }
  } catch (_) {}
  const transcriptPath =
    (payload && payload.transcript_path) ||
    process.env.CLAUDE_TRANSCRIPT_PATH ||
    '';
  if (transcriptPath && isPlanModeActiveForTranscript(transcriptPath)) {
    console.error(`[pre-task-guard] BLOCKED: ${PLAN_MODE_MESSAGE}\n`);
    process.exit(1);
  }
}

// chief-orchestrator dispatches itself only at task entry; no skeleton/state
// invariants apply to it. Exit fast.
if (!subagentType || subagentType === 'chief-orchestrator') {
  process.exit(0);
}

// Legacy folder block: if ./ai-workflow-data/ exists and no current-format
// folder is present, refuse to dispatch ANY non-orchestrator/non-init agent.
// guard-orchestrator-source-writes blocks the orchestrator's writes once
// legacy is detected, but without this gate a subagent dispatch could still
// slip through when the prompt has no parseable task ID.
//
// Reachability: chief-orchestrator already exited above (line ~106), so the
// `subagentType !== 'init'` allowance only matters for the side-flow `init`
// agent dispatched from /ai-agents-workflow:init. No task-pipeline subagent
// reaches this branch; init is the agent that scaffolds the missing folder.
if (ARTIFACT.legacyDetected && !ARTIFACT.root && subagentType !== 'init') {
  console.error(`[pre-task-guard] BLOCKED: ${ARTIFACT.error}\n`);
  process.exit(1);
}

// Missing artifact root (no legacy folder either): block any subtask-agent
// dispatch. Without an artifact root the orchestrator cannot write canonical
// task-data.md / orchestration-state.json / summary.md trees, so subagents
// would either fail their own skeleton checks or improvise paths under
// `.claude/`. Refuse explicitly and direct the user to /init.
//
// `delivery-pm` is included in this block (unlike the P1 phase, where it is
// allowed) because delivery-pm needs a task directory to write its plan into.
// `init` is exempt — it is the agent that scaffolds the missing folder.
if (!ARTIFACT.root && subagentType !== 'init') {
  console.error(
    `[pre-task-guard] BLOCKED: cannot dispatch ${subagentType} without an artifact folder.\n` +
      `${ARTIFACT.error}\n` +
      `The chief-orchestrator must NOT improvise paths under .claude/ or anywhere else; ` +
      `run /ai-agents-workflow:init first to scaffold the canonical layout, ` +
      `then re-run /ai-agents-workflow:task.\n`,
  );
  process.exit(1);
}

const parsedId = parseTaskIdFromPrompt(prompt);

// Pre-resolve subtask ID from prompt: try compound (taskId + suffix) first,
// then legacy standalone format.
function parseSubtaskId(taskId, p) {
  if (!taskId) return null;
  const compoundRegex = new RegExp(
    taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-([A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)',
    'g',
  );
  let last = null;
  let m;
  while ((m = compoundRegex.exec(p)) !== null) {
    last = m[0];
  }
  if (last) return last;

  const promptWithoutTaskId = p.replace(taskId, '');
  // Require ≥2 uppercase chars in the alpha prefix on both legacy forms so
  // incidental tokens like `A-A1` in prose don't false-match. Word
  // boundaries continue to anchor the match.
  const legacyMatch = promptWithoutTaskId.match(/\b([A-Z]{2,}-\d{3}|[A-Z]{2,}-[A-Z]\d+)\b/);
  return legacyMatch ? legacyMatch[1] : null;
}

// Resolve the active task: parsed id → 2-segment prefix → most recent. Each
// candidate is accepted only if its orchestration-state.json exists.
let resolvedTaskId = null;
if (TASKS_ROOT) {
  const candidates = [];
  if (parsedId) {
    candidates.push(parsedId);
    const prefix = taskPrefixFor(parsedId);
    if (prefix && prefix !== parsedId) candidates.push(prefix);
  }
  for (const id of candidates) {
    if (fs.existsSync(path.join(TASKS_ROOT, id, 'orchestration-state.json'))) {
      resolvedTaskId = id;
      break;
    }
  }
  if (!resolvedTaskId) resolvedTaskId = mostRecentTaskDir(TASKS_ROOT, 'state');
}

const taskIdFromPrompt = parsedId; // for skeleton check (uses prompt-derived id)
const subtaskIdFromPrompt = parseSubtaskId(taskIdFromPrompt, prompt);

// Load + validate state file once. Reused by P1 phase and by the skeleton
// phase's classification check.
let state = null;
let stateMalformed = false;
const resolvedStatePath = resolvedTaskId
  ? path.join(TASKS_ROOT, resolvedTaskId, 'orchestration-state.json')
  : null;
if (resolvedStatePath && fs.existsSync(resolvedStatePath)) {
  try {
    state = JSON.parse(fs.readFileSync(resolvedStatePath, 'utf8'));
  } catch (_) {
    stateMalformed = true;
  }
}

// ---------- Phase 2: skeleton check (blocking) ----------

const ROLE_GOVERNANCE_FILES = {
  executor: ['ai/core/PROJECT_CONSTITUTION.md'],
  reviewer: ['ai/core/PROJECT_CONSTITUTION.md', 'ai/governance/REVIEW_CHECKLIST.md'],
  'delivery-pm': ['ai/governance/TRIGGER_RULES.md'],
  lead: ['ai/core/PROJECT_CONSTITUTION.md', 'ai/governance/TRIGGER_RULES.md'],
  'design-agent': ['ai/core/PROJECT_CONSTITUTION.md'],
  'integration-checker': ['ai/core/PROJECT_CONSTITUTION.md'],
};

const pluginMarker = path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');
const pluginRootValid = fs.existsSync(pluginMarker);

if (!pluginRootValid) {
  console.error(
    `[pre-task-guard] WARNING: plugin root appears invalid (no .claude-plugin/plugin.json).\n` +
      `Resolved PLUGIN_ROOT: ${PLUGIN_ROOT}\n` +
      `Skipping governance file checks. If this persists, reinstall:\n` +
      `  /plugin uninstall ai-agents-workflow\n` +
      `  /plugin install ai-agents-workflow@ai-agents-workflow\n`,
  );
} else {
  const governanceFiles = ROLE_GOVERNANCE_FILES[subagentType] || [];
  for (const relPath of governanceFiles) {
    const absPath = path.join(PLUGIN_ROOT, relPath);
    if (!fs.existsSync(absPath)) {
      console.error(
        `[pre-task-guard] BLOCKED: governance file not found: ${relPath}\n` +
          `Required by ${subagentType} for dispatch bundle assembly.\n` +
          `Expected at: ${absPath}\n`,
      );
      process.exit(1);
    }
  }
}

if (taskIdFromPrompt) {
  if (!TASKS_ROOT) {
    console.error(`[pre-task-guard] BLOCKED: ${ARTIFACT.error}\n`);
    process.exit(1);
  }
  const taskDir = path.join(TASKS_ROOT, taskIdFromPrompt);

  let taskDirIsDir = false;
  try {
    taskDirIsDir = fs.statSync(taskDir).isDirectory();
  } catch (_) {
    taskDirIsDir = false;
  }
  if (!taskDirIsDir) {
    console.error(
      `[pre-task-guard] BLOCKED: task directory not found (or not a directory): ${taskDir}\n` +
        `Chief Orchestrator must create ${path.relative(CWD, taskDir) || taskDir}/task-data.md before dispatching any agent.\n`,
    );
    process.exit(1);
  }

  if (subagentType === 'delivery-pm') {
    // Bundles are now inline in the Task prompt; no roles/<role>.md file is
    // written. The skeleton + state checks above are sufficient for delivery-pm
    // dispatch. The orchestrator MUST still invoke the context-minimizer skill
    // to compose the bundle before dispatch — that obligation is enforced at
    // the prompt level (role contract) and audit-checked post-hoc by Reviewer
    // reading summary.md → dispatch-bundles audit lines.
  } else if (subtaskIdFromPrompt) {
    // Locate the subtask directory itself; we require BOTH ai-work.md AND
    // summary.md skeletons before any subtask-agent dispatch. The orchestrator
    // creates both at trivial-flow Step 6 / standard Step 6 — Reviewer
    // finalizes summary.md downstream, so a missing skeleton means downstream
    // writes will land on a non-existent file or get suppressed entirely.
    const SUBTASK_WALK_MAX_DEPTH = 8;
    const findSubtaskDir = (dir, targetId, visited = new Set(), depth = 0) => {
      if (depth > SUBTASK_WALK_MAX_DEPTH) return null;
      let real;
      try {
        real = fs.realpathSync(dir);
      } catch (_) {
        return null;
      }
      if (visited.has(real)) return null;
      visited.add(real);
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name === targetId) return path.join(dir, entry.name);
          const nested = findSubtaskDir(
            path.join(dir, entry.name),
            targetId,
            visited,
            depth + 1,
          );
          if (nested) return nested;
        }
      } catch (_) {}
      return null;
    };

    const subtaskDir = findSubtaskDir(taskDir, subtaskIdFromPrompt);
    const skeletonPath = subtaskDir ? path.join(subtaskDir, 'ai-work.md') : null;
    const summaryPath = subtaskDir ? path.join(subtaskDir, 'summary.md') : null;
    const aiWorkExists = skeletonPath ? fs.existsSync(skeletonPath) : false;
    const summaryExists = summaryPath ? fs.existsSync(summaryPath) : false;

    if (!subtaskDir || !aiWorkExists) {
      const expectedRel =
        path.relative(CWD, path.join(taskDir, 'phase-X', subtaskIdFromPrompt, 'ai-work.md')) ||
        path.join(taskDir, 'phase-X', subtaskIdFromPrompt, 'ai-work.md');
      console.error(
        `[pre-task-guard] BLOCKED: ai-work.md skeleton not found for ${subtaskIdFromPrompt}.\n` +
          `Chief Orchestrator must write ${expectedRel}\n` +
          `using the template from ${PLUGIN_ROOT}/ai/governance/ARTIFACT_DISCIPLINE.md → section:ai-work-skeleton\n` +
          `before dispatching ${subagentType}.\n`,
      );
      process.exit(1);
    }

    if (!summaryExists) {
      const expectedRel =
        path.relative(CWD, path.join(subtaskDir, 'summary.md')) ||
        path.join(subtaskDir, 'summary.md');
      console.error(
        `[pre-task-guard] BLOCKED: summary.md skeleton not found for ${subtaskIdFromPrompt}.\n` +
          `Chief Orchestrator must create ${expectedRel} alongside ai-work.md at the\n` +
          `subtask init step (trivial-flow Step 6 / standard Step 6). Reviewer finalizes\n` +
          `summary.md downstream and Executor appends to <!-- section:context-manifest -->,\n` +
          `<!-- section:telemetry --> on it; without the skeleton those writes either fail\n` +
          `or silently no-op. Initialize it with the canonical sections (telemetry,\n` +
          `context-manifest, dispatch-bundles) before dispatching ${subagentType}.\n`,
      );
      process.exit(1);
    }

    // Validate task-level state file when present (read-side check).
    const taskLevelStatePath = path.join(taskDir, 'orchestration-state.json');
    if (fs.existsSync(taskLevelStatePath)) {
      let parsedTaskState;
      try {
        parsedTaskState = JSON.parse(fs.readFileSync(taskLevelStatePath, 'utf8'));
      } catch (e) {
        console.error(
          `[pre-task-guard] BLOCKED: orchestration-state.json is malformed JSON — ${e.message}\n` +
            `File: ${taskLevelStatePath}\n` +
            `Chief Orchestrator must rewrite this file with valid JSON before dispatching ${subagentType}.\n`,
        );
        process.exit(1);
      }

      const requiredFields = ['task_id', 'phase', 'pending_subtasks'];
      const missingFields = requiredFields.filter((f) => !(f in parsedTaskState));
      if (missingFields.length > 0) {
        console.error(
          `[pre-task-guard] BLOCKED: orchestration-state.json is missing required fields: ${missingFields.join(', ')}\n` +
            `File: ${taskLevelStatePath}\n` +
            `Chief Orchestrator must include all required fields before dispatching ${subagentType}.\n`,
        );
        process.exit(1);
      }

      // Canonical-schema check (schema_version >= 2). Legacy files without
      // schema_version are tolerated by the P1 phase (with a warn-and-upgrade
      // hint) — they are NOT blocked here. Files claiming schema_version >= 2
      // must conform to the canonical v2 shape; v3 is a strict superset of v2
      // and future versions are expected to remain backward-compatible
      // supersets, so any numeric schema_version >= 2 is validated here. Full
      // v3-specific validation (stage field, stage_history shape, etc.) lands
      // with the stage guard in a later commit.
      if (
        typeof parsedTaskState.schema_version === 'number' &&
        parsedTaskState.schema_version >= 2
      ) {
        const canonicalIssues = [];
        if (!('current_subtask' in parsedTaskState)) {
          canonicalIssues.push('current_subtask (string|null) missing');
        }
        if (!Array.isArray(parsedTaskState.pending_subtasks)) {
          canonicalIssues.push('pending_subtasks must be an array');
        }
        if (typeof parsedTaskState.last_completed_seq !== 'number') {
          canonicalIssues.push('last_completed_seq must be a number');
        }
        if (
          parsedTaskState.subtask_offsets !== undefined &&
          (typeof parsedTaskState.subtask_offsets !== 'object' ||
            Array.isArray(parsedTaskState.subtask_offsets))
        ) {
          canonicalIssues.push('subtask_offsets must be an object when present');
        }
        const validPhases = ['planning', 'planned', 'execution', 'blocked', 'complete'];
        if (!validPhases.includes(parsedTaskState.phase)) {
          canonicalIssues.push(
            `phase "${parsedTaskState.phase}" is not one of ${validPhases.join('|')}`,
          );
        }
        // Reject legacy ad-hoc field shapes (e.g. subtasks[] array with
        // current_step). The canonical schema does NOT track intra-subtask
        // role progression in state — current_subtask is the subtask ID
        // string, transitions live in orchestration-history.json.
        if ('subtasks' in parsedTaskState) {
          canonicalIssues.push(
            'unknown field "subtasks" — canonical schema uses pending_subtasks[] + current_subtask',
          );
        }
        if (canonicalIssues.length > 0) {
          console.error(
            `[pre-task-guard] BLOCKED: orchestration-state.json fails canonical schema_version=${parsedTaskState.schema_version} validation:\n` +
              canonicalIssues.map((s) => `  - ${s}`).join('\n') +
              `\n` +
              `File: ${taskLevelStatePath}\n` +
              `Resolution: invoke the orchestrator-state skill and follow ` +
              `\${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/references/state-schemas.md → Migration ` +
              `to rewrite the file in canonical shape before dispatching ${subagentType}.\n`,
          );
          process.exit(1);
        }
      }
    }

    // Bundles are now inline in the Task prompt; no roles/<role>.md file is
    // written. The orchestrator's obligation to invoke context-minimizer
    // before dispatch is enforced at the prompt level (role contract) and
    // audit-checked post-hoc by Reviewer reading summary.md → dispatch-bundles
    // audit lines. The skeleton check above is the runtime invariant we still
    // enforce here.
  }
}

// ---------- Phase 3: P1 gate check (blocking) ----------

// `init` is intentionally absent: it is a side-flow agent (owned by
// /ai-agents-workflow:init), never dispatched during the task pipeline. The
// Phase 3.5 stage gate would already block it on a v3 state file (no
// `intake`-stage allowance); leaving it in this set was dead code that drifted
// from the canonical chief-orchestrator contract.
const ALLOWED_BEFORE_P1 = new Set(['chief-orchestrator', 'delivery-pm']);
const GATED_ROLES = new Set([
  'lead',
  'executor',
  'reviewer',
  'design-agent',
  'integration-checker',
]);

if (GATED_ROLES.has(subagentType)) {
  if (!resolvedTaskId) {
    // Gated dispatch with no resolvable task state — block. The earlier
    // skeleton phase only validates when the prompt carries a parseable
    // task-id; a malformed dispatch prompt that omits the id would otherwise
    // bypass P1 silently. Gated roles must never run without a state file we
    // can read, so refuse explicitly here. (Non-gated roles like delivery-pm
    // are still allowed to run pre-state — they're the ones that create it.)
    console.error(
      `[pre-task-guard] BLOCKED: dispatch of ${subagentType} cannot proceed because ` +
        `no active task could be resolved from the dispatch prompt or recent task state.\n` +
        `Resolution: the chief-orchestrator must include the task_id (and subtask_id ` +
        `where applicable) in the Task tool prompt, and orchestration-state.json must ` +
        `exist under <artifact-root>/tasks/<task_id>/. If this is the very first ` +
        `subtask dispatch in a new task, run /ai-agents-workflow:task to begin the ` +
        `pipeline rather than dispatching ${subagentType} directly.\n`,
    );
    process.exit(1);
  } else if (stateMalformed) {
    // The skeleton phase blocks malformed state when its taskDir resolution
    // succeeds, but its taskDir derivation is independent of the
    // resolvedTaskId used here (prompt-derived). When the two paths diverge,
    // the skeleton phase may not run. Block here as a safety net so a corrupt
    // state file never silently allows a gated dispatch.
    console.error(
      `[pre-task-guard] BLOCKED: dispatch of ${subagentType} for task ${resolvedTaskId} ` +
        `cannot proceed because orchestration-state.json is malformed JSON.\n` +
        `File: ${resolvedStatePath}\n` +
        `Resolution: Chief Orchestrator must rewrite the state file with valid JSON ` +
        `conforming to the canonical schema (see ` +
        `\${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/references/state-schemas.md) ` +
        `before redispatching ${subagentType}.\n`,
    );
    process.exit(1);
  } else if (!state) {
    // resolvedTaskId pointed at a task dir, but the orchestration-state.json
    // could not be read (file disappeared between resolve and load, or was
    // never created). Block — gated roles must not fly blind.
    console.error(
      `[pre-task-guard] BLOCKED: dispatch of ${subagentType} for task ${resolvedTaskId} ` +
        `cannot proceed because orchestration-state.json is unreadable or missing.\n` +
        `Expected at: ${resolvedStatePath}\n` +
        `Resolution: chief-orchestrator must write a canonical state file (see ` +
        `\${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/SKILL.md) before ` +
        `dispatching ${subagentType}.\n`,
    );
    process.exit(1);
  } else if (!Object.prototype.hasOwnProperty.call(state, 'schema_version')) {
    console.error(
      `[pre-task-guard] WARN: legacy task ${resolvedTaskId} ` +
        `(no schema_version) — allowing dispatch; the orchestrator must ` +
        `upgrade ${resolvedStatePath} to schema_version=2 with ` +
        `gates.p1_approved=true and signature="legacy-migration" on its ` +
        `next touch (see skills/orchestrator-state/references/state-schemas.md ` +
        `→ Migration).\n`,
    );
  } else if (state.classification === 'execution-trivial') {
    // Defensive bypass: trivial path skips the P1 user gate and the
    // orchestrator auto-records gates.p1_approved=true. Even if that auto-
    // approval write was skipped, classification alone is sufficient evidence.
  } else {
    const gates = state.gates || {};
    if (gates.p1_approved !== true) {
      console.error(
        `[pre-task-guard] BLOCKED: dispatch of ${subagentType} for task ${resolvedTaskId} ` +
          `is not allowed before the P1 (Delivery Plan Approval) gate.\n` +
          `Active state file: ${resolvedStatePath}\n` +
          `Required: gates.p1_approved === true\n` +
          `Observed: gates = ${JSON.stringify(gates)}\n` +
          `Resolution: present the Delivery Plan via the orchestrator-user-gates ` +
          `skill (P1 section) and only set gates.p1_approved=true after the user ` +
          `selects "Approve plan" in AskUserQuestion. Record gates.p1_approved_at ` +
          `(ISO-8601 UTC) and gates.p1_approved_signature (sha256 of normalized ` +
          `Block 1 + Block 2 + Block 3 bytes) at the same time.\n`,
      );
      process.exit(1);
    }
  }
}

// ---------- Phase 3.5: stage guard (blocking) ----------
//
// Blocks dispatches that don't belong to the active task's lifecycle stage.
// Stages are: intake | planning | execution | closure (schema_version 3).
//
// Tolerance rules:
//   - No state file present     → exit 0 (initial intake hasn't written yet)
//   - state.stage absent        → exit 0 (no enforcement on pre-v3 state files;
//                                 wipe-and-restart policy in effect)
//   - subagent not in GATED_ROLES → not subject to the stage check
//
// Kill switch: AIAW_DISABLE_STAGE_GUARD=1 disables Phase 3.5 entirely.

const STAGE_AGENTS = {
  intake: new Set(['chief-orchestrator', 'delivery-pm']),
  planning: new Set(['chief-orchestrator', 'delivery-pm', 'lead', 'design-agent']),
  execution: new Set([
    'chief-orchestrator',
    'lead',
    'executor',
    'reviewer',
    'design-agent',
    'integration-checker',
  ]),
  closure: new Set(['chief-orchestrator']),
};

if (
  process.env.AIAW_DISABLE_STAGE_GUARD !== '1' &&
  GATED_ROLES.has(subagentType) &&
  state &&
  !stateMalformed &&
  Object.prototype.hasOwnProperty.call(state, 'stage')
) {
  const activeStage = state.stage;
  const allowed = STAGE_AGENTS[activeStage];
  if (!allowed) {
    console.error(
      `[pre-task-guard] BLOCKED: orchestration-state.json has unknown stage="${activeStage}" ` +
        `for task ${resolvedTaskId}.\n` +
        `Active state file: ${resolvedStatePath}\n` +
        `Allowed stage values: ${Object.keys(STAGE_AGENTS).join(' | ')}\n` +
        `Resolution: invoke the orchestrator-state skill and rewrite the file with a valid stage.\n`,
    );
    process.exit(1);
  }
  if (!allowed.has(subagentType)) {
    console.error(
      `[pre-task-guard] BLOCKED: dispatch of ${subagentType} for task ${resolvedTaskId} ` +
        `is not allowed in stage="${activeStage}".\n` +
        `Active state file: ${resolvedStatePath}\n` +
        `Stage whitelist: ${[...allowed].join(', ')}\n` +
        `Resolution: advance the stage via the orchestrator-state skill, or — if this is a ` +
        `planning re-open after a needs-replan / p2-replan / reversal — set stage="planning" ` +
        `(or stage="execution" for reversal), update previous_stage, increment ` +
        `stage_reopen_count, and append a stage_history entry before re-dispatching. See ` +
        `\${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-state/SKILL.md → "Stage Discipline" for ` +
        `the full reopen protocol.\n`,
    );
    process.exit(1);
  }
}

// ---------- Phase 4: trigger evaluation (non-blocking, stdout) ----------

const GOVERNANCE_PATH = path.join(PLUGIN_ROOT, 'ai', 'governance', 'TRIGGER_RULES.md');
const PROJECT_CONFIG_PATH = ARTIFACT_ROOT
  ? path.join(ARTIFACT_ROOT, 'config', 'PROJECT_CONFIG.md')
  : null;
const ARTIFACT_PATH = process.argv[3] || process.env.ARTIFACT_PATH || '';
const targetAgent = bareRole(process.argv[2] || rawSubagentType);

function parseKeywordSection(filePath, sectionName) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
  const sectionRegex = new RegExp(
    `<!--\\s*section:${sectionName}\\s*-->([\\s\\S]*?)<!--\\s*/section:${sectionName}\\s*-->`,
  );
  const sectionMatch = raw.match(sectionRegex);
  if (!sectionMatch) return null;

  const yamlMatch = sectionMatch[1].match(/```yaml([\s\S]*?)```/);
  if (!yamlMatch) return null;

  const rules = {};
  let currentAgent = null;
  let mixedIndentWarned = false;
  for (const line of yamlMatch[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Reject mixed tabs/spaces in the leading indent of any non-empty line.
    // The parser treats leading whitespace as significant when grouping list
    // items under their agent key, so a tab/space mix silently misaligns
    // them. Surface a single warning per parse and skip the offending line
    // rather than producing a wrongly-grouped rule set.
    const indentMatch = line.match(/^([ \t]*)\S/);
    if (indentMatch && /\t/.test(indentMatch[1]) && / /.test(indentMatch[1])) {
      if (!mixedIndentWarned) {
        mixedIndentWarned = true;
        console.error(
          `[pre-task-guard] WARN: trigger-rules YAML in ${filePath} mixes tabs and spaces in line indentation; ` +
            `affected lines are skipped. Use spaces only.\n`,
        );
      }
      continue;
    }

    const agentMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(\[\s*\])?\s*$/);
    if (agentMatch) {
      currentAgent = agentMatch[1];
      if (!rules[currentAgent]) rules[currentAgent] = [];
      continue;
    }
    const itemMatch = line.match(/^\s*-\s+(.+?)\s*$/);
    if (itemMatch && currentAgent) {
      rules[currentAgent].push(itemMatch[1].toLowerCase());
    }
  }
  return rules;
}

const CACHE_PATH = ARTIFACT_ROOT
  ? path.join(ARTIFACT_ROOT, 'config', '.trigger-keywords-cache.json')
  : null;

function getFileMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch (_) {
    return 0;
  }
}

function loadCachedRules() {
  if (!CACHE_PATH) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

let cacheWriteWarned = false;
function saveCachedRules(cache) {
  if (!CACHE_PATH) return;
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf8');
  } catch (e) {
    // Don't block on cache write failure (cold cache just means slightly
    // slower next run), but emit one stderr line per process so a
    // permission/disk-full issue doesn't fail silently forever.
    if (!cacheWriteWarned) {
      cacheWriteWarned = true;
      console.error(
        `[pre-task-guard] WARN: failed to write trigger-rules cache at ${CACHE_PATH}: ${e.message}\n`,
      );
    }
  }
}

function getCachedOrParse(filePath, sectionName, cacheKey, cache) {
  const currentMtime = getFileMtime(filePath);
  if (cache && cache[cacheKey] && cache[cacheKey].mtime === currentMtime && currentMtime > 0) {
    return cache[cacheKey].rules;
  }
  const rules = parseKeywordSection(filePath, sectionName);
  if (!cache) cache = {};
  cache[cacheKey] = { mtime: currentMtime, rules };
  return rules;
}

const pluginVersion = getPluginVersion(PLUGIN_ROOT);
let cache = loadCachedRules();
if (cache && cache.pluginVersion !== pluginVersion) cache = {};
cache = cache || {};
cache.pluginVersion = pluginVersion;

const baseRules = getCachedOrParse(GOVERNANCE_PATH, 'trigger-keywords', 'base', cache);
if (!baseRules || Object.keys(baseRules).length === 0) process.exit(0);

const extraRules = getCachedOrParse(PROJECT_CONFIG_PATH, 'extra-trigger-keywords', 'extra', cache) || {};
saveCachedRules(cache);

const TRIGGER_RULES = {};
const allAgents = new Set([...Object.keys(baseRules), ...Object.keys(extraRules)]);
for (const agent of allAgents) {
  const merged = new Set([...(baseRules[agent] || []), ...(extraRules[agent] || [])]);
  if (merged.size > 0) TRIGGER_RULES[agent] = [...merged];
}

if (Object.keys(TRIGGER_RULES).length === 0) process.exit(0);

let artifactText = '';
if (ARTIFACT_PATH) {
  try {
    const raw = fs.readFileSync(ARTIFACT_PATH, 'utf8');
    const specMatch = raw.match(/<!--\s*section:spec\s*-->([\s\S]*?)<!--\s*\/section:spec\s*-->/i);
    artifactText = (specMatch ? specMatch[1] : raw).toLowerCase();
  } catch (_) {}
}

const CONDITIONAL_AGENTS = Object.keys(TRIGGER_RULES);
if (!CONDITIONAL_AGENTS.includes(targetAgent) && targetAgent !== '') {
  process.exit(0);
}

const triggered = [];
const notTriggered = [];

for (const [agent, keywords] of Object.entries(TRIGGER_RULES)) {
  const hits = keywords.filter((kw) => artifactText.includes(kw));
  if (hits.length > 0) triggered.push({ agent, hits });
  else notTriggered.push(agent);
}

if (triggered.length === 0 && notTriggered.length === 0) process.exit(0);

console.log('\n[evaluate-triggers] TRIGGER ASSESSMENT:');

if (triggered.length > 0) {
  console.log('  RECOMMENDED to run:');
  for (const { agent, hits } of triggered) {
    console.log(
      `    ✓ ${agent} (matched: ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? '...' : ''})`,
    );
  }
}

if (notTriggered.length > 0) {
  console.log(`  No trigger detected for: ${notTriggered.join(', ')}`);
}

if (targetAgent && CONDITIONAL_AGENTS.includes(targetAgent)) {
  const isTriggered = triggered.some((t) => t.agent === targetAgent);
  if (!isTriggered) {
    console.log(
      `\n  WARNING: Dispatching ${targetAgent} but no trigger keywords detected in current artifact.`,
    );
    console.log('  Verify this dispatch is intentional per TRIGGER_RULES.md.');
  }
}

console.log('');
process.exit(0);

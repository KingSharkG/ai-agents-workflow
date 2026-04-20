#!/usr/bin/env node
/**
 * PreToolUse hook: guard-forbidden-workflows (blocking)
 *
 * Blocks invocation of competing workflow orchestrators listed in
 * ai/governance/FORBIDDEN_WORKFLOWS.md. Applies to two tool matchers:
 *
 *   Task  — blocks dispatch when subagent_type matches a denylist entry
 *           whose kind is "subagent".
 *   Skill — blocks invocation when the skill name matches a denylist entry
 *           whose kind is "skill".
 *
 * "applies_to" scoping in the YAML:
 *   - "all"                  → block every caller (including direct user use
 *                              when Claude Code dispatches via the agent).
 *   - [role1, role2, ...]    → block only when the calling agent role is in
 *                              this list. The calling role is read from
 *                              CLAUDE_SUBAGENT_TYPE (the role CURRENTLY
 *                              running, not the one being dispatched). When
 *                              that env is absent (top-level user session),
 *                              "all"-scoped entries still block; role-scoped
 *                              entries fall through (no block) so the user
 *                              retains full control.
 *
 * Env vars read:
 *   CLAUDE_TOOL_INPUT_SUBAGENT_TYPE — Task → who is being dispatched
 *   CLAUDE_TOOL_INPUT_SKILL         — Skill → which skill name
 *   CLAUDE_TOOL_MATCHER             — "Task" | "Skill" (when provided)
 *   CLAUDE_SUBAGENT_TYPE            — currently-running agent role
 *   CLAUDE_PLUGIN_ROOT              — plugin installation root
 *
 * Exit semantics:
 *   0 — allow
 *   1 — block (stderr carries the actionable message)
 *
 * Non-fatal on denylist read failures: if the governance file cannot be
 * parsed, emit a stderr warning and exit 0. The skeleton + other guards
 * remain authoritative; this hook is additive.
 */

const fs = require('fs');
const path = require('path');
const { resolvePluginRoot } = require('./_resolve-plugin-root');

const PLUGIN_ROOT = resolvePluginRoot();
const DENYLIST_PATH = path.join(
  PLUGIN_ROOT,
  'ai',
  'governance',
  'FORBIDDEN_WORKFLOWS.md',
);

const stripNamespace = (id) =>
  id && id.includes(':') ? id : id; // identifiers here are already fully-qualified "plugin:name"

const bareRole = (id) => {
  if (!id) return '';
  return id.includes(':') ? id.split(':').pop() : id;
};

// --- Parse the YAML-ish denylist out of FORBIDDEN_WORKFLOWS.md ---
//
// We only support a tiny subset of YAML: the "entries:" list with
// per-item keys id, kind, applies_to, replacement. applies_to may be
// the literal "all" or a flow-style list [a, b, c].
function readDenylist() {
  let raw;
  try {
    raw = fs.readFileSync(DENYLIST_PATH, 'utf8');
  } catch (e) {
    return {
      entries: [],
      error: `cannot read ${DENYLIST_PATH}: ${e.message}`,
    };
  }

  const sectionMatch = raw.match(
    /<!--\s*section:denylist\s*-->([\s\S]*?)<!--\s*\/section:denylist\s*-->/,
  );
  if (!sectionMatch) {
    return { entries: [], error: 'section:denylist not found' };
  }

  const yamlBlock = sectionMatch[1].match(/```yaml([\s\S]*?)```/);
  if (!yamlBlock) {
    return { entries: [], error: 'yaml fence not found under section:denylist' };
  }

  const lines = yamlBlock[1].split('\n');
  const entries = [];
  let current = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // New entry starts with "- id: ..."
    const itemStart = line.match(/^\s*-\s*id:\s*(\S+)\s*$/);
    if (itemStart) {
      if (current) entries.push(current);
      current = { id: itemStart[1], kind: '', applies_to: 'all', replacement: '' };
      continue;
    }

    if (!current) continue;

    const kv = line.match(/^\s*([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;

    if (key === 'applies_to') {
      const trimmed = value.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        current.applies_to = trimmed
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        current.applies_to = trimmed.replace(/^["']|["']$/g, '');
      }
    } else {
      current[key] = value.trim().replace(/^["']|["']$/g, '');
    }
  }
  if (current) entries.push(current);

  return { entries };
}

// --- Match identifier against denylist entry (supports trailing "*") ---
function idMatches(entryId, candidate) {
  if (!entryId || !candidate) return false;
  if (entryId.endsWith('*')) {
    const prefix = entryId.slice(0, -1);
    return candidate.startsWith(prefix);
  }
  return entryId === candidate;
}

// --- Should this entry block given the calling role? ---
function scopeMatches(entry, callingRole) {
  if (entry.applies_to === 'all') return true;
  if (!Array.isArray(entry.applies_to)) return false;
  if (!callingRole) return false;
  return entry.applies_to.includes(callingRole);
}

// --- Main ---

const { entries, error } = readDenylist();
if (error) {
  console.error(`[guard-forbidden-workflows] WARNING: ${error}; allowing this call.`);
  process.exit(0);
}
if (entries.length === 0) {
  process.exit(0);
}

const matcher = (process.env.CLAUDE_TOOL_MATCHER || '').trim();
const rawDispatchTarget = process.env.CLAUDE_TOOL_INPUT_SUBAGENT_TYPE || '';
const rawSkill = process.env.CLAUDE_TOOL_INPUT_SKILL || '';
const callingRole = bareRole(process.env.CLAUDE_SUBAGENT_TYPE || '');

// Heuristic when matcher is not provided: prefer skill, fall back to task target.
const isSkillCall = matcher === 'Skill' || (!matcher && !!rawSkill);
const isTaskCall = matcher === 'Task' || (!matcher && !!rawDispatchTarget);

if (!isSkillCall && !isTaskCall) {
  process.exit(0);
}

const candidate = isSkillCall ? stripNamespace(rawSkill) : stripNamespace(rawDispatchTarget);
if (!candidate) process.exit(0);

for (const entry of entries) {
  const kindMatches =
    (isSkillCall && entry.kind === 'skill') ||
    (isTaskCall && entry.kind === 'subagent');
  if (!kindMatches) continue;
  if (!idMatches(entry.id, candidate)) continue;
  if (!scopeMatches(entry, callingRole)) continue;

  const kindWord = isSkillCall ? 'skill' : 'subagent';
  const callerDesc = callingRole
    ? `calling role: ${callingRole}`
    : 'top-level call (no CLAUDE_SUBAGENT_TYPE)';
  const replacementLine = entry.replacement
    ? `Use instead: ${entry.replacement}`
    : 'See ai/governance/FORBIDDEN_WORKFLOWS.md for the approved replacement.';

  console.error(
    `[guard-forbidden-workflows] BLOCKED: ${kindWord} "${candidate}" matches denylist entry "${entry.id}".\n` +
      `This ${kindWord} orchestrates a competing workflow and conflicts with the ai-agents-workflow pipeline.\n` +
      `${callerDesc}\n` +
      `${replacementLine}\n` +
      `Governance: ${path.relative(PLUGIN_ROOT, DENYLIST_PATH)}\n`,
  );
  process.exit(1);
}

process.exit(0);

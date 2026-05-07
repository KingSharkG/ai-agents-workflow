---
name: resolve-artifact-root
description: Single source of truth for resolving `<artifact-root>` to an absolute path before any path check, Read, or dispatch. Use whenever a slash command, main-thread pre-flight, or any flow needs to know where the consumer project's `aiaw-data-<project>/` folder lives. Subagents and skills that receive the path from a dispatch bundle do NOT invoke this skill — they read the bundle's `<!-- artifact-root: ... -->` line.
stage: shared
---

# Resolve Artifact Root

The single canonical procedure for computing the absolute path of the consumer project's artifact root. **Every place in the plugin that would otherwise inline its own resolution prose MUST invoke this skill instead.** This eliminates the drift that occurs when commands hard-code one of the two layouts or treat `<artifact-root>` as a literal directory name.

## Supported layouts

A consumer project picks one of two layouts at `/ai-agents-workflow:init`:

- **In-project** — `<cwd>/.claude/aiaw-data-<project>/`
- **Sibling**    — `<dirname(cwd)>/aiaw-data-<project>/`

`<project>` is `path.basename(cwd)` (no slugification). The resolver also detects the legacy `<cwd>/ai-workflow-data/` folder and emits a migration hint instead of silently picking it up.

## Single resolver

Always call the CLI wrapper:

```
node "${CLAUDE_PLUGIN_ROOT}/hooks/bin/resolve-artifact-root.js"
```

- **Plain mode** (default): exit 0 prints the absolute root on stdout; exit 1 prints a diagnostic on stderr.
- **`--json` mode**: always exit 0; prints one JSON object `{"root", "name", "layout", "legacyDetected", "error"}`. Use this when both success and diagnostic are needed.

Hooks and library code call `hooks/lib/artifact-root.js` directly via `require(...)`. Markdown-driven flows (slash commands, agent stubs) call the wrapper.

## Protocol

1. Run `node "${CLAUDE_PLUGIN_ROOT}/hooks/bin/resolve-artifact-root.js"` via Bash.
2. **Exit 0** → capture stdout (trimmed) as `ARTIFACT_ROOT`. Use this absolute path for every `<artifact-root>` reference for the rest of the turn — path checks, `Read`s, dispatch envelopes, file writes.
3. **Exit 1** → resolver could not locate an artifact root. Branch:
   - If `.claude-plugin/plugin.json` exists in CWD, surface: `"You appear to be in the plugin directory. Run this command from your project repo instead."` and exit without dispatching.
   - Otherwise surface the resolver's stderr verbatim — it already emits the legacy-folder migration hint or a `"run /ai-agents-workflow:init first"` hint. Then either exit (mutating commands) or proceed only if the user confirms (read-mostly commands). The caller decides which.

## Constraints

Callers MUST NOT:

- Treat `<artifact-root>` as a literal directory name.
- Hard-code one of the two layouts or probe `.claude/aiaw-data-*` / `../aiaw-data-*` themselves.
- Probe `ai-workflow-data/` (legacy folder) directly — let the resolver emit the migration hint.
- Skip the resolver and rely on `Read` errors to detect a missing config — `Read` failure does not distinguish "wrong layout" from "uninitialized".

`allowed-tools` for any slash command that invokes this skill MUST include `Bash`. Add `Read` if the command then reads files under the resolved root.

## After resolution

Follow-on existence checks (e.g. `${ARTIFACT_ROOT}/config/PROJECT_CONFIG.md`) use the captured absolute path. The resolver only confirms the artifact *folder* exists; per-file existence is the caller's responsibility.

When dispatching a subagent, embed the absolute path in the bundle envelope:

```
<!-- dispatch-bundle:start role=<role> -->
<!-- artifact-root: <ARTIFACT_ROOT> -->
...
<!-- dispatch-bundle:end -->
```

The subagent reads `<!-- artifact-root: ... -->` and uses the absolute path directly — it does NOT re-invoke this skill. Re-resolution inside subagents is wasted work and risks divergence if the user moves the project mid-task.

## Reference implementations

- [hooks/bin/resolve-artifact-root.js](../../hooks/bin/resolve-artifact-root.js) — the wrapper.
- [hooks/lib/artifact-root.js](../../hooks/lib/artifact-root.js) — the resolver library used by hooks.
- [commands/pr-lessons.md](../../commands/pr-lessons.md) — example of a command that invokes this protocol.

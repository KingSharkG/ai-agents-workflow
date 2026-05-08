---
name: init
description: Bootstrap <artifact-root>/config/PROJECT_CONFIG.md for this repo via the init agent.
argument-hint: "[--force]"
allowed-tools: Task
---

Dispatch the `init` subagent to bootstrap the consumer repo's project configuration.

Use the Task tool with `subagent_type: ai-agents-workflow:init` and pass this prompt to the agent:

```
init $ARGUMENTS
```

The init agent will:

1. **Resolve or pick the artifact layout.** If neither `./.claude/aiaw-data-<project>/` nor `../aiaw-data-<project>/` exists, ask which layout to use:
   - **In-project** — `./.claude/aiaw-data-<project>/` (default, no permission grant needed).
   - **Sibling** — `../aiaw-data-<project>/` (merges one entry into `<project>/.claude/settings.local.json`, which is gitignored).
   If a legacy `./ai-workflow-data/` folder is present, the agent refuses to proceed and directs you to the README's Migration section.
2. Run the `project-discovery` skill (non-mutating ecosystem scan).
3. Ask scoped multiple-choice questions via `AskUserQuestion` for any ambiguous classification.
4. Run the `project-config-review` review-and-comment gate (loops on user comments until explicit approval).
5. Write `<artifact-root>/config/PROJECT_CONFIG.md` and ensure `<artifact-root>/tasks/.gitkeep` exists.

If the file already exists and `--force` was not passed, the agent will exit with `already initialized`. `--force` rewrites only `PROJECT_CONFIG.md` (and the derived context cache); it does **not** change the artifact layout. To switch layouts (e.g. in-project → sibling), `mv` the folder manually per the README Migration section before re-running `init --force`. On a fresh project (no artifact folder yet), `--force` does not bypass the Step 0 layout question — it still appears once.

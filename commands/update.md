---
description: Rescan the repo and refresh CLI-owned sections of <artifact-root>/config/PROJECT_CONFIG.md.
argument-hint: ""
allowed-tools: Task
---

Dispatch the `init` subagent in `update` mode.

Pre-flight: if CWD does not contain `<artifact-root>/` and does contain `.claude-plugin/plugin.json`, surface: "You appear to be in the plugin directory. Run this command from your project repo instead." and exit without dispatching.

Use the Task tool with `subagent_type: ai-agents-workflow:init` and prompt:

```
update
```

The init agent re-runs `project-discovery`, refreshes only CLI-owned sections (preserving user-authored content and inter-section prose), shows a diff via the `project-config-review` gate, and writes only on approval.

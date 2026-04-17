---
description: Rescan the repo and refresh CLI-owned sections of ai-workflow-data/config/PROJECT_CONFIG.md.
argument-hint: ""
allowed-tools: Task
---

Dispatch the `init` subagent in `update` mode.

Use the Task tool with `subagent_type: ai-agents-workflow:init` and prompt:

```
update
```

The init agent re-runs `project-discovery`, refreshes only CLI-owned sections (preserving user-authored content and inter-section prose), shows a diff via the `project-config-review` gate, and writes only on approval.

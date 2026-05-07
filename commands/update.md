---
name: update
description: Rescan the repo and refresh CLI-owned sections of <artifact-root>/config/PROJECT_CONFIG.md.
argument-hint: ""
allowed-tools: Task, Bash(node:*), Skill
---

Dispatch the `init` subagent in `update` mode.

Pre-flight: invoke the `ai-agents-workflow:resolve-artifact-root` skill to obtain `ARTIFACT_ROOT` for the dispatch. On resolver failure, follow the skill's mutating-command branch (exit without dispatching after the surfaced diagnostic).

Use the Task tool with `subagent_type: ai-agents-workflow:init` and prompt:

```
update
```

The init agent re-runs `project-discovery`, refreshes only CLI-owned sections (preserving user-authored content and inter-section prose), shows a diff via the `project-config-review` gate, and writes only on approval.

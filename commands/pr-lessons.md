---
name: pr-lessons
description: Harvest review comments from a GitHub PR into <artifact-root>/knowledge/pr-lessons.md so the same mistake isn't made twice.
argument-hint: "<PR number | owner/repo#N | full PR URL>"
allowed-tools: Task, AskUserQuestion, Bash(gh:*), Bash(git:*), Bash(command:*), Bash(node:*), Read, Skill
---

Dispatch the `pr-lessons-harvester` subagent to fetch review comments from the given PR, distill them into lesson candidates, confirm with the user, and append accepted lessons.

Pre-flight:
1. If `$ARGUMENTS` is empty, use `AskUserQuestion` to collect a PR reference (number, `owner/repo#N`, or full URL).
2. If neither `gh` is on PATH (`command -v gh`) nor a GitHub MCP server is configured for this session, surface: "This command needs either the `gh` CLI installed or the GitHub MCP plugin configured. Install one and retry." Exit without dispatching.
3. If `$ARGUMENTS` is a bare PR number (no `owner/repo#` prefix and no URL), require a git checkout with a remote so the harvester can infer `owner/repo`. Run `git rev-parse --is-inside-work-tree` and `git remote get-url origin`. If either fails, surface: "PR number `<N>` requires a git checkout with a GitHub remote, or pass `owner/repo#<N>` / a full PR URL instead." Exit without dispatching.
4. Invoke the `ai-agents-workflow:resolve-artifact-root` skill to obtain `ARTIFACT_ROOT`. On resolver failure, follow the skill's mutating-command branch (exit without dispatching after the surfaced diagnostic — this includes the "you appear to be in the plugin directory" branch when `.claude-plugin/plugin.json` exists).

Then dispatch via the Task tool with `subagent_type: ai-agents-workflow:pr-lessons-harvester`. The Task `prompt` MUST be exactly the envelope below (substitute `<ARTIFACT_ROOT>` with the captured absolute path and `<PR_REF>` with `$ARGUMENTS` verbatim — no extra prose, no surrounding text):

```
<!-- dispatch-bundle:start role=pr-lessons-harvester -->
<!-- artifact-root: <ARTIFACT_ROOT> -->

PR reference: <PR_REF>
<!-- dispatch-bundle:end -->
```

The harvester will:

1. Resolve the PR coordinates (`owner`, `repo`, `number`).
2. Fetch review comments + general comments + review summaries via GitHub MCP, falling back to `gh api`.
3. Invoke the `pr-lesson-extraction` skill to classify and generalize comments into candidate lessons.
4. Show numbered candidates and ask which to keep / edit / drop via `AskUserQuestion`.
5. Persist accepted lessons through the `pr-lessons-store` skill, which handles dedup/merge against existing entries in `<artifact-root>/knowledge/pr-lessons.md`.

After the run, the file at `<artifact-root>/knowledge/pr-lessons.md` is consulted automatically by:
- The `reviewer` agent during code review (via the `pr-lessons-check` skill).
- The user before commit / PR creation by invoking `pr-lessons-check` directly against `git diff`.

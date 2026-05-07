---
name: review
description: Run a pr-lessons-aware review of local changes or a GitHub PR; offer to fix findings via /ai-agents-workflow:task.
argument-hint: "[pr-number | PR URL | natural-language phrase]"
allowed-tools: SlashCommand, Skill, AskUserQuestion, Read, Bash(gh:*), Bash(git:*), Bash(node:*), Bash(command:*)
---

Run a code review with the project's accumulated PR lessons injected as additional review criteria, then offer to fix the findings via `/ai-agents-workflow:task`.

This command is a thin glue layer over two upstream review skills (`pr-review-toolkit:review-pr` for local diffs, `code-review:code-review` for GitHub PRs). The differentiator is that `pr-lessons-check` runs first and its matches are prepended as a "Project-specific lessons to verify" preamble before the upstream skill runs.

Output is **chat-only** — no files written under `<artifact-root>/`, no GitHub PR comments posted (the upstream `code-review:code-review` skill normally posts; suppress that — see Step 4).

## Pre-flight

1. Invoke the `ai-agents-workflow:resolve-artifact-root` skill to obtain `ARTIFACT_ROOT`. On resolver failure, follow the skill's read-mostly branch (proceed only if the user confirms after the surfaced diagnostic).
2. Verify `gh` is available if PR-mode is plausible: `command -v gh`. If absent and the user asked for PR mode, surface "PR review needs the `gh` CLI installed." and exit.

## Step 1 — Argument interpretation

Parse `$ARGUMENTS` (verbatim user input after the command). First match wins:

1. **Empty** → `MODE=local`, `PR_NUMBER=`, `USER_INTENT=`.
2. **Matches `^\d+$`** → `MODE=pr`, `PR_NUMBER=$ARGUMENTS`, `USER_INTENT=`.
3. **Matches a GitHub PR URL** (`https://github.com/<owner>/<repo>/pull/<n>`) → `MODE=pr`, extract `PR_NUMBER`, `USER_INTENT=`.
4. **Otherwise** (natural-language phrase) → set `USER_INTENT=$ARGUMENTS` verbatim, then route by keywords:
   - Phrase contains `my pr` / `the pr` / `this pr` / `current pr` / `current PR` → run `gh pr view --json number -q .number` to get the open PR for the current branch. If success → `MODE=pr`, `PR_NUMBER=<output>`. If `gh` exits non-zero (no PR for branch) → `MODE=local` and print one line: "No open PR found for the current branch — reviewing local changes instead."
   - Phrase contains `changes` / `diff` / `branch` / `uncommitted` / `improve` (and no PR keyword) → `MODE=local`.
   - Otherwise → `MODE=local` (default fallback).

Preserve `USER_INTENT` verbatim — it gets passed to the upstream review skill in the preamble even when routing is unambiguous, so phrasing like "check what could be improved" influences review focus.

## Step 2 — Run pr-lessons-check

Invoke the `ai-agents-workflow:pr-lessons-check` skill with:

- `artifact_root`: the absolute `ARTIFACT_ROOT` from pre-flight.
- Diff source:
  - `MODE=local` → `{ "kind": "unstaged" }` (the skill resolves it via `git diff`).
  - `MODE=pr` → fetch the diff first via `gh pr diff <PR_NUMBER>` and pass the unified diff string. If `gh pr diff` fails, surface the stderr and exit.

Capture the structured output `{ lessons_loaded, matches }`. Always print one line: `PR Lessons: <lessons_loaded> loaded, <matches.length> match(es).` (Required by the skill's contract — makes the wiring observable even at zero matches.)

If `<artifact-root>/knowledge/pr-lessons.md` does not exist, the skill returns `{ lessons_loaded: 0, matches: [] }` quietly — no fallback handling needed beyond the one-line print.

## Step 3 — Build the review preamble

Assemble a markdown preamble the upstream skill will see as additional context:

```
## Project-specific lessons to verify

<for each match in pr-lessons-check output:>
- **<rule>** (`<slug>`, score <score>)
  - Why: <why>
  - Fix: <fix>
  - Evidence: `<evidence[0].file>:<evidence[0].line>` — <evidence[0].snippet>

<if matches is empty: omit the entire heading and bullets — leave the preamble blank for this section.>

## User intent

<USER_INTENT verbatim, only if non-empty; otherwise omit the heading.>
```

If both sections are empty, the preamble is the empty string.

## Step 4 — Invoke the upstream review skill

**Local mode (`MODE=local`):** Invoke the `pr-review-toolkit:review-pr` skill. Pass the preamble as additional context to be considered alongside the standard review aspects (tests, errors, comments, types, simplification).

**PR mode (`MODE=pr`):** Invoke the `code-review:code-review` skill against PR `<PR_NUMBER>`. Pass the preamble as additional review criteria. **Important:** instruct the upstream skill to print findings in chat only — do NOT post a GitHub review comment (no `gh pr review --body` call). If the upstream skill insists on posting, surface a one-line note to the user and abort the post.

Capture the upstream skill's output as `REVIEW_MARKDOWN`. Print it.

## Step 5 — Findings handoff

Parse `REVIEW_MARKDOWN` to count actionable findings (severity-tagged items: Critical / Important / Suggestions, or whatever the upstream skill emits).

**If zero findings:** print "No findings — nothing to fix." and stop. Do NOT show the popup.

**Otherwise:**

### 5a. Print numbered findings

Re-emit the findings as a flat numbered list (1, 2, 3, …) across all severities, preserving each finding's original severity tag and file:line reference:

```
### Findings (numbered for selection)

1. [Critical] src/auth.ts:42 — <summary>
2. [Important] src/api.ts:101 — <summary>
3. [Suggestion] README.md:12 — <summary>
...
```

This numbering is what the user references in the popup's free-text input.

### 5b. Show the handoff popup

Use `AskUserQuestion` with one question, two canned options + the built-in Other field:

- **Question:** "Fix these findings via `/ai-agents-workflow:task`?"
- **Header:** `Fix findings`
- **multiSelect:** `false`
- **Option 1:** `Fix all findings via /task` — description: "Send every finding to /ai-agents-workflow:task. Step 0 classification picks the right execution path." Mark `(Recommended)` if any Critical findings exist.
- **Option 2:** `Skip` — description: "Don't fix anything. Review output stays in chat."

The user can also type into the built-in "Other" field, e.g. `1, 3, 5: skip the cosmetic ones` — meaning "Fix selected" with optional inline comment.

### 5c. Branch on the response

- **`Fix all findings`** → all numbered findings selected. `USER_COMMENT=` empty.
- **`Skip`** → return silently. Done.
- **Free-text in Other** →
  1. Extract numbers via regex `\d+`. Each must reference an existing finding number; ignore out-of-range numbers and silently drop duplicates.
  2. Take everything after the first `:` as `USER_COMMENT` (trimmed). If no `:`, `USER_COMMENT=` empty.
  3. If zero valid numbers parsed, re-prompt the popup once. On second failure, print "No valid finding numbers parsed — aborting." and stop.

### 5d. Synthesize the task input

Build a single string (no extra prose):

```
Fix the following review findings:

<for each selected finding, copied verbatim from the numbered list above — include severity tag, file:line, and the original summary/details from REVIEW_MARKDOWN>

User notes: <USER_COMMENT if non-empty; otherwise omit this line entirely>
```

### 5e. Dispatch /ai-agents-workflow:task

Invoke the `/ai-agents-workflow:task` slash command via the `SlashCommand` tool, passing the synthesized string as the argument. The chief-orchestrator's Step 0 classification decides whether the fix runs as `execution-trivial`, `execution-simple`, or `execution-full`.

Do not attempt to bypass classification — even small-looking fixes go through the standard intake popup.

## Notes for implementers

- This command runs entirely in the main thread; it does NOT dispatch a chief-orchestrator subagent for the review itself. The only subagent dispatch happens in Step 5e via the chained `/ai-agents-workflow:task` call.
- No `ai-work.md`, no `<artifact-root>/tasks/<task_id>/` folder, no `<artifact-root>/reviews/`. The `pre-task-guard` hook does not fire because no pipeline subagent is dispatched directly from this command.
- `pr-lessons-check` is read-only and bounded — safe to run before any user confirmation.
- If `MODE=pr` and the user lacks repo write access, the upstream `code-review:code-review` skill may still attempt to post; the explicit "chat-only" instruction in Step 4 must be respected by the caller.

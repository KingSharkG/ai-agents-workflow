---
name: review
description: Run a pr-lessons-aware review of local changes or a GitHub PR; offer to fix findings via /ai-agents-workflow:task.
argument-hint: "[pr-number | PR URL | natural-language phrase]"
allowed-tools: SlashCommand, Skill, AskUserQuestion, Read, Bash(gh:*), Bash(git:*), Bash(node:*), Bash(command:*)
# Bash allowlist is wider than `task.md` because this command runs entirely
# in the main thread (no orchestrator dispatch) and needs:
#   gh:*       — fetch PR diff/metadata for PR mode
#   git:*      — read local diff for branch/uncommitted-changes mode
#   node:*     — `node ${CLAUDE_PLUGIN_ROOT}/hooks/bin/resolve-artifact-root.js` via resolve-artifact-root
#   command:*  — `command -v gh` availability probe in pre-flight
---

Run a code review with the project's accumulated PR lessons injected as additional review criteria, then offer to fix the findings via `/ai-agents-workflow:task`.

This command is a thin glue layer over two upstream review skills (`pr-review-toolkit:review-pr` for local diffs, `code-review:code-review` for GitHub PRs). The differentiator is that `pr-lessons-check` runs first and its matches are prepended as a "Project-specific lessons to verify" preamble before the upstream skill runs.

Output is **chat-only** — no files written under `<artifact-root>/`, no GitHub PR comments posted unless the user explicitly chooses the "Post as PR comments" option in Step 5b (the upstream `code-review:code-review` skill normally posts during review itself; suppress that — see Step 4).

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

### 5b-pre. Authorship detection (PR mode only)

Skip this entire sub-step in local mode. In PR mode, resolve:

- `CURRENT_USER` ← `gh api user --jq .login`
- `PR_AUTHOR` ← `gh pr view <PR_NUMBER> --json author --jq .author.login`
- `IS_OWN_PR` ← `CURRENT_USER == PR_AUTHOR` (boolean)
- `HEAD_SHA` ← `gh pr view <PR_NUMBER> --json headRefOid --jq .headRefOid` (fail early — needed for inline comments in 5f)
- `REPO_NWO` ← `gh repo view --json nameWithOwner --jq .nameWithOwner` (for inline-comment API path)

On any `gh` failure for `CURRENT_USER` or `PR_AUTHOR` → set `IS_OWN_PR=true` (preserves legacy behavior) and print exactly: `Could not determine PR authorship — defaulting to own-PR behavior.`

On `HEAD_SHA` failure → leave `HEAD_SHA=""` and remember to force top-level fallback for every finding in the comment loop (with a single warning line at the start of that loop).

### 5b. Show the handoff popup

Use `AskUserQuestion` with one question + the built-in Other field.

**Question:** "How would you like to handle these findings?"
**Header:** `Handle findings`
**multiSelect:** `false`

**PR mode — three options:**

1. `Fix via /ai-agents-workflow:task` — description: "Send selected findings to /ai-agents-workflow:task. Step 0 classification picks the right execution path." Mark `(Recommended)` when `IS_OWN_PR=true`.
2. `Post as PR comments` — description: "Walk findings one-by-one and post each as a comment on the original PR (inline when file:line is known, top-level otherwise)." Mark `(Recommended)` when `IS_OWN_PR=false`.
3. `Skip` — description: "Don't act on findings. Review output stays in chat."

**Local mode — two options** (unchanged): `Fix via /ai-agents-workflow:task` (Recommended if any Critical findings exist) and `Skip`. The PR-comments option is omitted because there is no PR to post to.

The user can also type into the built-in "Other" field — see 5c routing.

### 5c. Branch on the response

The response selects an **action set** mapping `task` and/or `comment` to a subset of findings.

**Canned-option responses:**

- **`Fix via /ai-agents-workflow:task`** → action set: `{ task: [all findings] }`, `USER_COMMENT=""`.
- **`Post as PR comments`** (PR mode only) → action set: `{ comment: [all findings] }`, `USER_COMMENT=""`.
- **`Skip`** → return silently. Done.

**Free-text in Other** — parse into an action set:

1. **Extract numbers** via regex `\d+`. Each must reference an existing finding number; out-of-range numbers and duplicates are silently dropped.
2. **Extract action keywords** (case-insensitive, word-boundary):
   - `fix` / `task` / `apply` → `task` action
   - `comment` / `post` / `reply` / `review` → `comment` action (PR mode only — in local mode the keyword is treated as unparseable)
   - `skip` / `ignore` → exclude those numbers from any action
3. **Extract `USER_COMMENT`**: everything after the first `:` (trimmed). If no `:`, `USER_COMMENT=""`. Passed verbatim to every downstream action that runs.
4. **Apply routing rules:**

| Input shape | Action set |
|---|---|
| Numbers only, no keyword | `{ <recommended>: [those numbers] }` — recommended = `task` if `IS_OWN_PR=true` or local mode, else `comment` |
| One action keyword + numbers | `{ <that action>: [those numbers] }` |
| One action keyword, no numbers | `{ <that action>: [all findings] }` |
| Multiple keywords with numbers attached (e.g. `fix 1,2 comment 3,4 skip 5`) | Split into clauses by keyword; each clause routes independently. Duplicate numbers across clauses are kept in the first clause only. |
| Empty / no valid numbers and no keyword | Re-prompt the popup once. On second failure: print `No valid action parsed — aborting.` and stop. |

**Execution order** when both `task` and `comment` are present: run `comment` (Step 5f) first to completion, then `task` (Step 5d/5e). Rationale: PR comments are reversible via the GitHub UI; task dispatch is heavier and async — surface the visible outcome first.

### 5d. Synthesize the task input (runs only when action set contains `task`)

Build a single string (no extra prose):

```
Fix the following review findings:

<for each finding in the `task` subset, copied verbatim from the numbered list above — include severity tag, file:line, and the original summary/details from REVIEW_MARKDOWN>

User notes: <USER_COMMENT if non-empty; otherwise omit this line entirely>
```

### 5e. Dispatch /ai-agents-workflow:task (runs only when action set contains `task`)

Invoke the `/ai-agents-workflow:task` slash command via the `SlashCommand` tool, passing the synthesized string as the argument. The chief-orchestrator's Step 0 classification decides whether the fix runs as `execution-trivial`, `execution-simple`, or `execution-full`.

Do not attempt to bypass classification — even small-looking fixes go through the standard intake popup.

### 5f. Per-finding PR-comments loop (runs only when action set contains `comment`, PR mode only)

If `HEAD_SHA` is empty (fetched failed in 5b-pre), print once: `No HEAD SHA available — all comments will post as top-level PR comments.`

For each finding in the `comment` subset, iterated in numbered order (let `i` be the 1-based index within the subset and `N` the subset size):

1. **Resolve target:**
   - Finding has `file:line` AND `HEAD_SHA` non-empty → inline candidate.
   - Otherwise → top-level fallback.
2. **Draft body** (markdown):

   ```
   **[<severity>]** <summary>

   <details from REVIEW_MARKDOWN, if any>

   _Reviewer note: <USER_COMMENT>_   ← only if USER_COMMENT is non-empty
   ```

3. **Confirm with `AskUserQuestion`** — one question, three canned options + Other:
   - **Question:** "Post comment for finding <i>/<N> (`<file>:<line>` or `general`)?"
   - **Header:** `Comment <i>/<N>`
   - **Option 1:** `Approve & post` — description: "Post the drafted body as-is."
   - **Option 2:** `Edit then post` — description: "Type the replacement body in the Other field below; empty input re-prompts once, then skips."
   - **Option 3:** `Skip` — description: "Don't post this comment, move to the next."
   - Free-text in Other → treated as `Edit then post` with the typed text as the new body.
4. **Post (Approve / Edit only):**
   - **Inline:** `gh api -X POST /repos/<REPO_NWO>/pulls/<PR_NUMBER>/comments -f body=<body> -f commit_id=<HEAD_SHA> -f path=<file> -F line=<line> -f side=RIGHT`
   - **Top-level:** `gh pr comment <PR_NUMBER> --body <body>`
5. **Result line** (always print exactly one line per finding):
   - Success inline: `[<i>/<N>] Posted inline comment → <file>:<line>`
   - Success top-level: `[<i>/<N>] Posted general PR comment`
   - Skip: `[<i>/<N>] Skipped.`
   - Failure: `[<i>/<N>] Failed: <one-line stderr summary> — continuing.` Do **not** abort the loop.
6. **422 fallback** — if inline `gh api` returns 422 (line not in PR diff), automatically retry as a top-level comment for the same finding. On success, print `[<i>/<N>] Line not in diff — posted as general comment instead.` instead of the normal success line.

After the loop, print a single summary line: `PR comments: <posted> posted, <skipped> skipped, <failed> failed.`

## Notes for implementers

- This command runs entirely in the main thread; it does NOT dispatch a chief-orchestrator subagent for the review itself. The only subagent dispatch happens in Step 5e via the chained `/ai-agents-workflow:task` call (when the action set contains `task`).
- No `ai-work.md`, no `<artifact-root>/tasks/<task_id>/` folder, no `<artifact-root>/reviews/`. The `pre-task-guard` hook does not fire because no pipeline subagent is dispatched directly from this command.
- `pr-lessons-check` is read-only and bounded — safe to run before any user confirmation.
- Step 4 still instructs the upstream `code-review:code-review` skill to print findings in chat only — it must NOT post during the review itself. PR comments are posted **only** by Step 5f, which is gated behind explicit per-finding user approval.
- Inline-comment authorship is the `CURRENT_USER` resolved in 5b-pre. If the user lacks write/triage access to the target repo, `gh api` will return 403 — the loop reports the failure on the result line and continues; no special handling needed.
- Step 5b-pre is the only place the command needs the `gh repo view` / `gh pr view` JSON fields above; if any are added later, extend 5b-pre rather than re-fetching inside the loop.

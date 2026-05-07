---
name: pr-lesson-extraction
description: Classify raw PR review comments and extract candidate lessons (rule + why + fix + tags + source). Use after fetching PR comments and before pr-lessons-store appends them.
stage: pr-lessons
---

# PR Lesson Extraction Skill

Turn a stream of PR review comments into structured **lesson candidates** ready for human confirmation and persistence.

## Input

A list of comment records, each with at least:

```json
{
  "id": "<comment id, e.g. discussion_r12345>",
  "author": "<github login>",
  "body": "<comment text>",
  "path": "<file path or null for general PR comments>",
  "line": <int or null>,
  "diff_hunk": "<hunk preceding the comment, or empty>",
  "in_reply_to": "<id or null>",
  "resolved": <bool or null>,
  "html_url": "<deep link to the comment>",
  "pr_url": "<https://github.com/owner/repo/pull/N>"
}
```

Plus the PR metadata: `{owner, repo, number, title, base_ref, head_ref}`.

## Classification

Bucket each comment into ONE of:

- **issue** — points at a real defect, anti-pattern, missed edge case, or accepted change request. Eligible to become a lesson.
- **nit** — style/preference only, no behavior impact. Skip UNLESS the same nit shows up across ≥3 comments in the input (then promote to issue).
- **praise** — positive feedback. Skip.
- **question** — clarifying question with no asserted issue. Skip unless the reply chain reveals an issue (then treat the chain as one issue).
- **wontfix** — issue raised but the thread concluded "not a real problem" / "by design". Skip.

Heuristics:
- Comments with patterns like "should", "must", "avoid", "don't", "consider", "this will break", "bug:", "security:" → likely **issue**.
- Comments with "nit:", "style:", "personal preference", a single emoji reaction, "lgtm" → **nit** or **praise**.
- Threads where a follow-up commit is referenced (`Fixed in <sha>`) → **issue** that was accepted.
- If the PR was merged and a comment was marked unresolved AND the author commented "ignoring", treat as **wontfix**.

## Extraction (per issue comment)

Produce a candidate object:

```json
{
  "rule": "<one line, generalized — NOT the specific code, but the pattern>",
  "why": "<the reviewer's stated reason; if absent, infer from the diff_hunk>",
  "fix": "<concrete remediation if the reviewer or thread provided one; else \"see Source\">",
  "tags": ["<lowercase tags, see axes below>"],
  "source_url": "<comment html_url verbatim — pr-lessons-store stores it as-is>",
  "date": "YYYY-MM-DD"
}
```

### Generalizing the rule
- Strip variable/function names specific to this PR. "rename `userSvc` to `userService`" → "service variables should not use abbreviations".
- Express as an actionable pattern, not a story. "we got bit by X last quarter" → "X must be Y because <reason>".
- One sentence, ≤ 120 chars.

### Inferring tags
Pull from these axes (use what fits, omit what doesn't):
- **language**: `go`, `ts`, `js`, `python`, `rust`, `sql`, ...
- **area**: derived from `path` (`api`, `db`, `auth`, `ui`, `infra`, `tests`, `docs`)
- **topic**: `naming`, `error-handling`, `null-safety`, `concurrency`, `perf`, `security`, `tests`, `logging`, `migration`, `accessibility`

### Thread collapsing
If multiple comments in a reply chain describe the same issue, emit ONE candidate using the root comment's `html_url` as `source_url`. Discard the other comment ids — the root URL is the canonical anchor; the store does not track sub-thread ids.

## Output

Return a JSON array of candidates. The harvester agent will:
1. Show the list to the user (numbered, with classification + rule + source).
2. Let the user keep / edit / drop each.
3. Pass kept candidates to `pr-lessons-store` for append + dedup.

## Rules

- Do NOT invent rules the comments don't support. If a comment is too vague to generalize, skip it (mark internally as `unclear`, exclude from output).
- Do NOT include the original comment text verbatim — the file would balloon. Generalize.
- Do NOT include code snippets longer than ~3 lines. Reference via `source_url` instead.
- Preserve the source link on every candidate so the user can always trace back.
- The skill is read-only — it produces candidates only. Persistence is `pr-lessons-store`'s job.

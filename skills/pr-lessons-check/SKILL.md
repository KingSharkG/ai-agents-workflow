---
name: pr-lessons-check
description: Scan a diff (or staged/unstaged git changes) against <artifact-root>/knowledge/pr-lessons.md and surface likely matches. Use during code review and before git commit / gh pr create.
---

# PR Lessons Check Skill

Consult lessons harvested from past PR reviews and flag any in the current diff that look like repeats of past mistakes. Read-only — never modifies code or the lessons file.

## When to Use

- **Reviewer agent**: invoke during a review pass to compare the under-review diff against stored lessons.
- **Pre-commit / pre-PR**: invoke against `git diff --staged` (commit) or `git diff <base>..HEAD` (PR) to catch repeats before they ship.
- **Ad-hoc**: invoke against any unified diff the caller provides.

## Input

Either:
- A unified diff string, OR
- A diff source spec: `{ "kind": "staged" | "unstaged" | "range", "range": "<base>..<head>" }` — the skill resolves it via `git diff`.

If the lessons file `<artifact-root>/knowledge/pr-lessons.md` is missing or empty, return immediately with `{ "lessons_loaded": 0, "matches": [] }` — never error. Callers that surface the result to a human MUST still print "PR Lessons: 0 loaded" once so the wiring is observable; the skill itself is silent.

## Config

The matcher exposes one tunable: the **score threshold** (default `2`). Override via env var `PR_LESSONS_CHECK_THRESHOLD` (integer ≥ 1). Lower = more matches, more noise. Higher = fewer matches, more silent misses. Start at the default and adjust after observing real diffs.

## Algorithm

1. Load lessons via `pr-lessons-store` read API → list of `{slug, rule, why, fix, tags, sources}`.
2. Load the diff (via input or `git diff` shell-out).
3. For each lesson, compute a **match signal** against the diff:
   - **path match**: lesson tags include an `area`/`language` that fits any changed file's path/extension.
   - **rule keyword match**: distinguishing nouns/verbs from `rule` appearing in added (`+`) lines of the diff. Stopwords excluded.
   - **anti-pattern regex (if expressible)**: if the rule clearly names a forbidden token (e.g. "no `console.log` in prod code"), grep added lines for that token.
4. Score each (lesson × file) pair: `path_match * 1 + keyword_hits * 1 + regex_hit * 3`. Surface pairs with score ≥ threshold (default `2`, override via `PR_LESSONS_CHECK_THRESHOLD`).
5. Return matches sorted by score desc, then by lesson `seen` desc.

## Output

```json
{
  "lessons_loaded": <int>,
  "matches": [
    {
      "slug": "...",
      "rule": "...",
      "why": "...",
      "fix": "...",
      "score": 4,
      "evidence": [
        { "file": "src/foo.ts", "line": 42, "snippet": "console.log(user)", "reason": "regex hit on `console.log`" }
      ],
      "sources": ["https://github.com/.../pull/123#discussion_r..."]
    }
  ]
}
```

## Rendering for Humans

When invoked interactively (reviewer or pre-PR), also emit a markdown summary the caller can show the user:

```markdown
### PR Lessons Check
Loaded **N** lessons. **M** likely matches in this diff.

#### 1. <rule> — _<slug>_
- **Why:** <why>
- **Fix:** <fix>
- **Hit:** `src/foo.ts:42` — `console.log(user)`
- **Source:** [PR #123](https://github.com/.../pull/123#discussion_r...)

<!-- repeat per match; if zero matches, write "No matches against stored PR lessons." -->
```

## Rules

- **No false alarms over silence**: prefer score thresholds that under-match. The user trusts the file more if it doesn't cry wolf.
- **Do not modify the diff or the lessons file.** Read-only skill.
- **Empty file → quiet success.** A repo without harvested lessons must not produce noise.
- **No network calls.** Operates purely on local diff + local lessons file.
- **Idempotent.** Re-running on the same diff produces the same matches.
- When the reviewer agent invokes this, surface the markdown summary inside its review notes; do NOT auto-add findings to `<!-- section:review -->` — let the reviewer decide whether each match is a real issue for this change.

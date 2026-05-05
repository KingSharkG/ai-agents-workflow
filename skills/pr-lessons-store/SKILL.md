---
name: pr-lessons-store
description: Owns the on-disk format of <artifact-root>/knowledge/pr-lessons.md — append, dedup, and merge lessons learned from PR review comments. Use when persisting candidates produced by pr-lesson-extraction.
---

# PR Lessons Store Skill

Single source of truth for the lessons file format. The harvester agent and the check skill both go through this skill — never hand-write or hand-parse the file.

## Output Target

`<artifact-root>/knowledge/pr-lessons.md`

**The caller passes you the absolute artifact-root path** — extracted from the dispatch bundle's `<!-- artifact-root: <abs-path> -->` fact line by the harvester agent, or obtained via `node "${CLAUDE_PLUGIN_ROOT}/hooks/bin/resolve-artifact-root.js"` for direct-CLI use. Treat `<artifact-root>` as that absolute path; **do not re-derive it, do not guess from `<cwd>/.claude/`, and do not fall back to a global location**. If the caller did not pass an absolute path, refuse to write and report the contract violation.

If `<artifact-root>/knowledge/` does not exist, create it before writing. If the file does not exist, create it with the header below.

## File Header

```markdown
<!-- pr-lessons:v1 -->
# PR Lessons

> Lessons harvested from PR review comments. Each `## <slug>` block is one lesson.
> Maintained by `ai-agents-workflow:pr-lessons-store`. Do not hand-edit the structure;
> add new lessons via `/ai-agents-workflow:pr-lessons <PR-ref>`.
```

## Lesson Block Format

Each lesson is a level-2 heading whose text is a **deterministic slug** derived from the rule:

```markdown
## <slug>
- **Rule:** <one-line pattern or anti-pattern>
- **Why:** <reason — incident, reviewer reasoning, principle>
- **Fix:** <how to do it right, or "see Source">
- **Tags:** <comma-separated, lowercase: area, language, topic>
- **Source:** <html_url> [, <html_url> ...]
- **Seen:** <integer count>
- **First seen:** YYYY-MM-DD
- **Last seen:** YYYY-MM-DD
```

### Slug derivation (deterministic — implement EXACTLY)

Given `rule` (string):

1. Lowercase.
2. Replace every run of `[^a-z0-9]+` with a single `-`.
3. Trim leading/trailing `-`.
4. Split on `-` into tokens.
5. Drop tokens in this fixed stopword list: `the, a, an, of, in, on, to, for, and, or, must, should, do, not, is, are, be, this, that, with, as, by, it, its, into, from, we, you`.
6. Drop tokens of length 1.
7. Rejoin with `-`.
8. If the result is longer than 60 chars, truncate at 60 and trim a trailing `-`.
9. If the result is empty (all stopwords), fall back to `lesson-<sha1(rule)[:8]>`.

Two different LLM runs on the same `rule` MUST produce the same slug. No paraphrasing, no synonym substitution, no judgement calls.

### Slug collision (distinct rules, same slug)

After computing the slug for a candidate, before treating an existing block with that slug as a match, run a **rule-similarity gate**:

- Tokenize both rules (same tokenizer as slug derivation, same stopword drop, but no length cap).
- Compute Jaccard similarity over the token sets.
- If similarity ≥ **0.6**, treat as the same lesson → merge.
- If similarity < 0.6, treat as a collision → append `-2` (or next free `-N`) to the candidate's slug and insert a new block.

## Append / Merge Algorithm

Input: list of candidates `[{rule, why, fix, tags, source_url, date}]` (each `source_url` is the verbatim `html_url` from `pr-lesson-extraction` — do NOT reconstruct).

1. **Load** existing file (or initialize with header if missing).
2. **Parse** existing lessons into a map keyed by slug.
3. For each candidate:
   - Compute slug per the deterministic algorithm above.
   - If slug exists in the map AND the rule-similarity gate passes (≥ 0.6) → **merge path**.
   - If slug exists but similarity gate fails → bump to `<slug>-2/-3/...` and take the **insert path**.
   - If slug is new → **insert path**.

   **Merge path:**
   - If `source_url` is already in the existing `Source` list → leave `Seen` unchanged, leave `First seen` / `Last seen` unchanged, but still merge tags + fix.
   - Else → append `source_url` to `Source`, **increment `Seen` by 1**, set `Last seen` to candidate `date`.
   - If candidate `fix` is non-empty AND existing `Fix` is `"see Source"` or empty → replace `Fix`.
   - Union `Tags` (lowercase, dedup, preserve insertion order).
   - Never overwrite `Rule` or `Why` — they are identity fields.

   **Insert path:**
   - New block with `Seen: 1`, `First seen: <date>`, `Last seen: <date>`, `Source: <source_url>`.

4. **Sort** lessons by `Last seen` desc, then by slug asc.
5. **Write atomically**: write to `pr-lessons.md.tmp` in the same dir, then `rename()` over the target. On rename failure, leave the original intact and surface the error.

## Read API (for pr-lessons-check)

When asked to "load all lessons", parse the file into:

```json
[
  {
    "slug": "...",
    "rule": "...",
    "why": "...",
    "fix": "...",
    "tags": ["..."],
    "sources": ["https://github.com/.../pull/123#discussion_r..."],
    "seen": 3,
    "first_seen": "2026-01-04",
    "last_seen": "2026-05-05"
  }
]
```

Missing file → return `[]`. Malformed block → skip with a warning, do not throw.

## Rules

- Never delete lessons. If the user wants to remove one, they edit the file by hand.
- `<!-- pr-lessons:v1 -->` is the schema marker. Future versions bump to `v2` and document migration here.
- Dates are UTC, `YYYY-MM-DD` (no time component).
- Tags are lowercase. Common tag axes: language (`go`, `ts`, `python`), area (`auth`, `db`, `api`, `ui`), topic (`naming`, `error-handling`, `tests`, `perf`, `security`).
- The file is plain markdown — keep it human-readable. No JSON blocks, no HTML beyond the section/schema markers.

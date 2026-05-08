# Dispatch Bundle Protocol

Single canonical statement of how dispatched agents receive context. Every agent stub under `agents/` references this file in one line and adds only role-specific bundle contents above its own `<!-- role-contract:* -->` block.

## What the bundle is

Every Task dispatch from `chief-orchestrator` (or, in side flows, from `init` / `pr-lessons-harvester` / `resume-orchestrator`) embeds an **inline dispatch bundle** in the `prompt` parameter, wrapped in:

```
<!-- dispatch-bundle:start version=N -->
<!-- artifact-root: <absolute-path> -->
... (role contract, project context, governance excerpts, artifact input) ...
<!-- dispatch-bundle:end -->
```

The bundle is composed in memory by the `context-minimizer` skill from PROJECT_CONFIG.md, the cached domain context (`<artifact-root>/config/domain-contexts.cache.md`), per-role canonical contracts, and the relevant artifact slice.

## Hard rules for every dispatched agent

1. **Work from the inline payload directly.** Do NOT independently read canonical contracts, `PROJECT_CONFIG.md`, governance files, or any other project-context file you can see referenced in the bundle. Re-fetching is forbidden — the bundle is authoritative.

2. **Do NOT search for a `roles/<role>.md` file.** None exists in current tasks. The role contract is the `<!-- role-contract:<role> -->` … `<!-- /role-contract:<role> -->` block that `context-minimizer` extracts verbatim from the agent stub and inlines into the bundle.

3. **Extract `<artifact-root>` once at startup.** The very first fact line inside the bundle is `<!-- artifact-root: <absolute-path> -->`. That absolute path replaces every `<artifact-root>/…` placeholder in every skill, contract, and instruction you receive. `<artifact-root>` is a placeholder, never a literal directory name.

4. **Only invoke skills/plugins listed in the bundle's Project Context section.** Anything outside that union is forbidden for the current subtask. Output that doesn't flow back through the `ai-work.md` artifact chain will be rejected by Reviewer.

5. **Bundle delivery format is inline-only.** Bundles are not persisted to disk. The only on-disk record is the one-line audit entry under `<!-- section:dispatch-bundles -->` in `<subtask_id>/summary.md`, written by the orchestrator (not the dispatched agent).

## Per-agent bundle contents

Each agent stub specifies what its own bundle slice contains (e.g., reviewer gets the implementation diff and DoD checklist; design-agent gets the FE baseline and spec). That role-specific list lives in the agent file directly above the role-contract opening marker.

## Authoring constraint

When editing an `agents/<role>.md` file, NEVER touch the `<!-- role-contract:<role> -->` … `<!-- /role-contract:<role> -->` block — it is extracted verbatim and any drift breaks dispatch. Edits to the dispatch-bundle preamble must stay above that opening marker.

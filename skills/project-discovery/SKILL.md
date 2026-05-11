---
name: project-discovery
description: Non-mutating discovery of the consumer repo's ecosystems, frameworks, quality-gate commands, and monorepo shape. Invocation order in the project-config flow → **first**: runs at the start of `/ai-agents-workflow:init` and `/update` (and on `/add` / `/remove` when the mutation needs fresh discovery context) before any of `project-config-template` or `project-config-mutate` proposes changes.
stage: project-config
---

# Project Discovery Skill

Produce an `Evidence` summary for the consumer repo without writing anything. The init agent consumes this summary to classify the repo and map it to the plugin's catalog.

## Output Target

Return the evidence inline to the init agent (no file write). Structure it as the template below so downstream mapping is deterministic.

## Evidence Template

```yaml
cwd: <absolute consumer cwd>
monorepo:
  detected: <true|false>
  markers: [pnpm-workspace.yaml | turbo.json | nx.json | lerna.json | apps+packages | rush.json | none]
  workspaces:
    - path: <relative path>
      ecosystems: [...]
ecosystems:
  - id: node
    confidence: low | medium | high
    files_seen: [package.json, pnpm-lock.yaml, tsconfig.json]
    frameworks: [next, fastify]   # union across FE/BE signals detected in this ecosystem
    signals:
      - "package.json: dependencies.next: ^15.0.0"
      - "package.json: dependencies.fastify: ^4.28.0"
  - id: python
    ...
classification_hint: fe | be | mixed | new-domain
quality_gates:
  test: "pnpm test"
  lint: "pnpm lint"
  typecheck: "pnpm typecheck"
  build: "pnpm build"
# include only what the discovery found. Unknown fields are omitted, not emitted as null.
installed_capabilities:
  mcp_plugins: []            # parsed from the harness's /plugin listing surface
  builtin_prefixes: []       # Claude built-in skill prefixes present in the available-skills list (e.g. superpowers:, pr-review-toolkit:)
  consumer_marketplaces: []  # marketplaces the consumer has added locally; no reliable enumeration API — ask the user via AskUserQuestion in init step 4a
  npx_skills_available: false  # `which npx` returned a path
ambiguities:
  - "two routers detected in the same workspace: next and remix"
```

## Detection Table

| Ecosystem | Files to probe | Framework heuristics (dep names / strings) |
|---|---|---|
| Node / TypeScript | `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `tsconfig.json`, `tsup.config.ts`, `vite.config.*` | next, nuxt, react, vue, svelte, astro, vite, remix, express, fastify, nestjs, hono, koa |
| Python | `pyproject.toml`, `requirements*.txt`, `Pipfile`, `poetry.lock`, `uv.lock`, `setup.cfg`, `setup.py` | django, flask, fastapi, pydantic, sqlalchemy, starlette |
| Go | `go.mod`, `go.sum` | gin, echo, chi, fiber, gorilla |
| Rust | `Cargo.toml`, `Cargo.lock` | actix-web, axum, tokio, leptos, rocket |
| Java / Kotlin | `pom.xml`, `build.gradle`, `build.gradle.kts`, `settings.gradle*` | spring-boot, micronaut, quarkus, ktor |
| Ruby | `Gemfile`, `Gemfile.lock`, `config.ru`, `bin/rails` | rails, sinatra, hanami |
| PHP | `composer.json`, `composer.lock`, `artisan`, `symfony.lock` | laravel/framework, symfony/* |
| .NET | `*.csproj`, `*.sln`, `global.json`, `Directory.Packages.props` | Microsoft.AspNetCore.*, NUnit, xUnit |
| iOS / Swift | `Package.swift`, `*.xcodeproj`, `*.xcworkspace`, `Podfile` | SwiftUI, UIKit, Vapor |
| Android | `build.gradle*` containing `com.android.application`, `AndroidManifest.xml`, `gradle/libs.versions.toml` | jetpack-compose, kotlinx.coroutines |
| Monorepo markers | `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, `rush.json`, `apps/` + `packages/` | recurse per workspace |
| Infra / CI | `Dockerfile`, `docker-compose*.yml`, `terraform/`, `k8s/`, `.github/workflows/`, `.gitlab-ci.yml`, `CODEOWNERS` | emit `signals` only; no framework inference |
| Quality-gate signals | `package.json` → `scripts.test`, `scripts.lint`, `scripts.typecheck`, `scripts.build`; `Makefile` targets; `.github/workflows/*.yml` run steps; `pytest.ini`, `tox.ini`, `ruff.toml`, `.eslintrc*`, `biome.json`, `rubocop.yml` | extract commands verbatim for `<!-- section:quality-gates -->` |
| Installed capabilities | harness `/plugin` listing (for `mcp_plugins`); available-skills listing (for `builtin_prefixes`); `which npx` (for `npx_skills_available`) | populate `installed_capabilities`; never read `<artifact-root>/` |

## Classification Rule

- FE-framework hits only ⇒ `fe`.
- BE-framework hits only ⇒ `be`.
- Both FE and BE framework hits (same workspace or across workspaces) ⇒ `mixed`.
- No framework hits (infra / CI / docs / scripts only) ⇒ `new-domain`. This forces a clarifying question and invites the user to name the domain.

## Rules

- **Non-mutating.** Never write during discovery. Reading is allowed anywhere in the consumer CWD.
- **Bounded depth.** Read only the files listed in the detection table. Do not open arbitrary source files.
- **Evidence cap.** Emit at most 10 `signals` per ecosystem. Prefer high-signal lines (dependency with a pinned version) over low-signal ones (devDependency without a version).
- **Confidence levels.** `high` = ≥3 corroborating files; `medium` = 2; `low` = 1. A single file match for an ecosystem is low confidence — flag as ambiguous if it's the only hit.
- **Missing evidence is evidence.** If no ecosystem hits, record `classification_hint: new-domain` and return — do not fabricate.
- **Monorepo short-circuit.** If a monorepo marker is found, recurse into each workspace once and compose per-workspace evidence before rolling up a top-level classification_hint.
- **Never read `<artifact-root>/` during discovery** — that's the output surface, not input. Concretely, when walking the consumer repo skip both `./.claude/aiaw-data-*/` (in-project layout) and `../aiaw-data-*/` (sibling layout). Discovery walks `.claude/` for settings and config evidence, so the artifact subdirectory must be excluded explicitly to avoid pulling pipeline outputs back in as project evidence.

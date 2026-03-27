# Supabase Splitter PRD (MVP)

## Overview
Build a public SDK and CLI in a separate repo that productizes the existing splitter workflows currently implemented in:
- `/Users/kai/Development/courseRater/supabase/schemas/schema-splitter.js`
- `/Users/kai/Development/courseRater/supabase/seeds/seed-splitter.js`

## Problem
Teams need:
1. Reliable local seeding from large SQL dumps for `supabase db reset`.
2. A practical path from migration-heavy workflows to declarative schema workflows.

Current scripts solve this in one repo but are not portable, versioned, or publishable.

## Why This Tool Exists

Beyond portability, splitting dump artifacts into ordered, focused files provides operational advantages:

1. Transparency: schema/data are inspectable in small logical units instead of one opaque monolithic dump.
2. Granular local control: teams can quickly locate and adjust specific schema/data sections during testing.
3. Faster debugging: when `supabase db reset` fails, it is easier to pinpoint the failing area by file/category.
4. Maintainability: diff/review quality improves with stable, deterministic file boundaries.
5. Backup and recovery ergonomics: organized split outputs support safer backup strategies and targeted restores.

## Goals
1. Extract current splitter capabilities into a reusable CLI.
2. Validate SDK works in `/Users/kai/Development/courseRater` before public publish.
3. Publish v0.1.0 publicly on npm.

## Non-Goals (MVP)
1. Replace Supabase CLI.
2. Build end-to-end migration conflict resolution (enum/RLS drift auto-fixes).
3. Full remote sync orchestrator with destructive operations.
4. Replace or auto-manage migration-driven `db reset` behavior.

## Target Users
1. Supabase teams with large seed files.
2. Teams transitioning toward declarative schema management.

## MVP Scope
Commands:
1. `schema split`
2. `schema reconstruct`
3. `schema validate`
4. `data split`
5. `data reconstruct`
6. `data validate`
7. `schema` (no subcommand) runs `split -> reconstruct -> validate`
8. `data` (no subcommand) runs `split -> reconstruct -> validate`

Required behavior:
1. Configurable input/output paths.
2. Deterministic output.
3. Compatible with `db.seed.sql_paths` patterns like `./seeds/split/*.sql`.
4. Splitter commands operate on existing input SQL files only (no implicit remote pull/dump).
5. Split commands fail fast when destination is non-empty, unless `--backup` is provided.
6. Schema split outputs target declarative schema workflows; migration flow remains separate unless `db.migrations.schema_paths` is explicitly configured.
7. Splitting thresholds and table/file rules must be configurable (not hard-coded business rules).
8. Documentation must include a repository hygiene rule for large unsplit source files (for example `supabase/seeds/prod-data.sql`) to avoid GitHub size-limit failures.

Input generation responsibility (outside splitter CLI):
- `supabase db dump > supabase/schemas/prod-schemas.sql`
- `supabase db dump --data-only > supabase/seeds/prod-data.sql`

## Success Metrics
1. SDK can run against `/Users/kai/Development/courseRater` with parity to current scripts.
2. `supabase db reset` succeeds using generated seed output.
3. At least one public npm release consumed from a clean install.

## Acceptance Criteria
1. Schema split/reconstruct roundtrip preserves SQL fidelity.
2. Data split generates ordered SQL files usable by Supabase seed loader.
3. Integration test in `/Users/kai/Development/courseRater` passes:
- install packed tarball
- run schema commands
- run data command
- run `supabase db reset`

## Technical Approach
1. Separate repo with CLI entrypoint (`bin`).
2. Modular command handlers (`schema`, `data`).
3. Shared utility layer for common filesystem behaviors (dirty destination detection, backup-rename workflow, timestamp naming, common file helpers) used by both schema and data commands.
4. Keep schema/data parsing and reconstruction logic domain-specific, while reusing common utilities.
5. Config support via file + CLI flags (CLI overrides file values).
6. npm packaging (`files`, build artifacts, semver).

Implementation note:
- MVP implementation uses TypeScript + Commander.js for command parsing, with custom terminal UI helpers.
- CLI surface remains command-compatible with the validated legacy behavior (`init`, `schema`, `data` and step modes).

## Config Model (MVP+)

Add a project config file (example: `supabase-splitter.config.json`) with optional keys:

- `schema.input` (default input file)
- `schema.output` (default output root)
- `schema.reconstructed` (default reconstructed schema file)
- `schema.keepFiles` (files to preserve across split + backup)
- `data.input` (default input file)
- `data.output` (default output dir)
- `data.reconstructed` (default reconstructed data file)
- `data.maxLinesPerFile`
- `data.maxStatementsPerFile`
- `data.maxRowsPerInsert`
- `data.tableRules` (per-table overrides, including skip/include behavior)
- `data.keepFiles` (files to preserve across split operations)
- `data.ignoreInReconstruct` (files excluded from reconstruction/verification)

Notes:
- `keepFiles` should support cases like `800_refresh_materialized_view.sql`.
- Reconstruction/verification must ignore configured non-split operational files so validation stays stable.
- Defaults should mirror current behavior, but all business-specific exceptions (e.g., specific table names) must be expressible by config rather than hard-coded logic.
- Recommend `.gitignore` entries for large generated/unsplit artifacts (for example: `supabase/schemas/prod-schemas.sql`, `supabase/seeds/prod-data.sql`, `supabase/seeds/reconstructed-data.sql`).
- Optional CLI cleanup behavior may be provided (e.g., `--cleanup-input-after-verify`), but it must be explicit opt-in and only run after successful validation.

## Risks
1. SQL parsing edge cases in complex functions/comments.
2. Output parity regressions vs current repo scripts.
3. Supabase CLI or behavior changes.

Mitigation:
1. Snapshot tests with real fixture SQL from this repo.
2. Integration gate in this repo before every release.

## Milestones
1. M1: Command spec + repo scaffold.
2. M2: Implement `data split` and `schema split`.
3. M3: Implement `schema reconstruct` + `schema validate`.
4. M4: Implement `data reconstruct` + `data validate`.
5. M5: Integration in `/Users/kai/Development/courseRater` via tarball.
6. M6: npm publish 0.1.0.

## Release Plan
1. Internal validation via `npm pack` and local install.
2. Public npm publish (`--access public`).
3. Post-publish smoke test from npm install in `/Users/kai/Development/courseRater`.

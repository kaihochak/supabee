# Supabee

[![CI](https://github.com/kaihochak/supabee/actions/workflows/ci.yml/badge.svg)](https://github.com/kaihochak/supabee/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/supabee)](https://www.npmjs.com/package/supabee)
[![license](https://img.shields.io/npm/l/supabee)](./LICENSE)

Orchestrate post-seed migrations safely and split schema/data SQL into organized files.

## Why?

When your local reset/start flow has both pre-seed and post-seed migrations, migration ordering can diverge from production behavior. `supabee` helps you defer and re-apply post-seed migrations safely, and it also makes large SQL dumps manageable by splitting them into focused files.

Splitting helps with:

- **Review changes** in pull requests (one giant diff vs. focused per-table diffs)
- **Navigate** your database structure (finding a specific table in 5000 lines vs. opening a file)
- **Seed selectively** (load only what you need instead of everything)
- **Resolve merge conflicts** (conflicts in small files vs. one massive file)

`supabee` focuses on post-seed-safe orchestration (`db reset` / `start`) plus schema/data splitting workflows.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) installed and authenticated

## Install

```bash
npm install --save-dev supabee
```

## Setup

### 1. Initialize config

Run `init` to generate `supabee.config.json` (if it doesn't exist) and update `supabase/config.toml` seed paths:

```bash
npx supabee init
```

Review the generated `supabee.config.json` and adjust paths/limits for your project.

### 2. Link your Supabase project

If you haven't already, link your local repo to your Supabase project. This is required before you can dump schema or data:

```bash
supabase link
```

You'll be prompted for your project ref and database password. See the [Supabase CLI docs](https://supabase.com/docs/reference/cli/supabase-link) for details.

### 3. Run the primary workflows

```bash
supabee sync schema
supabee sync data
supabee db reset [cutoff_timestamp]
supabee start [cutoff_timestamp]
```

`sync` commands run end-to-end:

- schema: `supabase db dump` -> split -> reconstruct -> validate
- data: `supabase db dump --data-only` -> split -> reconstruct -> validate

## Commands

### `init`

Creates `supabee.config.json` if missing, then updates `supabase/config.toml` `[db.seed].sql_paths` so Supabase knows where to find your split seed files.

```bash
supabee init
```

### `schema`

Processes an existing schema dump into categorized folders:

```
supabase/schemas/split/
├── 00_extensions/
├── 01_setup/
├── 02_types/
├── 03_functions/
├── 04_tables/
├── 05_views/
├── 06_constraints/
├── 07_indexes/
├── 08_foreign_keys/
├── 09_rls/
├── 10_permissions/
├── 11_ownership/
└── 12_others/
```

```bash
# Full chain (split → reconstruct → validate)
supabee schema

# Individual steps
supabee schema split
supabee schema reconstruct
supabee schema validate
```

### `data`

Processes an existing data dump into per-table files with configurable row/statement limits:

```bash
# Full chain (split → reconstruct → validate)
supabee data

# Individual steps
supabee data split
supabee data reconstruct
supabee data validate
```

### `sync schema`

Dumps schema from the linked Supabase project, then runs full schema processing:

```bash
supabee sync schema
supabee sync schema --input supabase/schemas/prod-schemas.sql --output supabase/schemas/split
supabee sync schema --backup
```

### `sync data`

Dumps data (`--data-only`) from the linked Supabase project, then runs full data processing:

```bash
supabee sync data
supabee sync data --input supabase/seeds/prod-data.sql --output supabase/seeds/split
supabee sync data --backup
supabee sync data --no-backup
```

### `db reset`

Defers post-seed migrations newer than the cutoff timestamp, runs `supabase db reset`, restores deferred migrations, then reapplies them.

If `[cutoff_timestamp]` is omitted, `supabee` auto-detects it from `supabase migration list --linked` by taking the latest aligned local/remote migration version.
This requires `supabase link` to be configured.

```bash
# default re-apply mode: supabase migration up
supabee db reset 20260309180959
supabee db reset

# optional re-apply mode: psql
supabee db reset 20260309180959 --psql
```

### `start`

Defers post-seed migrations newer than the cutoff timestamp, runs `supabase start`, restores deferred migrations, then reapplies them.

If `[cutoff_timestamp]` is omitted, `supabee` auto-detects it from `supabase migration list --linked` the same way as `db reset`.

```bash
# explicit cutoff
supabee start 20260309180959

# auto cutoff from linked migration alignment
supabee start

# optional re-apply mode: psql
supabee start --psql
```

### Overriding paths

`schema`, `data`, and `sync` commands accept `--input` and `--output` flags:

```bash
supabee schema split --input path/to/schema.sql --output path/to/split
supabee schema split --input path/to/schema.sql --output path/to/split --backup
supabee data split --input path/to/data.sql --output path/to/split
supabee data split --input path/to/data.sql --output path/to/split --no-backup
```

By default, split operations replace existing output in-place (while preserving configured `keepFiles`) without creating a backup folder.
Use `--backup` to keep a timestamped backup before replacement.

## Configuration

`supabee` reads `supabee.config.json` from your project root.

**Precedence:** CLI flags > config file > built-in defaults.

If the config file is missing, built-in defaults are used. Run `supabee init` to generate one.

Legacy support: `supabase-splitter.config.json` is still recognized, but `supabee.config.json` is preferred.

### Full config reference

```json
{
  "schema": {
    "input": "supabase/schemas/prod-schemas.sql",
    "output": "supabase/schemas/split",
    "reconstructed": "supabase/schemas/reconstructed-schemas.sql",
    "backup": false,
    "keepFiles": []
  },
  "data": {
    "input": "supabase/seeds/prod-data.sql",
    "output": "supabase/seeds/split",
    "reconstructed": "supabase/seeds/reconstructed-data.sql",
    "backup": false,
    "maxLinesPerFile": 2000,
    "maxStatementsPerFile": 20,
    "maxRowsPerInsert": 200,
    "tableRules": {},
    "keepFiles": [],
    "ignoreInReconstruct": []
  },
  "init": {
    "seedSqlPaths": ["./seeds/split/*.sql"]
  }
}
```

| Key | Description |
|-----|-------------|
| `schema.input` | Path to your schema dump file |
| `schema.output` | Directory for split schema files |
| `schema.reconstructed` | Path for the reconstructed schema (used in validation) |
| `schema.backup` | Whether split should create backup folder before replacing output (default: `false`) |
| `schema.keepFiles` | Files in the split dir to preserve across re-splits |
| `data.input` | Path to your data dump file |
| `data.output` | Directory for split data files |
| `data.reconstructed` | Path for the reconstructed data (used in validation) |
| `data.backup` | Whether split should create backup folder before replacing output (default: `false`) |
| `data.maxLinesPerFile` | Max lines per split file (default: 2000) |
| `data.maxStatementsPerFile` | Max INSERT statements per file (default: 20) |
| `data.maxRowsPerInsert` | Max rows per INSERT statement (default: 200) |
| `data.tableRules` | Per-table overrides (see below) |
| `data.keepFiles` | Files in the split dir to preserve across re-splits |
| `data.ignoreInReconstruct` | Files to skip during reconstruction |
| `init.seedSqlPaths` | Paths written to `supabase/config.toml` `[db.seed].sql_paths` |

### Table-specific rules

Override limits or skip specific tables:

```json
{
  "data": {
    "tableRules": {
      "public.cities": {
        "maxLinesPerFile": 800,
        "maxStatementsPerFile": 8,
        "maxRowsPerInsert": 80
      },
      "public.audit_logs": {
        "skip": true
      }
    }
  }
}
```

## Flags

`schema`, `data`, `sync schema`, and `sync data` support:

- `--input`: source SQL file
- `--output`: output path (split dir for `split`, reconstructed file for `reconstruct`/`validate`)
- `--backup`: create backup of dirty split directory before running split
- `--no-backup`: disable backup of dirty split directory before running split

For `validate`, you can pass reconstructed path either as `--output <path>` or as the second positional argument.

`db reset` supports:

- `--psql`: apply deferred migrations via `psql` instead of `supabase migration up`
- `--migrations-dir <path>`: override migrations directory (default `supabase/migrations`)
- `--temp-dir <path>`: override temporary defer directory (default `supabase/.tmp-migrations`)

`start` supports:

- `--psql`: apply deferred migrations via `psql` instead of `supabase migration up`
- `--migrations-dir <path>`: override migrations directory (default `supabase/migrations`)
- `--temp-dir <path>`: override temporary defer directory (default `supabase/.tmp-migrations`)

## Why `supabee db reset` and `supabee start`

These commands matter most when local replay order diverges from how production data actually evolved:

1. Seed files may be shaped for pre-migration schema.
2. Some migrations intentionally mutate/seed production data for traceability (for example RBAC rows).
3. Local `migrations -> seed` replay can fail even when production worked on already-populated data.

By deferring post-seed migrations and applying them after seed load, `supabee` better matches this production-style path.

## Migration + Seed Duplication Caveat

If the same logical data mutation exists in both migration SQL and seed files, local replay can become order-dependent and brittle.

Typical symptoms:
- enum/value already exists errors,
- duplicate key or constraint violations,
- reset/start-only failures that don’t appear on incremental production deploys.

Recommended approach:

1. Keep schema structure changes in migrations.
2. Keep baseline/reference seed rows in seed files.
3. Make migration-time data mutations idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, guarded updates).
4. Avoid duplicating the exact same inserts/enum mutations in both seeds and migrations unless both paths are explicitly idempotent.

## Help

```bash
supabee --help
supabee init --help
supabee sync --help
supabee sync schema --help
supabee sync data --help
supabee schema --help
supabee data --help
supabee start --help
supabee db --help
supabee db reset --help
```

Legacy CLI alias is still available: `supabase-splitter --help`.

## Development

```bash
npm install
npm run typecheck
npm run build
npm run test
npm run pack:check
```

RC gate checklist: `docs/rc-checklist.md`

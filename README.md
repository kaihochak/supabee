# Supabee

[![CI](https://github.com/kaihochak/supabee/actions/workflows/ci.yml/badge.svg)](https://github.com/kaihochak/supabee/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/supabee)](https://www.npmjs.com/package/supabee)
[![license](https://img.shields.io/npm/l/supabee)](./LICENSE)

Orchestrate local Supabase schema/data workflows: split giant SQL dumps into organized files, and apply post-seed migrations in a production-like order.

## Why?

Supabase workflows often end up with two pain points:

1. **One huge dump file** (`supabase db dump` / `--data-only`) that's painful to review, edit, or selectively seed from.
2. **Local reset/start ordering** (migrations → seeds) that can diverge from production deploys (new migrations applied onto an already-populated database).

`supabee` addresses both:

- **Split + validate dumps:** split schema and data dumps into focused files (by category / by table), then reconstruct and validate round-trip (PR-friendly diffs, easier navigation, and smaller merge conflicts).
- **Defer post-seed migrations:** temporarily move newer migrations out of the way for `supabase db reset` / `supabase start`, then restore + reapply them after seeds load.

### Use cases

- **Seed data you can control:** keep per-table seed files and point `[db.seed].sql_paths` at only the ones you want.
- **Schema as docs / source of truth:** keep schema readable in-repo (tables, functions, RLS, permissions, etc.).
- **Mimic production locally:** catch “works on reset” vs “works on deploy” issues by applying post-seed migrations after data exists.
- **One-liners with validation:** `sync schema` / `sync data` run dump → split → reconstruct → validate.

### Repo hygiene (recommended)

Commit split outputs (for example `supabase/schemas/split/**` and `supabase/seeds/split/**`), and ignore large generated artifacts in your repo:

```gitignore
# raw dumps (generated from prod; optional to keep locally)
supabase/schemas/prod-schemas.sql
supabase/seeds/prod-data.sql

# reconstructed outputs (validation artifacts)
supabase/schemas/reconstructed-schemas.sql
supabase/seeds/reconstructed-data.sql
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) installed and authenticated

## Install

Global install (recommended):

```bash
npm i -g supabee
pnpm add -g supabee
bun add -g supabee
```

One-off run without global install:

```bash
npx supabee --help
pnpm dlx supabee --help
bunx supabee --help
```

Project-local install (optional):

```bash
npm install --save-dev supabee
```

## Setup

### 1. Initialize config

Run `init` to generate `supabee.config.json` (if it doesn't exist) and update `supabase/config.toml` seed paths:

```bash
supabee init
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

### Selective seeding example (optional)

By default, `supabee init` configures `supabase/config.toml` to load all split seed files (for example `./seeds/split/*.sql`).
To seed only a subset, replace `[db.seed].sql_paths` with an explicit ordered list (keep `001_setup.sql` and `999_cleanup.sql`; add the generated `*_sequences.sql` file if you need sequence values):

```toml
[db.seed]
sql_paths = [
  "./seeds/split/001_setup.sql",
  "./seeds/split/002_public_users.sql",
  "./seeds/split/003_public_projects.sql",
  "./seeds/split/999_cleanup.sql",
]
```

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
supabee sync schema --force
```

### `sync data`

Dumps data (`--data-only`) from the linked Supabase project, then runs full data processing:

```bash
supabee sync data
supabee sync data --input supabase/seeds/prod-data.sql --output supabase/seeds/split
supabee sync data --backup
supabee sync data --no-backup
supabee sync data --force
```

### `db reset`

Defers post-seed migrations newer than the cutoff timestamp, runs `supabase db reset`, restores deferred migrations, then reapplies them.
For historical data migrations at or before cutoff, `supabee` executes a temporary no-op stub during reset, then restores original SQL.
Classification is automatic by SQL patterns (`INSERT/UPDATE/DELETE/...` vs `CREATE/ALTER/DROP ...`), and optional markers can override classification.
Mixed schema+DML migrations are blocked when they are after cutoff and must be split.
Mixed migrations at/before cutoff run in compatibility mode by default (warning only). Use `--strict-mixed` to fail on any mixed migration.
When post-cutoff mixed files are detected, `supabee` can prompt to auto-split them inline during `db reset`/`start`.
Before applying, `supabee` prints a full before/after migration filename rewrite plan and asks for confirmation.
Auto-split is blocked if a mixed migration version is already applied on the linked remote project.

If `[cutoff_timestamp]` is omitted, `supabee` auto-detects it from `supabase migration list --linked` by taking the latest migration version that exists in both local and remote (works even when remote has gaps).
When linked lookup succeeds, `supabee` stores the value in `supabee.config.json` as `postSeedCutoff` (or `postSeedCutoffByEnv.<env>` when `--env` is set).
If linked lookup fails (for example in CI), it falls back to `postSeedCutoffByEnv.<env>` when `--env` is set, otherwise `postSeedCutoff`.
If not linked, `supabee` runs `supabase link` and retries once.

```bash
# default re-apply mode: supabase migration up
supabee db reset 20260309180959
supabee db reset
supabee db reset --env staging

# optional re-apply mode: psql
supabee db reset 20260309180959 --psql

# strict mixed policy
supabee db reset --strict-mixed
```

### `start`

Defers post-seed migrations newer than the cutoff timestamp, runs `supabase start`, restores deferred migrations, then reapplies them.
For historical data-migration files, `supabee` temporarily swaps the file body to a no-op during the run, then restores the original SQL file content.
When post-cutoff mixed files are detected, `supabee` can prompt to auto-split them inline before continuing.

If `[cutoff_timestamp]` is omitted, `supabee` auto-detects it from `supabase migration list --linked` the same way as `db reset`.

```bash
# explicit cutoff
supabee start 20260309180959

# auto cutoff from linked migration alignment
supabee start

# optional re-apply mode: psql
supabee start --psql
supabee start --env production

# strict mixed policy
supabee start --strict-mixed
```

### `cutoff detect`

Resolves cutoff from argument, linked migration alignment, or config fallback.

```bash
supabee cutoff detect
supabee cutoff detect --env staging
supabee cutoff detect 20260309180959 --json
```

### `migration audit`

Classifies migration files as `data`, `schema`, `mixed`, or `unknown`, and shows recommended marker actions.

```bash
supabee migration audit
supabee migration audit --migrations-dir supabase/migrations
supabee migration audit --verbose
supabee migration audit --json
supabee migration audit --json --verbose
```

### `migration mark`

Adds suggested marker comments by default with interactive confirmation prompts.

```bash
# default: interactive apply
supabee migration mark

# preview only (no writes)
supabee migration mark --dry-run

# non-interactive apply (CI/scripts)
supabee migration mark --yes
```

### `migration unmark`

Removes marker comments with the same interaction model as `mark`.

```bash
# default: interactive remove
supabee migration unmark

# preview only (no writes)
supabee migration unmark --dry-run

# non-interactive remove
supabee migration unmark --yes
```

### Supabase passthrough

Unknown commands are forwarded to Supabase CLI:

```bash
supabee migration up   # forwards to: supabase migration up
supabee db dump        # forwards to: supabase db dump
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
  "postSeedCutoff": "",
  "postSeedCutoffByEnv": {
    "staging": "",
    "production": ""
  },
  "dataMigrationMarker": "supabee:data-migration",
  "schemaMigrationMarker": "supabee:schema-migration",
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
| `postSeedCutoff` | Fallback cutoff timestamp used by `db reset`/`start` when linked lookup is unavailable (for example in CI) |
| `postSeedCutoffByEnv` | Optional per-environment fallback cutoff map (for example `staging`, `production`) |
| `dataMigrationMarker` | Optional override marker for data migrations (default: `supabee:data-migration`) |
| `schemaMigrationMarker` | Optional override marker for schema migrations (default: `supabee:schema-migration`) |

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
- `--force` (sync commands only): skip linked migration alignment preflight

For `validate`, you can pass reconstructed path either as `--output <path>` or as the second positional argument.

`db reset` supports:

- `--psql`: apply deferred migrations via `psql` instead of `supabase migration up`
- `--strict-mixed`: fail when any mixed schema+DML migration is detected (default behavior only fails when mixed migrations are after cutoff)
- `--migrations-dir <path>`: override migrations directory (default `supabase/migrations`)
- `--temp-dir <path>`: override temporary defer directory (default `supabase/.tmp-migrations`)
- `--env <name>`: use `postSeedCutoffByEnv.<name>` as fallback cutoff source

`start` supports:

- `--psql`: apply deferred migrations via `psql` instead of `supabase migration up`
- `--strict-mixed`: fail when any mixed schema+DML migration is detected (default behavior only fails when mixed migrations are after cutoff)
- `--migrations-dir <path>`: override migrations directory (default `supabase/migrations`)
- `--temp-dir <path>`: override temporary defer directory (default `supabase/.tmp-migrations`)
- `--env <name>`: use `postSeedCutoffByEnv.<name>` as fallback cutoff source

`cutoff detect` supports:

- `--env <name>`: include environment fallback lookup
- `--json`: print machine-readable output

## Deep dive: why `supabee db reset` and `supabee start`

The short version is in the **Why?** section above. These commands matter most when local replay order diverges from how production data actually evolved:

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
3. Put data mutations in dedicated migration files; `supabee` auto-detects these by SQL patterns.
4. Use `supabee migration audit` to review classification and `supabee migration mark` if you want explicit marker comments in files.
5. Keep data migrations free of schema DDL (`CREATE`/`ALTER`/`DROP ...`); mixed files are blocked and must be split.
6. Make migration-time data mutations idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, guarded updates).

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
supabee cutoff detect --help
supabee migration audit --help
supabee migration mark --help
supabee migration unmark --help
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

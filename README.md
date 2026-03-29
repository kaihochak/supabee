# Supabase Splitter

Split large Supabase schema and data dump files into smaller, organized, version-control-friendly SQL files.

## Why?

When you run `supabase db dump`, you get a single monolithic SQL file that can be thousands of lines long. This makes it hard to:

- **Review changes** in pull requests (one giant diff vs. focused per-table diffs)
- **Navigate** your database structure (finding a specific table in 5000 lines vs. opening a file)
- **Seed selectively** (load only what you need instead of everything)
- **Resolve merge conflicts** (conflicts in small files vs. one massive file)

`supabase-splitter` takes those dump files and splits them into categorized, ordered files that reconstruct back to the original — verified by built-in validation.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) installed and authenticated

## Install

```bash
npm install --save-dev supabase-splitter
```

## Setup

### 1. Initialize config

Run `init` to generate `supabase-splitter.config.json` (if it doesn't exist) and update `supabase/config.toml` seed paths:

```bash
npx supabase-splitter init
```

Review the generated `supabase-splitter.config.json` and adjust paths/limits for your project.

### 2. Link your Supabase project

If you haven't already, link your local repo to your Supabase project. This is required before you can dump schema or data:

```bash
supabase link
```

You'll be prompted for your project ref and database password. See the [Supabase CLI docs](https://supabase.com/docs/reference/cli/supabase-link) for details.

### 3. Dump schema and data

```bash
supabase db dump > supabase/schemas/prod-schemas.sql
supabase db dump --data-only > supabase/seeds/prod-data.sql
```

### 4. Split, reconstruct, and validate

```bash
npx supabase-splitter schema
npx supabase-splitter data
```

Each command runs the full chain: **split** → **reconstruct** → **validate**.

## Commands

### `init`

Creates `supabase-splitter.config.json` if missing, then updates `supabase/config.toml` `[db.seed].sql_paths` so Supabase knows where to find your split seed files.

```bash
npx supabase-splitter init
```

### `schema`

Splits a schema dump into categorized folders:

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
npx supabase-splitter schema

# Individual steps
npx supabase-splitter schema split
npx supabase-splitter schema reconstruct
npx supabase-splitter schema validate
```

### `data`

Splits a data dump into per-table files with configurable row/statement limits:

```bash
# Full chain (split → reconstruct → validate)
npx supabase-splitter data

# Individual steps
npx supabase-splitter data split
npx supabase-splitter data reconstruct
npx supabase-splitter data validate
```

### Overriding paths

All commands accept `--input` and `--output` flags:

```bash
npx supabase-splitter schema split --input path/to/schema.sql --output path/to/split
npx supabase-splitter data split --input path/to/data.sql --output path/to/split --backup
```

Use `--backup` to save the existing split directory before overwriting.

## Configuration

`supabase-splitter` reads `supabase-splitter.config.json` from your project root.

**Precedence:** CLI flags > config file > built-in defaults.

If the config file is missing, built-in defaults are used. Run `npx supabase-splitter init` to generate one.

### Full config reference

```json
{
  "schema": {
    "input": "supabase/schemas/prod-schemas.sql",
    "output": "supabase/schemas/split",
    "reconstructed": "supabase/schemas/reconstructed-schemas.sql",
    "keepFiles": []
  },
  "data": {
    "input": "supabase/seeds/prod-data.sql",
    "output": "supabase/seeds/split",
    "reconstructed": "supabase/seeds/reconstructed-data.sql",
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
| `schema.keepFiles` | Files in the split dir to preserve across re-splits (restored from backup) |
| `data.input` | Path to your data dump file |
| `data.output` | Directory for split data files |
| `data.reconstructed` | Path for the reconstructed data (used in validation) |
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

## Help

```bash
npx supabase-splitter --help
npx supabase-splitter init --help
npx supabase-splitter schema --help
npx supabase-splitter data --help
```

## Development

```bash
npm install
npm run build
npm run typecheck
npm run test
npm run pack:check
```

# Supabase Splitter

CLI for splitting Supabase schema/data dumps into ordered files.

Tech stack:
- TypeScript
- Commander.js (CLI parser/framework)

## Quick Start

```bash
# Update supabase/config.toml based on supabase-splitter.config.json
supabase-splitter init

# Dump production schema and data
supabase db dump > supabase/schemas/prod-schemas.sql
supabase db dump --data-only > supabase/seeds/prod-data.sql

# Run full chain for each command (`split -> reconstruct -> validate`)
supabase-splitter schema
supabase-splitter data
```

## Help

```bash
supabase-splitter --help
supabase-splitter init --help
supabase-splitter schema --help
supabase-splitter data --help
```

## Init Command

`init` updates `supabase/config.toml` `[db.seed].sql_paths` using `init.seedSqlPaths` from `supabase-splitter.config.json`.

It does **not** create `supabase-splitter.config.json`.

```bash
supabase-splitter init
```

## Schema Command

```bash
supabase-splitter schema
```

Default behavior: runs `split -> reconstruct -> validate` for schema.

Run a single step:

```bash
supabase-splitter schema split
supabase-splitter schema reconstruct
supabase-splitter schema validate
```

Override paths:

```bash
supabase-splitter schema split --input new-path/schemas/prod-schemas.sql --output new-path/schemas/split
supabase-splitter schema reconstruct --input new-path/schemas/split --output new-path/schemas/reconstructed-schemas.sql
supabase-splitter schema validate --input new-path/schemas/prod-schemas.sql new-path/schemas/reconstructed-schemas.sql
```

Backup dirty split directory before split:

```bash
supabase-splitter schema split --backup
```

`schema.keepFiles` files are restored from backup into the new split directory.

## Data Command

```bash
supabase-splitter data
```

Default behavior: runs `split -> reconstruct -> validate` for data.

Run a single step:

```bash
supabase-splitter data split
supabase-splitter data reconstruct
supabase-splitter data validate
```

Override paths:

```bash
supabase-splitter data split --input new-path/seeds/prod-data.sql --output new-path/seeds/split
supabase-splitter data reconstruct --input new-path/seeds/split --output new-path/seeds/reconstructed-data.sql
supabase-splitter data validate --input new-path/seeds/prod-data.sql new-path/seeds/reconstructed-data.sql
```

Backup dirty split directory before split:

```bash
supabase-splitter data split --backup
```

`data.keepFiles` files are restored from backup into the new split directory.

## Config

`supabase-splitter` reads `supabase-splitter.config.json` from repo root.

If this file is missing, built-in defaults are used.

`init` reads this file; it does not generate it.

Precedence: CLI args > config file > built-in defaults.

Start from the example file:

```bash
cp supabase-splitter.config.example.json supabase-splitter.config.json
```

## Development

```bash
npm install
npm run typecheck
npm run build
npm run test
npm run pack:check
```

RC gate checklist: `docs/rc-checklist.md`

## Flags

Both `schema` and `data` support:

- `--input`: source SQL file
- `--output`: output path (split dir for `split`, reconstructed file for `reconstruct`/`validate`)
- `--backup`: backup dirty split directory before running split

For `validate`, you can pass reconstructed path either as `--output <path>` or as the second positional argument.

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
    "keepFiles": ["800_refresh_materialized_view.sql"],
    "ignoreInReconstruct": ["800_refresh_materialized_view.sql"]
  },
  "init": {
    "seedSqlPaths": [
      "./seeds/split/*.sql",
      "./seeds/institutions/seeding_sql/*/*.seed.sql"
    ]
  }
}
```

`tableRules` example:

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

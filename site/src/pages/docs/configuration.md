---
layout: ../../layouts/DocsLayout.astro
title: Configuration
description: Configure input files, split directories, reconstruction output, cutoffs, and table-specific data limits.
eyebrow: Reference
---

Run `supabee init` to create `supabee.config.json`. Built-in defaults are used when the file is missing.

## Core structure

```json
{
  "schema": {
    "input": "supabase/schemas/prod-schemas.sql",
    "splitDir": "supabase/schemas/split",
    "reconstructed": "supabase/schemas/reconstructed.sql"
  },
  "data": {
    "input": "supabase/seeds/prod-data.sql",
    "splitDir": "supabase/seeds/split",
    "reconstructed": "supabase/seeds/reconstructed.sql"
  },
  "postSeedCutoff": "20260309180959"
}
```

## Environment-specific cutoffs

Keep separate fallbacks when environments do not share a migration boundary:

```json
{
  "postSeedCutoffByEnv": {
    "staging": "20260309180959",
    "production": "20260315121000"
  }
}
```

Select one with `--env`:

```bash
supabee db reset --env staging
supabee start --env production
```

## Override paths per command

CLI options take precedence over configured paths:

```bash
supabee schema split --input path/to/schema.sql --output path/to/split
supabee data split --input path/to/data.sql --output path/to/split
```

## Seed paths

`supabee init` updates `[db.seed].sql_paths` in `supabase/config.toml` so the Supabase CLI loads your split seed files in their declared order.

For the complete set of configuration keys and table-specific rules, refer to the example configuration shipped with the npm package.

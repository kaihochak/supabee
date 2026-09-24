---
layout: ../../../layouts/DocsLayout.astro
title: supabee init
description: Initialize Supabee configuration and register seed files with Supabase.
eyebrow: Command
---

Creates `supabee.config.json` if it does not exist and updates `[db.seed].sql_paths` in `supabase/config.toml` to include Supabee's ordered split seed files.

```bash
supabee init
```

## Files and changes

- If `supabee.config.json` is missing, creates it from the packaged example (or a minimal default config).
- Requires `supabase/config.toml` to exist. If `[db.seed]` is missing, adds it; otherwise it enables seeding and updates `sql_paths`.
- Adds `./seeds/split/*.sql` while preserving existing custom seed paths, unless `init.seedSqlPaths` explicitly configures the full list in `supabee.config.json`.
- Shows each proposed edit and asks for confirmation before writing it. Declined edits are left unchanged.

Run this after installing Supabee in a Supabase project, and review the generated config values and seed paths before committing. `--help` shows command usage; there are no other options.

See [configuration](/docs/configuration/) and [getting started](/docs/getting-started/).

---
layout: ../../../layouts/DocsLayout.astro
title: supabee sync data
description: Dump linked project data and split it into ordered per-table seed files.
eyebrow: Command
---

Runs `supabase db dump --data-only`, then splits, reconstructs, and validates the dump. Seed files are ordered for loading and organized by table; large tables can be split into chunks according to configuration.

```bash
supabee sync data
supabee sync data --input path/to/data.sql --output path/to/seed-files
```

Requires a linked Supabase project. `--input` and `--output` override configured paths; `--backup` / `--no-backup` control replacement of existing split output. `--force` skips migration-alignment preflight.

See the [syncing workflow](/docs/syncing/#sync-data) and [configuration](/docs/configuration/).

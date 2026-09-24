---
layout: ../../../layouts/DocsLayout.astro
title: supabee sync schema
description: Dump the linked project's schema, split it into object files, reconstruct it, and validate the output.
eyebrow: Command
---

Runs `supabase db dump` against the linked project, then processes the resulting schema through split, reconstruct, and validation steps. The output is organized by schema object and category.

```bash
supabee sync schema
supabee sync schema --input path/to/schema.sql --output path/to/split
```

Requires a linked Supabase project. `--input` and `--output` override configured paths; `--backup` / `--no-backup` control replacement of existing split output. `--force` skips migration-alignment preflight.

See the [syncing workflow](/docs/syncing/#sync-schema) and [configuration](/docs/configuration/).

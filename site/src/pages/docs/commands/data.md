---
layout: ../../../layouts/DocsLayout.astro
title: supabee data
description: Process an existing data dump into ordered seed files without connecting to Supabase.
eyebrow: Command
---

Runs the data processing chain on a dump already on disk: split, reconstruct, then validate. Pass a step to run only part of the chain.

```bash
supabee data
supabee data split --input path/to/data.sql --output path/to/seed-files
supabee data reconstruct
supabee data validate
```

Steps are `split`, `reconstruct`, and `validate`. Use `--input` and `--output` to override configured paths, and `--backup` or `--no-backup` to control replacement of split output.

For a linked-project dump, use [`supabee sync data`](/docs/commands/sync-data/). See the [syncing workflow](/docs/syncing/).

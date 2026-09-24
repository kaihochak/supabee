---
layout: ../../../layouts/DocsLayout.astro
title: supabee schema
description: Process an existing schema dump without connecting to a Supabase project.
eyebrow: Command
---

Runs the schema processing chain on a dump already on disk: split, reconstruct, then validate. Pass a step to run only part of the chain.

```bash
supabee schema
supabee schema split --input path/to/schema.sql --output path/to/schema-files
supabee schema reconstruct
supabee schema validate
```

Steps are `split`, `reconstruct`, and `validate`. Use `--input` and `--output` to override configured paths, and `--backup` or `--no-backup` to control replacement of split output.

For linked-project dumps, use [`supabee sync schema`](/docs/commands/sync-schema/). See the [syncing workflow](/docs/syncing/).

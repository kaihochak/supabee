---
layout: ../../layouts/DocsLayout.astro
title: Syncing schema and data
description: Pull linked project dumps and turn them into organized, validated SQL files.
eyebrow: Workflows
---

`supabee sync schema` and `supabee sync data` fetch a fresh dump from the linked project before running Supabee's complete processing chain. Add `--no-sync` to either command to process a dump already on disk instead. The top-level `supabee schema` and `supabee data` commands also process local dumps and allow running a single step.

1. Check migration alignment with the linked project.
2. Dump schema or data through the Supabase CLI.
3. Split the dump into reviewable files.
4. Reconstruct those files into a single SQL dump.
5. Validate the reconstructed output against the original.

## Sync schema

[`supabee sync schema` command reference](/docs/commands/sync-schema/)

```bash
supabee sync schema
```

Schema objects are split into ordered categories including extensions, types, functions, tables, views, constraints, indexes, foreign keys, row-level security, and permissions.

```bash
supabee sync schema \
  --input supabase/schemas/prod-schemas.sql \
  --output supabase/schemas/split
```

## Sync data

[`supabee sync data` command reference](/docs/commands/sync-data/)

```bash
supabee sync data
```

Data dumps use `supabase db dump --data-only` and are split into per-table seed files. Row and statement limits can be configured for large tables.

```bash
supabee sync data \
  --input supabase/seeds/prod-data.sql \
  --output supabase/seeds/split
```

## Existing dump files

Use `--no-sync` on these commands to process a local dump, or use [`supabee schema`](/docs/commands/sync-schema/) / [`supabee data`](/docs/commands/sync-data/) to run a local processing step:

```bash
# Complete split → reconstruct → validate chain
supabee schema
supabee data

# Run only one processing step
supabee schema split
supabee schema reconstruct
supabee schema validate
```

## Output backups

Supabee protects a dirty split directory before replacing it. Control that behavior explicitly with:

```bash
supabee sync data --backup
supabee sync data --no-backup
```

Use `--force` only when you intentionally need to skip the linked migration-alignment preflight.

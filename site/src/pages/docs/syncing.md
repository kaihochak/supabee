---
layout: ../../layouts/DocsLayout.astro
title: Syncing schema and data
description: Pull linked project dumps and turn them into organized, validated SQL files.
eyebrow: Workflows
---

The `sync` commands combine a Supabase dump with Supabee's complete processing chain:

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

Use [`supabee schema`](/docs/commands/schema/) or [`supabee data`](/docs/commands/data/) to process local dump files without fetching a new dump.

Use `schema` or `data` without `sync` when you already have a dump on disk:

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

---
layout: ../../layouts/DocsLayout.astro
title: Database lifecycle
description: Reset, seed, and start Supabase while preserving the correct migration and seed-data order.
eyebrow: Workflows
---

Supabase normally applies migrations before loading seed data. That order becomes a problem when newer migrations expect historical production data to already exist. Supabee temporarily defers those migrations and replays them after seeding.

## Reset a local database

```bash
supabee db reset
```

Supabee resolves a cutoff, defers migrations newer than it, runs `supabase db reset`, restores the migration files, and reapplies the deferred migrations.

Pass an explicit migration timestamp when needed:

```bash
supabee db reset 20260309180959
```

## Start local Supabase

`start` uses the same defer-and-replay strategy around `supabase start`:

```bash
supabee start
supabee start 20260309180959
```

## Reset a remote database

> Remote reset is destructive. It wipes the target database's `public` schema and reseeds it from local files. Do not use it against production.

Reset the linked project with resumable seeding:

```bash
supabee db reset --linked
```

For an explicit connection string:

```bash
supabee db reset \
  --db-url "postgresql://...:5432/postgres?sslmode=require" \
  --resumable-seed \
  --yes
```

Use a direct connection or session pooler on port `5432`. Transaction pooler connections on port `6543` are not supported by this workflow.

## Resume a large seed

Remote seed files run atomically through `psql`. If one fails, resume inclusively from that file:

```bash
supabee db seed-remote \
  --db-url "postgresql://...:5432/postgres?sslmode=require" \
  --from 015_public_cities_69.sql
```

Preview the ordered queue without writing anything:

```bash
supabee db seed-remote --db-url "$SUPABASE_DB_URL" --dry-run
```

By default, remote seeding disables triggers and foreign-key enforcement for the load, matching restore behavior. Add `--keep-triggers` when they must stay active.

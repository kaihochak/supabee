---
layout: ../../layouts/DocsLayout.astro
title: Database lifecycle
description: Choose when to start Supabase, rebuild a database, or load seed data.
eyebrow: Workflows
---

Choose the command based on what you need to change:

| Task | Command | What it does |
| --- | --- | --- |
| Start local Supabase | [`supabee start`](/docs/commands/start/) | Starts the stack with Supabee's migration ordering. |
| Rebuild a database | [`supabee db reset`](/docs/commands/db-reset/) | Resets the schema, loads seeds, then applies newer migrations. |
| Load or resume data | [`supabee seed`](/docs/commands/seed/) | Loads seed files into an existing schema. |

## Why seed order matters

A seed snapshot represents the database at a particular migration version: the **cutoff**. Migrations written after that version may expect the snapshot's data to exist already.

Supabee rebuilds in this order: **schema through the cutoff → seed snapshot → newer migrations**. It temporarily sets aside the newer migrations so they run after the data load.

If your snapshot includes migrations through `20260309180959`, pass that cutoff explicitly:

```bash
supabee db reset 20260309180959
```

You can omit the timestamp to use automatic detection and configuration fallbacks. Read [how the cutoff is resolved](/docs/commands/db-reset/#what-the-cutoff-means) if the snapshot differs from the linked project's current state.

## Work locally

Start the stack:

```bash
supabee start
```

With the stack running, choose either a full rebuild or a data load:

```bash
# Rebuild schema and reload data
supabee db reset

# Load data into tables that already exist
supabee seed
```

Both commands target local by default, even if a remote project is linked or remote URL environment variables are set.

## Rebuild a remote project

Set up authentication and link your project folder once:

```bash
supabase login
supabase link
```

Then reset the linked project:

```bash
supabee db reset --remote
```

A remote reset deletes existing application schema and data. Supabee displays the target and asks for confirmation before proceeding. It obtains the seed connection automatically; you do not need to paste a URL. Supabase CLI v3 and `psql` are required.

To choose another project or branch, use `--remote=<project-ref>` or `--remote=<branch>`. See the [reset reference](/docs/commands/db-reset/) for target selection, explicit URLs, and CI usage.

## Recover an interrupted data load

If a remote reset finishes rebuilding the schema but fails while seeding, resume the data load instead of resetting again:

```bash
supabee seed --remote=<project-ref> --from 015_public_cities.sql
supabase migration up --remote=<project-ref> --yes
```

Replace the placeholders with the project reference and failed file reported by the run. The first command reloads the failed file and continues; the second applies the migrations that were waiting for the seed data.

For a load started with `supabee seed` alone, only the first command is needed. See [seeding and resume](/docs/commands/seed/) for local and URL targets, transaction behavior, and trigger settings.

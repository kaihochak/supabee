---
layout: ../../layouts/DocsLayout.astro
title: Documentation
description: Prepare Supabase SQL files, rebuild databases, and resume seed loads.
eyebrow: Supabee docs
---

Supabee works alongside the Supabase CLI. It splits SQL dumps into files you can review and keeps newer migrations from running before the seed data they depend on.

New to Supabee? Start with [installation and setup](/docs/getting-started/).

## What do you need to do?

| Task | Start here |
| --- | --- |
| Download and organize a project's SQL | [Syncing schema and data](/docs/syncing/) |
| Start, rebuild, or seed a database | [Database lifecycle](/docs/database-lifecycle/) |
| Review or split migration files | [Migration management](/docs/migrations/) |
| Look up a command or flag | [Command reference](/docs/command-reference/) |
| Change paths and cutoff settings | [Configuration](/docs/configuration/) |

## Common commands

Download and process a linked project's schema and data:

```bash
supabee sync schema
supabee sync data
```

Rebuild a local database from its migrations and seed snapshot:

```bash
supabee db reset
```

To rebuild a remote project using your Supabase login, use `supabee db reset --remote`. Reset deletes existing application schema and data; read the [reset guide](/docs/commands/db-reset/) before running it remotely.

If the tables already exist and you only need to load data, use `supabee seed` locally or `supabee seed --remote` for a remote project. The [seed guide](/docs/commands/seed/) explains how to resume a failed file.

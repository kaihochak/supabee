---
layout: ../../layouts/DocsLayout.astro
title: Command reference
description: Find the command for your task and open its usage guide.
eyebrow: Reference
---

Supabee commands prepare SQL files, manage migration order, and load seed data. Commands it does not handle are forwarded to the installed Supabase CLI.

## Setup and SQL files

| Command | Use it to |
| --- | --- |
| [`supabee init`](/docs/commands/init/) | Create Supabee configuration and set seed paths. |
| [`supabee sync schema`](/docs/commands/sync-schema/) | Download, split, reconstruct, and validate a linked project's schema. |
| [`supabee sync data`](/docs/commands/sync-data/) | Download, split, reconstruct, and validate a linked project's data. |
| [`supabee schema`](/docs/syncing/) | Process an existing local schema dump. |
| [`supabee data`](/docs/syncing/) | Process an existing local data dump. |

## Databases

| Command | Use it to |
| --- | --- |
| [`supabee start`](/docs/commands/start/) | Start local Supabase with migrations applied in seed order. |
| [`supabee db reset`](/docs/commands/db-reset/) | Rebuild the local database from migrations and seeds. |
| [`supabee db reset --remote`](/docs/commands/db-reset/#reset-a-remote-project) | Rebuild a remote project using Supabase login. |
| [`supabee seed`](/docs/commands/seed/) | Load local seed data without rebuilding the schema. |
| [`supabee seed --remote`](/docs/commands/seed/#load-data-remotely) | Load or resume seed data on a remote project. |

Read [database lifecycle](/docs/database-lifecycle/) if you are deciding between start, reset, and seed.

## Migrations

| Command | Use it to |
| --- | --- |
| [`supabee cutoff detect`](/docs/commands/cutoff-detect/) | Resolve the migration cutoff used for seed ordering. |
| [`supabee migration audit`](/docs/commands/migration-audit/) | Classify migration files as schema, data, mixed, or unknown. |
| [`supabee migration mark`](/docs/commands/migration-mark/) | Add classification markers to migration files. |
| [`supabee migration unmark`](/docs/commands/migration-unmark/) | Remove classification markers. |
| [`supabee migration split`](/docs/commands/migration-split/) | Preview or apply a split of mixed schema/data migrations. |

## Forwarded Supabase commands

For example, Supabee forwards this command to `supabase migration list --remote`:

```bash
supabee migration list --remote
```

Forwarded commands use the options and behavior of your installed Supabase CLI. See the [Supabase CLI reference](https://supabase.com/docs/reference/cli).

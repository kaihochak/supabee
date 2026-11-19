---
layout: ../../../layouts/DbResetDocsLayout.astro
title: supabee db reset
description: Rebuild a database, load its seed snapshot, then apply newer migrations.
eyebrow: Command
---

## What it does

| Step | What Supabee does | Command |
| --- | --- | --- |
| 1 | Resolve the target: local, linked project, explicit project, branch, or URL. | [`supabase link`](https://supabase.com/docs/reference/cli/supabase-link) / [`supabase branches list`](https://supabase.com/docs/reference/cli/supabase-branches-list), when needed |
| 2 | Resolve the migration cutoff. | [`supabee cutoff detect`](/docs/commands/cutoff-detect/) |
| 3 | Classify migrations and split newer mixed migrations when needed, with confirmation. | [`supabee migration split`](/docs/commands/migration-split/) |
| 4 | Set aside migrations after the cutoff and stub historical data-only migrations. | Internal |
| 5 | Rebuild the database. Local resets include seeding; remote resets skip it. | [`supabase db reset`](https://supabase.com/docs/reference/cli/supabase-db-reset) |
| 6 | Restore deferred files and original historical SQL, even if reset fails. | Internal |
| 7 | Load remote seed files, one transaction per file. | [`supabee seed`](/docs/commands/seed/) |
| 8 | Apply migrations after the cutoff. | [`supabase migration up`](https://supabase.com/docs/reference/cli/supabase-migration-up) |
| 9 | Print the success or failure summary. | Internal |

Supabee uses the shared logic behind its own commands and supplies the target and connection settings to Supabase commands.

## Usage

```bash
supabee db reset [cutoffTimestamp] [options]
```

A reset deletes existing application schema and data. Remote resets show the selected target and ask for confirmation; press Enter to cancel.

## Reset locally

With your [local Supabase stack running](/docs/commands/start/):

```bash
supabee db reset
```

If you know which migration your seed snapshot represents, supply that version:

```bash
supabee db reset 20260309180959
```

## Reset a remote project

For first-time setup, log in and link your project folder:

```bash
supabase login
supabase link
```

Then run:

```bash
supabee db reset --remote
```

Supabee uses your Supabase login to obtain temporary seed credentials. You do not need to copy a database connection string. The seed connection is checked before reset, and remote seed files are loaded individually so a failed load can be resumed.

Remote project targets require Supabase CLI v3 and `psql` on your path.

### Choose the target

| Command | Database selected |
| --- | --- |
| `supabee db reset` | Local Supabase database |
| `supabee db reset --remote` | Linked project |
| `supabee db reset --remote=<project-ref>` | Project with that reference |
| `supabee db reset --remote=<branch>` | Branch by name or UUID, under the linked project |
| `supabee db reset --remote="$DATABASE_URL"` | Database specified by the URL |

Replace placeholders with your own values. Attach an explicit remote target with `=` and use only one target option per invocation.

For bare `--remote`, Supabee checks `SUPABASE_PROJECT_ID`, then `supabase/.temp/project-ref`. If neither selects a project, it opens an interactive project picker. Without a terminal, a missing selection is an error.

`SUPABASE_DB_URL` and `PGURI` do not select or override a project target. Plain `db reset` remains local even when those variables or a linked project exist.

## What the cutoff means

The cutoff is the migration version already represented by your seed data. If the seed snapshot includes changes through `20260309180959`, use that timestamp. Supabee rebuilds the schema through that version, loads the snapshot, then applies newer migrations.

When you omit the timestamp, Supabee tries automatic detection before using a configured fallback:

1. Find the latest version shared by your local migration files and the target's migration history. With `--remote`, this is the selected database. Local resets and legacy URL options consult the linked project instead.
2. If detection fails, use `postSeedCutoffByEnv.<name>` when `--env <name>` is supplied, then `postSeedCutoff` in `supabee.config.json`.
3. Stop if no cutoff can be resolved.

Automatic detection saves the result to configuration. Pass the cutoff explicitly when the detected history does not match your seed snapshot. `--env` chooses cutoff configuration; it does not choose a database.

### Migration and seed order

1. Temporarily set aside migrations newer than the cutoff.
2. Rebuild through the cutoff. Historical data-only migrations use temporary no-op stubs because the seed snapshot already contains their effects.
3. Restore the migration files and load seed data. Local seeding is part of the Supabase reset; remote seeding runs separately through `psql`.
4. Apply the newer migrations to the same database.

Supabee attempts to restore the files even if reset fails. Older mixed schema/data migrations run with a warning; newer mixed migrations require a confirmed split. Use `--strict-mixed` to reject all mixed migrations. See [migration management](/docs/migrations/) for details.

## Resume a failed remote seed

Use the project reference and failed filename printed by the run. For example:

```bash
supabee seed --remote=<project-ref> --from 015_public_cities.sql
supabase migration up --remote=<project-ref> --yes
```

The failed file is loaded again; earlier files are skipped. Once seeding finishes, the second command applies the migrations that were waiting for the seed data.

Do not restart `db reset` to resume a load: that rebuilds the database and starts seeding from the beginning. Preserve `--keep-triggers` if you used it in the original run. This recovery path applies to seed-file failures after a successful schema reset; for other failures, check the reported execution stage.

For an explicit URL target, use that same URL for both recovery commands:

```bash
supabee seed --remote="$DATABASE_URL" --from 015_public_cities.sql
supabase migration up --remote="$DATABASE_URL" --yes
```

## Run in CI

Set `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` in your CI environment, then supply the seed snapshot's cutoff and skip confirmation:

```bash
supabee db reset 20260309180959 --remote="$SUPABASE_PROJECT_ID" --yes
```

Replace the example timestamp with your cutoff. `--yes` skips reset confirmation only; it does not approve a migration split or answer a project picker.

## Options

| Option | Effect |
| --- | --- |
| `--remote[=<target>]` | Select the linked project, a project reference, a branch, or a Postgres URL. |
| `--yes` | Skip remote-reset confirmation. Required for non-interactive remote resets. |
| `--keep-triggers` | Keep triggers and foreign-key checks active during remote seeding. They are disabled by default. |
| `--strict-mixed` | Stop if any migration combines schema and data changes. |
| `--env <name>` | Select an environment-specific cutoff fallback and save location. |
| `--migrations-dir <path>` | Migration directory. Default: `supabase/migrations`. |
| `--temp-dir <path>` | Temporary migration storage. Default: `supabase/.tmp-migrations`. |
| `--psql` | Apply newer migrations through the built-in local `psql` connection instead of `supabase migration up`. Local targets only. |

### Connection and compatibility notes

Explicit remote URLs must use a Direct connection or Session pooler on port `5432`. Transaction pooler URLs on `6543` are rejected. Encode special characters in URL credentials.

Automatic project credentials support the default Supabase cloud profile and use an experimental Supabase API. Other profiles need an explicit database URL. Live Supabase validation remains pending.

Older target flags remain supported:

| Option | Behavior |
| --- | --- |
| `--linked` | Read a database URL from `SUPABASE_DB_URL`, then `PGURI`, or prompt securely. This mode still requires a URL. |
| `--db-url <url>`, `--url <url>` | Use the supplied database URL. |
| `--resumable-seed` | Compatibility flag. All remote resets already use resumable seeding. |

For legacy URL modes, cutoff detection uses the linked project's history. Supply an explicit cutoff if it represents a different database or snapshot.

---
layout: ../../../layouts/DocsLayout.astro
title: supabee seed
description: Load seed files into an existing database, or resume an interrupted load.
eyebrow: Command
---

Use `seed` when the database schema already exists and you only need to load data. To rebuild the schema as well, use [`db reset`](/docs/commands/db-reset/).

```bash
supabee seed [options]
```

## Load data locally

With the local Supabase stack running:

```bash
supabee seed
```

Supabee obtains the connection from the current project's `supabase status` output. Remote environment variables do not change the target of this command. `psql` must be installed and available on your path.

## Load data remotely

Log in and link the project folder once, then seed the linked project:

```bash
supabase login
supabase link
supabee seed --remote
```

You can also select a project, branch, or URL explicitly:

```bash
supabee seed --remote=<project-ref>
supabee seed --remote=<branch>
supabee seed --remote="$DATABASE_URL"
```

The [target selection rules](/docs/commands/db-reset/#choose-the-target) are the same as reset. Project and branch targets reuse Supabase login or `SUPABASE_ACCESS_TOKEN`; no database URL prompt is shown. The selected target must already contain the tables your seed files use.

## Choose and preview seed files

Seed paths come from `supabase/config.toml`. For example:

```toml
[db.seed]
sql_paths = ["./seeds/*.sql"]
```

This loads matching files under `supabase/seeds/`. Patterns are processed in their declared order, matching paths are sorted alphabetically, and duplicate paths are removed. If `sql_paths` is omitted, Supabee uses `supabase/seed.sql`.

Preview the ordered files before loading them:

```bash
supabee seed --dry-run
```

Dry runs list files without connecting, looking up credentials, or prompting for a target. The preview uses the same local seed configuration regardless of the database selected.

## Resume from a failed file

Each file runs in its own transaction. If it fails, that file rolls back, earlier files remain committed, and later files are not loaded. Supabee prints the filename and a command to resume.

For a project target:

```bash
supabee seed --remote=<project-ref> --from 015_public_cities.sql
```

Use the reference and filename from the failed run. `--from` includes the named file and skips everything before it. Keep the same seed files and target, and preserve `--keep-triggers` if it was used originally.

For a local target, use `supabee seed --from 015_public_cities.sql`. For a URL target, use `supabee seed --remote="$DATABASE_URL" --from 015_public_cities.sql`.

Progress is not stored automatically. Running again without `--from` reloads every file and may encounter duplicate data. Supabee does not automatically retry failed seed SQL.

If this load is resuming a remote reset, finish by applying the waiting migrations:

```bash
supabase migration up --remote=<project-ref> --yes
```

Standalone seeding does not apply migrations. See [reset recovery](/docs/commands/db-reset/#resume-a-failed-remote-seed) for URL targets and other reset failures.

## Options

| Option | Effect |
| --- | --- |
| `--remote[=<target>]` | Select the linked project, explicit project, branch, or Postgres URL. |
| `--from <file>` | Start at this file, inclusively. Accepts its filename or relative path. |
| `--dry-run` | Print the ordered seed queue without connecting. |
| `--keep-triggers` | Keep triggers and foreign-key checks active during loading. |

Seed sessions disable statement timeouts. By default, they also disable triggers and foreign-key checks so dump data can load across files. Use `--keep-triggers` if those checks must run during the load.

### Connection and compatibility notes

Project targets require Supabase CLI v3 and authentication for the default Supabase cloud profile. Supabee obtains temporary credentials and refreshes them before new file connections when needed. Automatic credentials use an experimental Supabase API; live Supabase validation remains pending.

Explicit remote URLs must use a Direct connection or Session pooler on port `5432`, not the Transaction pooler on `6543`.

`--url <url>` and `--db-url <url>` remain aliases for supplying a remote URL. The older `--linked` mode reads `SUPABASE_DB_URL` / `PGURI` or prompts for a URL; unlike `--remote`, it does not obtain credentials automatically. Use only one target option.

`supabee db seed-remote` no longer loads data. Use `supabee seed` instead.

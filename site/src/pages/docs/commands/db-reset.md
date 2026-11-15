---
layout: ../../../layouts/DocsLayout.astro
title: supabee db reset
description: Rebuild a local or remote database, load seed data, and apply migrations newer than the selected cutoff.
eyebrow: Command
---

Rebuild a database from the project's migrations and seed files, then apply migrations newer than the selected cutoff. The local database is targeted by default. Remote resets use resumable seeding automatically.

```bash
supabee db reset [cutoffTimestamp] [options]
```

Supabee wraps the official `supabase db reset` command and adds migration ordering and remote seed recovery. Running `supabase db reset --linked` directly does not use Supabee's prompts or resumable seed loader.

## Target selection

| Target | Invocation | Connection |
| --- | --- | --- |
| Local database | `supabee db reset` | Managed by the local Supabase CLI. |
| Linked project, automatic credentials | `supabee db reset --remote` | `SUPABASE_PROJECT_ID`, saved link, then interactive project picker; reuses Supabase login. |
| Explicit project | `supabee db reset --remote=<project-ref>` | Selected project with temporary seed credentials. |
| Branch | `supabee db reset --remote=<branch>` | Branch name or UUID resolved under the linked project. |
| Explicit URL | `supabee db reset --remote="<postgres-url>"` | Supplied URL, used for reset and seeding. |
| Linked project | `supabee db reset --linked` | Reads `SUPABASE_DB_URL`, then `PGURI`, or asks for a URL interactively. |
| Explicit remote database | `supabee db reset --db-url <url>` | Uses the supplied Postgres connection URL. |

Use only one target option. `--remote` requires Supabase CLI v3. For project and
branch targets, run `supabase login` or set `SUPABASE_ACCESS_TOKEN`; no database URL
is needed. Supabee reuses the CLI's OS keyring or saved access-token file, obtains
temporary database credentials, and checks the seed connection before resetting.
Only the default Supabase cloud profile is supported for automatic credentials.
The login-role Management API is experimental. Seeding obtains fresh credentials
after reset and refreshes them before opening a new file connection when needed.
`SUPABASE_DB_URL` and `PGURI` do not override project targets.

The legacy `--linked` and `--db-url` options are mutually exclusive. Both remote modes require the Supabase CLI and `psql`. Project migrations and seed files are read from your local checkout.

For `--linked`, provide a URL belonging to the project selected by `supabase link`. The URL determines the database connection; the linked project's migration history is used to detect the cutoff.

> Resetting a remote database destroys its existing application schema and data and rebuilds them from local files. Use a disposable or staging database, and confirm the target before proceeding.

## Migration cutoff

`cutoffTimestamp` is the migration version represented by the seed snapshot. For example, if the snapshot includes migrations through `20260309180959`, that version is the cutoff. Later migrations run after the seed is loaded.

Supabee resolves the cutoff in this order:

1. The explicit positional argument, if supplied.
2. The latest migration version present in both local and linked-project migration history, obtained through `supabase migration list --linked`.
3. A configured fallback if linked detection fails: `postSeedCutoffByEnv.<name>` when selected with `--env`, then `postSeedCutoff`.

If no valid cutoff can be resolved, the command stops. Successful automatic detection saves the cutoff to `supabee.config.json`, using the environment-specific entry when `--env` is supplied. Supabee may invoke `supabase link` and retry when the project is not linked.

`--env` selects a configuration fallback; it does not select the target database. For `--remote`, automatic cutoff detection uses the selected target. Local and legacy URL-based resets continue to use the linked project's history. Pass an explicit cutoff when the target or seed snapshot differs from the linked project.

### Execution order

1. Resolve the cutoff and classify the migration files.
2. Rebuild the schema through the cutoff and load the seed data.
3. Apply migrations newer than the cutoff with `supabase migration up` against the selected target.

Historical data-only migrations at or before the cutoff are temporarily replaced with no-op SQL during reset, because their effects are already included in the seed snapshot. Original migration files are restored afterward.

Mixed schema/data migrations at or before the cutoff run as-is with a warning. Mixed migrations after the cutoff require a confirmed split plan; the command stops if they cannot be split. `--strict-mixed` rejects all mixed migrations. See [migration management](/docs/migrations/) for classification and splitting behavior.

## Remote seeding

All remote target modes run the remote reset with `--no-seed`, load the seed files through `psql`, then apply the deferred migrations. No flag or prompt is required to enable resumable seeding.

Seed files come from `[db.seed].sql_paths` in `supabase/config.toml`. Patterns are processed in their declared order, with matches sorted lexically and duplicate paths removed. These local files must be available when the command runs.

Each seed file runs in a separate transaction with statement timeout disabled. By default, the loading session disables triggers and foreign-key enforcement. Use `--keep-triggers` to keep them active. If a file fails, its transaction rolls back, earlier files remain committed, and later files are not loaded.

### Connection URL

Use a Direct connection or Session pooler URL on port `5432`. Session pooler connections support IPv4-only networks. Transaction pooler URLs on port `6543` are rejected. Target selection with `--linked` or `--db-url` does not determine whether the connection uses a pooler; the URL does.

In a URL such as `postgresql://user:password@host:5432/postgres?sslmode=require`, `/postgres` selects the database named `postgres` and `sslmode=require` requires an encrypted connection.

### Interactive prompts

| Prompt | When it appears | Default |
| --- | --- | --- |
| `Database URL:` | `--linked` is used and neither URL environment variable is set. Input is hidden. | No default URL. |
| `Add database /postgres and sslmode=require? [Y/n]` | The entered URL is missing a database name, an SSL setting, or both. Only missing settings are suggested. | Enter or `Y` applies the suggestion; `n` keeps the original URL. |
| `Reset <target>? [y/N]` | Any remote reset without `--yes`. | Enter or `n` cancels the reset. |

Existing database names and SSL settings are preserved. URLs supplied through `--db-url` or environment variables are used as provided, without suggested additions.

`--yes` skips only the remote-reset confirmation. It does not answer the URL, URL-default, or mixed-migration split prompts. Non-interactive remote resets require `--yes`; linked resets also require a URL environment variable.

## Arguments and options

| Argument or option | Default | Effect and applicability |
| --- | --- | --- |
| `[cutoffTimestamp]` | Automatically resolved. | Numeric migration version, such as `20260309180959`, separating the seed snapshot from migrations applied afterward. |
| `--remote[=<target>]` | Off; target is local. | Select linked project, explicit project ref, branch name/UUID, or Postgres URL. Project targets use automatic credentials. |
| `--linked` | Off; target is local. | Reset the linked remote project using a prompted or environment-supplied URL. |
| `--db-url <url>` | Unset. | Reset the remote database at this URL. Cannot be combined with `--linked`. |
| `--url <url>` | Unset. | Alias for `--db-url`. |
| `--yes` | Off. | Skip remote-reset confirmation. Required for non-interactive remote resets. |
| `--keep-triggers` | Off. | Keep triggers and FK checks active during remote seeding. Local seed behavior is managed by Supabase. |
| `--env <name>` | Unset. | Select `postSeedCutoffByEnv.<name>` as the first configured cutoff fallback and the destination for a detected cutoff. |
| `--strict-mixed` | Off. | Reject any mixed schema/data migration before resetting. |
| `--psql` | Off. | Reapply deferred migrations through raw `psql` using the built-in local connection settings. Local targets only; cannot be combined with either remote option. |
| `--migrations-dir <path>` | `supabase/migrations` | Directory used to classify, defer, and restore migration files. |
| `--temp-dir <path>` | `supabase/.tmp-migrations` | Temporary storage for deferred files and historical migration originals. |
| `--resumable-seed` | Automatic for remote targets. | Retained for compatibility. Unnecessary for remote resets; rejected without a remote target. |

## Examples

### Local reset

Reset the local database using automatic cutoff detection:

```bash
supabee db reset
```

Provide the migration version represented by the seed snapshot explicitly:

```bash
supabee db reset 20260309180959
```

### Interactive remote reset

Reset the linked project using Supabase login and asking for reset confirmation:

```bash
supabase login
supabee db reset --remote
```

The legacy `--linked` mode still accepts an environment URL or prompts for one.

### Explicit remote target

Use a complete URL stored in `SUPABASE_DB_URL`. Replace the example cutoff with the migration version matching your seed snapshot:

```bash
supabee db reset 20260309180959 --db-url "$SUPABASE_DB_URL"
```

### Unattended remote reset

Supply the cutoff and URL, and skip the reset confirmation. Migrations must not require an interactive split:

```bash
supabee db reset 20260309180959 --db-url "$SUPABASE_DB_URL" --yes
```

## Failure and recovery

A seed-file failure stops the reset before deferred migrations are applied. Supabee prints the failing filename and a resume command. Resume against the same database from that file, inclusively:

```bash
supabee seed --linked --from 015_public_cities_69.sql
```

Use the filename reported by your run and provide the same database URL when prompted. Earlier files are skipped. Preserve `--keep-triggers` if it was used for the original reset. The standalone [seed command](/docs/commands/seed/) loads data only; after it succeeds, finish applying the deferred migrations against the same database:

```bash
supabase migration up --db-url "$SUPABASE_DB_URL" --yes
```

Running `db reset` again starts another reset and reloads data from the beginning. Use `seed --linked --from` to continue an interrupted remote seed.

The seed-resume procedure applies only when the schema reset succeeded and loading a seed file failed. Other failures are reported with their execution stage. Supabee attempts to restore temporarily modified or deferred migration files after the underlying reset finishes or fails; a restoration failure stops seeding and migration replay. Inspect the reported stage and file paths before retrying. Execution failures return a nonzero exit status; cancelling the reset confirmation exits without resetting the database.

See the [database lifecycle workflow](/docs/database-lifecycle/) for how reset, start, and seed commands fit together.

For a project-based seed failure, resume without a database URL:

```bash
supabee seed --remote=<project-ref> --from <failed-file>
supabase migration up --remote=<project-ref> --yes
```

Use the project reference and filename printed by the failed run. Temporary
credentials are obtained again; a new reset is unnecessary.

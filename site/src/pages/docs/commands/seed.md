---
layout: ../../../layouts/DocsLayout.astro
title: supabee seed
description: Load ordered seed files into the local Supabase project or a remote database, with file-level resume.
eyebrow: Command
---

Loads seed files into an existing database without resetting it or applying migrations. The target must already contain the required tables. Reads ordered seed paths from `[db.seed].sql_paths` in `supabase/config.toml` and executes each file through `psql` in its own transaction.

## Local seeding

Run from your Supabase project folder:

```bash
supabee seed
```

Supabee obtains this project's database connection from `supabase status`, including its actual port. Start the local project with `supabase start` first. A remote URL in your environment does not change the target of plain `supabee seed`.

## Remote seeding

Use the same connection flow as `supabee db reset --linked`:

```bash
supabee seed --linked
```

Supabee reads `SUPABASE_DB_URL`, then `PGURI`, from the shell environment. If neither is set, it prompts for a database URL with hidden input. Missing `/postgres` and `sslmode=require` settings are suggested with `[Y/n]`; existing settings are preserved. Supabee does not automatically load `.env` files. Non-interactive runs must supply a URL flag or environment variable.

To supply a URL directly, use `--url` or its alias `--db-url`, without `--linked`:

```bash
supabee seed --url "$SUPABASE_DB_URL"
```

Use a direct or session-pooler connection on port `5432`, not the transaction pooler on `6543`. See [resume a large seed](/docs/database-lifecycle/#resume-a-large-seed).

## Preview and resume

```bash
supabee seed --dry-run
supabee seed --from 015_public_cities.sql
supabee seed --linked --from 015_public_cities.sql
```

`--from` accepts a configured seed file's basename or relative path and includes that file in the resumed queue. Resume against the same database and seed files as the failed run. Earlier files are skipped; their completion is not stored or checked automatically.

For each file, `psql` uses `ON_ERROR_STOP`, a single transaction, and no statement timeout. A failing file rolls back on its own; earlier files remain loaded. Resume is file-level, not row-level. Starting again without `--from` reruns every file and may encounter duplicate data.

By default, triggers and foreign-key checks are disabled for the session through `session_replication_role = replica`, which requires a role permitted to set it. Use `--keep-triggers` when they must remain active.

| Option | Effect |
| --- | --- |
| `--linked` | Select a remote target and read or prompt for its URL. |
| `--url <url>`, `--db-url <url>` | Select an explicit remote target. Cannot be combined with `--linked` or each other. |
| `--from <file>` | Start at this file, inclusively. |
| `--dry-run` | List files without connecting to a database or prompting for a URL. |
| `--keep-triggers` | Keep triggers and foreign-key checks active. |

`psql` must be installed and available on your path. After resuming an interrupted remote reset, apply the deferred migrations separately against the same target; `seed` only loads data.

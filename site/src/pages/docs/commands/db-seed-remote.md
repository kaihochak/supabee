---
layout: ../../../layouts/DocsLayout.astro
title: supabee db seed-remote
description: Load ordered local seed files into a remote Postgres database with resumable file-level progress.
eyebrow: Command
---

Reads ordered seed paths from `[db.seed].sql_paths` in `supabase/config.toml` and executes each file through `psql` in its own transaction. If a file fails, the command reports how to resume from that file.

For each seed file, it opens a `psql` session with `ON_ERROR_STOP` and a single transaction. A failing file rolls back on its own; earlier files remain loaded. By default, triggers and FK checks are disabled for the session to behave like a restore, and statement timeout is disabled so large inserts can finish.

```bash
supabee db seed-remote --db-url "$SUPABASE_DB_URL"
supabee db seed-remote --db-url "$SUPABASE_DB_URL" --dry-run
supabee db seed-remote --db-url "$SUPABASE_DB_URL" --from 015_public_cities.sql
```

Use `--db-url <url>` or `SUPABASE_DB_URL` / `PGURI`. `--from <file>` resumes inclusively; `--dry-run` prints the ordered queue without writing; `--keep-triggers` leaves triggers and foreign-key checks active.

Use a direct or session-pooler connection on port `5432`, not the transaction pooler on `6543`. See [resume a large seed](/docs/database-lifecycle/#resume-a-large-seed).

`--from` accepts a configured seed file's basename or relative path and includes that file in the resumed queue. The command does not reset the database or create the schema: the target must already have the required tables. `--dry-run` is safe for checking which files and order will be used.

---
layout: ../../../layouts/DocsLayout.astro
title: supabee db seed-remote
description: Load ordered local seed files into a remote Postgres database with resumable file-level progress.
eyebrow: Command
---

Reads ordered seed paths from `[db.seed].sql_paths` in `supabase/config.toml` and executes each file through `psql` in its own transaction. If a file fails, the command reports how to resume from that file.

```bash
supabee db seed-remote --db-url "$SUPABASE_DB_URL"
supabee db seed-remote --db-url "$SUPABASE_DB_URL" --dry-run
supabee db seed-remote --db-url "$SUPABASE_DB_URL" --from 015_public_cities.sql
```

Use `--db-url <url>` or `SUPABASE_DB_URL` / `PGURI`. `--from <file>` resumes inclusively; `--dry-run` prints the ordered queue without writing; `--keep-triggers` leaves triggers and foreign-key checks active.

Use a direct or session-pooler connection on port `5432`, not the transaction pooler on `6543`. See [resume a large seed](/docs/database-lifecycle/#resume-a-large-seed).

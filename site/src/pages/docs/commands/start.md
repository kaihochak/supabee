---
layout: ../../../layouts/DocsLayout.astro
title: supabee start
description: Start the local Supabase stack and replay post-seed migrations afterward.
eyebrow: Command
---

Defers migrations newer than the selected cutoff, runs `supabase start`, restores the migration files, then reapplies the deferred migrations.

## Execution order

1. Resolve the cutoff from the optional timestamp, linked migration alignment, or configured fallback.
2. Temporarily defer migrations newer than that boundary and handle mixed migrations according to the same classifier used by `db reset`.
3. Run `supabase start`, restore the migration files, then apply deferred migrations through `supabase migration up`.

Unlike `db reset`, `start` does not reset the local database or reload seed data. Use it when bringing up the local Supabase stack while still needing migrations newer than the seed-data boundary to run afterward.

```bash
supabee start
supabee start 20260309180959
```

The cutoff is resolved from the explicit timestamp, linked migration alignment, or configuration. `--env` selects an environment-specific configured cutoff; `--psql` changes how deferred migrations are reapplied; `--strict-mixed` controls handling of mixed schema/data migrations.

| Option | Effect |
| --- | --- |
| `[cutoffTimestamp]` | Marks the latest migration already represented by existing data. |
| `--env <name>` | Selects the named configured cutoff fallback. |
| `--psql` | Reapplies deferred migration files through `psql` rather than `supabase migration up`. |
| `--strict-mixed` | Stops if mixed schema/data migrations are detected. |
| `--migrations-dir`, `--temp-dir` | Override migration storage or the temporary area used while deferring files. |

See the [database lifecycle workflow](/docs/database-lifecycle/#start-local-supabase) and [configuration](/docs/configuration/).

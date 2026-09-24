---
layout: ../../../layouts/DocsLayout.astro
title: supabee db reset
description: Reset a database while loading seed data before replaying newer migrations.
eyebrow: Command
---

Defers migrations newer than a cutoff, runs `supabase db reset`, restores the migration files, and applies the deferred migrations after seeding. If no cutoff is supplied, Supabee resolves one from linked migration alignment or configuration.

## Execution order

1. Resolve the cutoff and classify migrations. Files newer than the cutoff are temporarily deferred; historical data-only migrations may be stubbed during reset so their data changes are not replayed over the seed.
2. Run the underlying `supabase db reset` (or prepare the remote target and reset it).
3. Restore the original migration files and apply deferred migrations with `supabase migration up` by default.

The cutoff means “the latest migration already represented by the seeded/live data.” Migrations after it are applied after seeding. If omitted, Supabee uses the latest shared local/remote migration version, then the configured fallback (`postSeedCutoff` or `postSeedCutoffByEnv`). An explicit timestamp takes precedence. `--env` selects the named fallback.

```bash
supabee db reset
supabee db reset 20260309180959
```

For remote targets, `--linked` or `--db-url <url>` performs a destructive reset and requires confirmation; `--yes` skips that prompt. `--resumable-seed` loads configured seed files individually, and `--keep-triggers` preserves triggers and foreign-key checks during that load. Other options include `--env`, `--psql`, and `--strict-mixed`.

| Option | Effect |
| --- | --- |
| `[cutoffTimestamp]` | Migration timestamp boundary for deciding which migrations run after seeding. |
| `--linked` | Target the linked remote project; prompts for its database URL and uses resumable seeding. |
| `--db-url <url>` | Target a specific remote database instead of the local database. |
| `--yes` | Skip the confirmation prompt for a remote destructive reset. |
| `--resumable-seed` | For a remote target, reset without Supabase's seed step, then load each configured seed file with `psql`. |
| `--keep-triggers` | Keep triggers and FK checks active during resumable seeding; otherwise they are disabled like a restore. |
| `--psql` | Apply deferred migrations with `psql` instead of `supabase migration up` (local target). |
| `--strict-mixed` | Fail if any migration mixes schema and data changes. Without it, mixed files after cutoff require a split plan; older ones run as-is with a warning. |
| `--migrations-dir`, `--temp-dir` | Override the migrations directory or temporary workspace for deferred/stubbed files. |
| `--env <name>` | Select an environment-specific cutoff fallback. |

Remote reset is destructive: it wipes the target's `public` schema. Confirm the URL and cutoff before proceeding. If resumable seeding fails, the command reports a `supabee db seed-remote --from ...` resume command.

Read the [database lifecycle workflow](/docs/database-lifecycle/#reset-a-local-database) before using remote-reset options. Remote reset wipes the target database's `public` schema.

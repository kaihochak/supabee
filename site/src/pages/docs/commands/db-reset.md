---
layout: ../../../layouts/DocsLayout.astro
title: supabee db reset
description: Reset a database while loading seed data before replaying newer migrations.
eyebrow: Command
---

Defers migrations newer than a cutoff, runs `supabase db reset`, restores the migration files, and applies the deferred migrations after seeding. If no cutoff is supplied, Supabee resolves one from linked migration alignment or configuration.

```bash
supabee db reset
supabee db reset 20260309180959
```

For remote targets, `--linked` or `--db-url <url>` performs a destructive reset and requires confirmation; `--yes` skips that prompt. `--resumable-seed` loads configured seed files individually, and `--keep-triggers` preserves triggers and foreign-key checks during that load. Other options include `--env`, `--psql`, and `--strict-mixed`.

Read the [database lifecycle workflow](/docs/database-lifecycle/#reset-a-local-database) before using remote-reset options. Remote reset wipes the target database's `public` schema.

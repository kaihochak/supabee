---
layout: ../../../layouts/DocsLayout.astro
title: supabee start
description: Start the local Supabase stack and replay post-seed migrations afterward.
eyebrow: Command
---

Defers migrations newer than the selected cutoff, runs `supabase start`, restores the migration files, then reapplies the deferred migrations.

```bash
supabee start
supabee start 20260309180959
```

The cutoff is resolved from the explicit timestamp, linked migration alignment, or configuration. `--env` selects an environment-specific configured cutoff; `--psql` changes how deferred migrations are reapplied; `--strict-mixed` controls handling of mixed schema/data migrations.

See the [database lifecycle workflow](/docs/database-lifecycle/#start-local-supabase) and [configuration](/docs/configuration/).

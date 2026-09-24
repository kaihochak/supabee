---
layout: ../../../layouts/DocsLayout.astro
title: supabee migration split-mixed
description: Preview or apply a rewrite that separates schema changes from data changes in mixed migrations.
eyebrow: Command
---

Builds a plan for splitting migrations that mix schema changes with data-manipulation statements. It previews the planned changes by default; files are only rewritten when you explicitly apply the plan and confirm.

```bash
supabee migration split-mixed
supabee migration split-mixed --apply
supabee migration split-mixed --migrations-dir path/to/migrations
```

`--apply` executes the confirmed rewrite. `--migrations-dir` selects the migration directory (default `supabase/migrations`). Review and commit the generated migration changes carefully.

See [migration management](/docs/migrations/) for the workflow and safety considerations.

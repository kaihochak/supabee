---
layout: ../../../layouts/DocsLayout.astro
title: supabee migration split-mixed
description: Preview or apply a rewrite that separates schema changes from data changes in mixed migrations.
eyebrow: Command
---

Builds a plan for splitting migrations that mix schema changes with data-manipulation statements. It previews the planned changes by default; files are only rewritten when you explicitly apply the plan and confirm.

## Preview and apply

The preview shows each mixed migration and the replacement filenames. The planner separates the SQL into ordered schema/data segments and renumbers migrations from the earliest affected version; later migration files may also be renumbered to preserve ordering. Original affected files are kept in a backup directory under `supabase/.tmp-migrations`.

```bash
supabee migration split-mixed
supabee migration split-mixed --apply
supabee migration split-mixed --migrations-dir path/to/migrations
```

`--apply` executes the confirmed rewrite. `--migrations-dir` selects the migration directory (default `supabase/migrations`). Review and commit the generated migration changes carefully.

Applying checks the linked project's migration history and refuses to rewrite any touched migration version already applied remotely. It also prompts for confirmation. Because renumbering changes migration history, use this only for migrations that have not been pushed/applied; coordinate with your team and review the full file diff before committing. If the SQL cannot be safely divided while preserving transaction semantics, the command stops and asks you to split it manually.

See [migration management](/docs/migrations/) for the workflow and safety considerations.

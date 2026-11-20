---
layout: ../../../layouts/DocsLayout.astro
title: supabee migration split
description: Preview or apply a rewrite that separates schema changes from data changes in mixed migrations.
eyebrow: Command
---

Builds a plan for splitting migrations that mix schema changes with data-manipulation statements. It displays the planned changes and rewrites files after confirmation. Pass `--dry-run` to preview without changing files.

By default, the command selects mixed migrations strictly after the seed cutoff,
like reset. It resolves the cutoff from an optional timestamp argument, then the
latest common local/linked migration version, then the configured fallback.
`--env <name>` selects the environment-specific fallback. This command does not
save the cutoff or run `supabase link`; link the project separately if automatic
history detection is needed. If detection fails and no fallback is configured,
it stops.

`--all` explicitly includes mixed migrations at or before the cutoff too and skips
cutoff resolution. It cannot be combined with a timestamp argument. The applied
remote-history check still protects every file the rewrite would touch.

## Preview and apply

The preview shows each mixed migration and the replacement filenames. The planner separates the SQL into ordered schema/data segments and renumbers migrations from the earliest affected version; later migration files may also be renumbered to preserve ordering. Original affected files are kept in a backup directory under `supabase/.tmp-migrations`.

```bash
supabee migration split --dry-run
supabee migration split
supabee migration split 20260101000000 --dry-run
supabee migration split --all --dry-run
supabee migration split --migrations-dir path/to/migrations
```

`--dry-run` previews the rewrite without prompting or writing files. Without it, the command applies the plan after confirmation. `--migrations-dir` selects the migration directory (default `supabase/migrations`). Review and commit the generated migration changes carefully.

Applying checks the linked project's migration history and refuses to rewrite any touched migration version already applied remotely. It also prompts for confirmation. Because renumbering changes migration history, use this only for migrations that have not been pushed/applied; coordinate with your team and review the full file diff before committing. If the SQL cannot be safely divided while preserving transaction semantics, the command stops and asks you to split it manually.

See [migration management](/docs/migrations/) for the workflow and safety considerations.

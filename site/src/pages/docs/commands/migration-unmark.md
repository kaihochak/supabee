---
layout: ../../../layouts/DocsLayout.astro
title: supabee migration unmark
description: Remove Supabee classification markers from migration files.
eyebrow: Command
---

Removes Supabee classification comments from migration files. By default, it presents the planned removals interactively.

It searches for the configured data and schema marker lines, reports affected files, then asks individually before removing markers. It does not alter the migration SQL statements or reclassify those files; removing a marker may cause future classification to rely on SQL evidence instead.

```bash
supabee migration unmark
supabee migration unmark --dry-run
supabee migration unmark --yes
```

`--dry-run` previews removals without writing; `--yes` removes all found markers without prompts; `--migrations-dir` changes the directory (default `supabase/migrations`).

Use `--dry-run` to inspect the candidate files first. Accepted edits remove only exact Supabee marker comment lines, preserving the rest of the file.

See [migration management](/docs/migrations/) and [`migration mark`](/docs/commands/migration-mark/).

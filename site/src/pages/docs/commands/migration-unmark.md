---
layout: ../../../layouts/DocsLayout.astro
title: supabee migration unmark
description: Remove Supabee classification markers from migration files.
eyebrow: Command
---

Removes Supabee classification comments from migration files. By default, it presents the planned removals interactively.

```bash
supabee migration unmark
supabee migration unmark --dry-run
supabee migration unmark --yes
```

`--dry-run` previews removals without writing; `--yes` removes all found markers without prompts; `--migrations-dir` changes the directory (default `supabase/migrations`).

See [migration management](/docs/migrations/) and [`migration mark`](/docs/commands/migration-mark/).

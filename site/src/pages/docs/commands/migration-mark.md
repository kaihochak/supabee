---
layout: ../../../layouts/DocsLayout.astro
title: supabee migration mark
description: Add classification markers to migration files based on audit results.
eyebrow: Command
---

Adds marker comments to migrations classified by Supabee. By default, it presents suggested changes interactively.

```bash
supabee migration mark
supabee migration mark --dry-run
supabee migration mark --yes
```

`--dry-run` previews edits without writing; `--yes` applies all suggested marker updates without prompts; `--migrations-dir` changes the directory (default `supabase/migrations`). Review [`migration audit`](/docs/commands/migration-audit/) first.

See [migration management](/docs/migrations/).

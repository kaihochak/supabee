---
layout: ../../../layouts/DocsLayout.astro
title: supabee migration mark
description: Add classification markers to migration files based on audit results.
eyebrow: Command
---

Adds marker comments to migrations classified by Supabee. By default, it presents suggested changes interactively.

The command classifies the files first and proposes a marker only where it has a data/schema recommendation. It skips mixed migrations, which need to be split, and unknown files, which have no confident automatic classification. The marker text is configurable in `supabee.config.json`; defaults are documented in [migration management](/docs/migrations/).

```bash
supabee migration mark
supabee migration mark --dry-run
supabee migration mark --yes
```

`--dry-run` previews edits without writing; `--yes` applies all suggested marker updates without prompts; `--migrations-dir` changes the directory (default `supabase/migrations`). Review [`migration audit`](/docs/commands/migration-audit/) first.

Without `--yes`, the command asks separately for each proposed marker and writes only the changes you accept. It prepends the marker to the migration file (preserving a UTF-8 byte-order mark if present). These edits change migration files, so inspect the diff and ensure the migrations have not already been applied remotely before committing.

See [migration management](/docs/migrations/).

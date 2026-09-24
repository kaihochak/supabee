---
layout: ../../../layouts/DocsLayout.astro
title: supabee migration audit
description: Classify migration files and show suggested marker actions without changing them.
eyebrow: Command
---

Analyzes migration SQL and classifies each migration as data, schema, mixed, or unknown. It reports suggested marker changes used by post-seed migration handling; audit itself does not edit files.

```bash
supabee migration audit
supabee migration audit --migrations-dir path/to/migrations --verbose
supabee migration audit --json
```

`--migrations-dir` selects the directory (default `supabase/migrations`); `--verbose` includes classifier evidence; `--json` emits machine-readable output.

See [migration management](/docs/migrations/) and the related [`mark`](/docs/commands/migration-mark/) and [`unmark`](/docs/commands/migration-unmark/) commands.

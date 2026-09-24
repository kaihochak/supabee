---
layout: ../../../layouts/DocsLayout.astro
title: supabee migration audit
description: Classify migration files and show suggested marker actions without changing them.
eyebrow: Command
---

Analyzes migration SQL and classifies each migration as data, schema, mixed, or unknown. It reports suggested marker changes used by post-seed migration handling; audit itself does not edit files.

The classifier combines explicit marker comments with SQL evidence. `--verbose` shows the marker, DDL, and DML evidence lines that informed each result. Explicit markers can label a migration as data or schema; mixed files are reported for manual separation, while unknown files receive no automatic marker recommendation.

```bash
supabee migration audit
supabee migration audit --migrations-dir path/to/migrations --verbose
supabee migration audit --json
```

`--migrations-dir` selects the directory (default `supabase/migrations`); `--verbose` includes classifier evidence; `--json` emits machine-readable output.

The JSON response includes the migration path and timestamp, classification source and reasons, recommended action, marker presence, summary counts, and—when verbose—evidence details. This makes audit useful as a review step before marking migrations or enforcing strict mixed-migration handling in reset/start.

See [migration management](/docs/migrations/) and the related [`mark`](/docs/commands/migration-mark/) and [`unmark`](/docs/commands/migration-unmark/) commands.

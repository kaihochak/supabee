---
layout: ../../layouts/DocsLayout.astro
title: Migration management
description: Detect cutoffs, audit SQL classifications, and split migrations that mix schema and data operations.
eyebrow: Workflows
---

For command options and examples, see [`migration audit`](/docs/commands/migration-audit/), [`migration mark`](/docs/commands/migration-mark/), [`migration unmark`](/docs/commands/migration-unmark/), and [`migration split-mixed`](/docs/commands/migration-split-mixed/).

Supabee classifies migration files as `schema`, `data`, `mixed`, or `unknown`. Classification is based on SQL patterns and can be overridden with marker comments.

## Audit migrations

Review the current classifications and suggested actions:

```bash
supabee migration audit
supabee migration audit --verbose
```

Use JSON output for scripts and CI:

```bash
supabee migration audit --json
```

## Add or remove markers

Add suggested classification markers interactively:

```bash
supabee migration mark
```

Preview changes or apply them non-interactively:

```bash
supabee migration mark --dry-run
supabee migration mark --yes
```

Remove existing markers with the equivalent `unmark` workflow:

```bash
supabee migration unmark
supabee migration unmark --dry-run
```

## Split mixed migrations

A post-cutoff migration containing both schema changes and data mutations cannot be safely moved as one unit. Preview Supabee's rewrite plan:

```bash
supabee migration split-mixed
```

Apply the plan after interactive confirmation:

```bash
supabee migration split-mixed --apply
```

## Detect the cutoff

When no timestamp is provided, Supabee compares local and linked migration histories and selects the latest migration version present in both.

```bash
supabee cutoff detect
supabee cutoff detect --env staging
supabee cutoff detect 20260309180959 --json
```

When linked detection succeeds, the result is saved to `postSeedCutoff` or the matching `postSeedCutoffByEnv` entry in `supabee.config.json`.

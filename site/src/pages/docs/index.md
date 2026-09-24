---
layout: ../../layouts/DocsLayout.astro
title: Documentation
description: Learn how Supabee organizes Supabase schema, seed data, and migration workflows.
eyebrow: Supabee docs
---

Supabee is a focused orchestration layer around the Supabase CLI. It keeps generated SQL reviewable and handles the awkward ordering between historical seed data and newer migrations.

## Main workflows

### Synchronize a linked project

Dump the current schema or data, split it into organized files, reconstruct it, and validate the result.

```bash
supabee sync schema
supabee sync data
```

### Rebuild your database predictably

Reset the database while temporarily deferring migrations that must run after seed data.

```bash
supabee db reset
```

### Start local Supabase

Start the local stack with the same post-seed migration handling.

```bash
supabee start
```

## How commands are organized

| Area | Commands | Purpose |
| --- | --- | --- |
| Setup | `init` | Configure Supabee and seed paths |
| Linked dumps | `sync schema`, `sync data` | Pull and process linked project dumps |
| Processing | `schema`, `data` | Process existing SQL dump files |
| Database | `db reset`, `db seed-remote`, `start` | Rebuild, seed, and start databases |
| Migrations | `migration *`, `cutoff detect` | Audit and organize migration replay |

Continue with [Getting started](/docs/getting-started/) to install Supabee and configure your first project.

For details on each CLI command, see the [command reference](/docs/command-reference/). It links to dedicated pages for usage, options, and examples; the workflow guides above remain the overview of how commands work together.

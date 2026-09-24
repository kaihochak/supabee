---
layout: ../../layouts/DocsLayout.astro
title: Getting started
description: Install Supabee, initialize your project, and run your first schema and data sync.
eyebrow: Start here
---

## Prerequisites

- Node.js 20.11 or newer
- The Supabase CLI installed and authenticated
- An existing Supabase project with a `supabase/` directory

## Install Supabee

Install it globally for direct use:

```bash
npm install -g supabee
```

You can also run it without installing globally:

```bash
npx supabee --help
```

## Initialize the project

See the [`supabee init` command reference](/docs/commands/init/) for exactly what it changes.

From your project root, run:

```bash
supabee init
```

This creates `supabee.config.json` when it is missing and updates the `[db.seed].sql_paths` setting in `supabase/config.toml`.

## Link Supabase

Supabee uses the linked Supabase project for synchronization and automatic cutoff detection.

```bash
supabase link
```

## Run your first sync

See the [`sync schema`](/docs/commands/sync-schema/) and [`sync data`](/docs/commands/sync-data/) command references for options and path overrides.

```bash
supabee sync schema
supabee sync data
```

Both commands run the complete **dump → split → reconstruct → validate** workflow. The resulting files are designed to be committed and reviewed in Git.

> Before running a remote reset, read the database lifecycle guide. Remote resets wipe the target database and require explicit confirmation.

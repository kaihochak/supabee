---
layout: ../../layouts/DocsLayout.astro
title: Command reference
description: Find a command by name, with dedicated guides for its behavior, options, and examples.
eyebrow: Reference
---

Choose a command below for its full behavior, options, and examples. The workflow guides explain how the commands fit together.

## Setup

- [`supabee init`](/docs/commands/init/)

## Schema and data

- [`supabee sync schema`](/docs/commands/sync-schema/)
- [`supabee sync data`](/docs/commands/sync-data/)

## Database lifecycle

- [`supabee start`](/docs/commands/start/)
- [`supabee db reset`](/docs/commands/db-reset/)
- [`supabee db seed-remote`](/docs/commands/db-seed-remote/)

## Migration utilities

- [`supabee cutoff detect`](/docs/commands/cutoff-detect/)
- [`supabee migration audit`](/docs/commands/migration-audit/)
- [`supabee migration mark`](/docs/commands/migration-mark/)
- [`supabee migration unmark`](/docs/commands/migration-unmark/)
- [`supabee migration split-mixed`](/docs/commands/migration-split-mixed/)

## Other Supabase commands

Commands Supabee does not own (such as `supabase migration up` and `supabase db dump`) are forwarded to the Supabase CLI. See [Supabase CLI documentation](https://supabase.com/docs/reference/cli).

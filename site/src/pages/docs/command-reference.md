---
layout: ../../layouts/DocsLayout.astro
title: Command reference
description: A compact reference for every Supabee command and the most important options.
eyebrow: Reference
---

## Setup

### `supabee init`

Creates configuration when missing and updates Supabase seed paths.

## Schema and data

### `supabee schema [step]`

### `supabee data [step]`

Run the full processing chain when `step` is omitted. Supported steps are `split`, `reconstruct`, and `validate`.

| Option | Purpose |
| --- | --- |
| `--input <path>` | Override the input dump or split folder |
| `--output <path>` | Override the split directory or reconstructed file |
| `--backup` | Back up existing split output before replacing it |
| `--no-backup` | Replace dirty split output without a backup |

## Synchronization

### `supabee sync schema`

### `supabee sync data`

Dump from the linked project and run the full processing chain. These accept the schema/data options above plus `--force` to skip migration-alignment preflight.

## Database

### `supabee db reset [cutoffTimestamp]`

| Option | Purpose |
| --- | --- |
| `--linked` | Reset the linked remote project with resumable seeding |
| `--db-url <url>` | Target an explicit Postgres connection string |
| `--yes` | Skip remote-reset confirmation |
| `--resumable-seed` | Load seed files individually through `psql` |
| `--keep-triggers` | Keep triggers and FK checks active during direct seeding |
| `--psql` | Reapply deferred migrations with raw `psql` |
| `--strict-mixed` | Fail when any mixed migration is detected |
| `--env <name>` | Select an environment-specific cutoff fallback |

### `supabee db seed-remote`

| Option | Purpose |
| --- | --- |
| `--db-url <url>` | Postgres connection string |
| `--from <file>` | Resume from a seed file, inclusively |
| `--dry-run` | Print the ordered seed queue |
| `--keep-triggers` | Keep triggers and FK checks active |

### `supabee start [cutoffTimestamp]`

Starts Supabase with post-seed migration handling. Supports `--psql`, `--strict-mixed`, `--migrations-dir`, `--temp-dir`, and `--env`.

## Migration tools

```bash
supabee cutoff detect [cutoffTimestamp]
supabee migration audit
supabee migration mark
supabee migration unmark
supabee migration split-mixed
```

Use `--json` for machine-readable cutoff and audit output, `--dry-run` to preview marker changes, and `--apply` to execute a mixed-migration split plan.

## Supabase passthrough

Commands Supabee does not own are forwarded to the Supabase CLI:

```bash
supabee migration up  # runs supabase migration up
supabee db dump       # runs supabase db dump
```

## Help and version

```bash
supabee --help
supabee <command> --help
supabee --version
```

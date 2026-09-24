---
layout: ../../../layouts/DocsLayout.astro
title: supabee sync data
description: Dump linked project data and split it into ordered per-table seed files.
eyebrow: Command
---

Runs `supabase db dump --data-only`, then splits, reconstructs, and validates the dump. Use `--no-sync` to skip the dump and process an existing local data file instead. Seed files are ordered for loading and organized by table; large tables can be split into chunks according to configuration.

## What happens

1. Unless `--no-sync` is set, Supabee checks that the latest valid local and linked-project migration versions match. Use `--force` to bypass the preflight when you have verified the mismatch is intentional.
2. It runs `supabase db dump --data-only` and writes the dump to the configured data input path. An empty dump aborts before split output is replaced.
3. It groups inserts by table, writes ordered seed files within the configured size limits, reconstructs them into one SQL file, and validates the reconstruction against the dump.

```bash
supabee sync data
supabee sync data --input path/to/data.sql --output path/to/seed-files
supabee sync data --no-sync --input path/to/existing-data.sql
```

By default, requires a linked Supabase project. `--input` and `--output` override configured paths; `--backup` / `--no-backup` control replacement of existing split output. `--force` skips migration-alignment preflight and cannot be combined with `--no-sync`.

| Option | Effect |
| --- | --- |
| `--input <path>` | Write the fresh dump here (default: `data.input`). |
| `--output <path>` | Write split seed files here (default: `data.output`). |
| `--backup` / `--no-backup` | Choose whether existing split output is backed up before replacement. |
| `--force` | Continue despite an unavailable or mismatched migration-alignment check. |
| `--no-sync` | Use the existing local SQL input and skip the linked migration check and dump. |

With `--no-sync`, `--input` is the existing source dump; without it, `--input` is where the linked-project dump is written. File-size limits and table-specific overrides are configured under `data` in `supabee.config.json`; see [configuration](/docs/configuration/). `data.reconstructed` sets the reconstruction path.

## Process an existing local dump

`--no-sync` still runs split → reconstruct → validate. For finer control over individual steps, use the equivalent top-level command:

```bash
supabee data
supabee data split --input path/to/data.sql --output path/to/seed-files
supabee data reconstruct
supabee data validate
```

For `data`, `--input` and `--output` depend on the step: split uses source file and seed directory; reconstruct uses split directory and combined SQL file; validate uses original and reconstructed SQL files. Defaults and chunking limits are configured under `data` in `supabee.config.json`.

See the [syncing workflow](/docs/syncing/#sync-data) and [configuration](/docs/configuration/).

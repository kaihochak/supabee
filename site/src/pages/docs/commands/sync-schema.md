---
layout: ../../../layouts/DocsLayout.astro
title: supabee sync schema
description: Dump the linked project's schema, split it into object files, reconstruct it, and validate the output.
eyebrow: Command
---

Runs `supabase db dump` against the linked project, then processes the resulting schema through split, reconstruct, and validation steps. Use `--no-sync` to skip the dump and process an existing local schema file instead.

## What happens

1. Unless `--no-sync` is set, Supabee runs `supabase migration list --linked` and compares the latest valid local and remote migration versions. If they differ, it stops before dumping to avoid syncing against an unexpected schema. `--force` bypasses this check.
2. It runs `supabase db dump` and writes the dump to the configured schema input path.
3. It splits SQL objects into ordered files, reconstructs them into one SQL file, then validates that reconstruction against the dump. An empty dump aborts before replacing split files.

```bash
supabee sync schema
supabee sync schema --input path/to/schema.sql --output path/to/split
supabee sync schema --no-sync --input path/to/existing-schema.sql
```

By default, requires a linked Supabase project. `--input` and `--output` override configured paths; `--backup` / `--no-backup` control replacement of existing split output. `--force` skips migration-alignment preflight and cannot be combined with `--no-sync`.

| Option | Effect |
| --- | --- |
| `--input <path>` | Write the fresh dump here (default: `schema.input` in `supabee.config.json`). |
| `--output <path>` | Write split objects here (default: `schema.output`). |
| `--backup` | Back up existing output before replacing it. |
| `--no-backup` | Do not back up existing output; overrides configured backup behavior. |
| `--force` | Continue if migration alignment cannot be verified or does not match. |
| `--no-sync` | Use the existing local SQL input and skip the linked migration check and dump. |

With `--no-sync`, `--input` is the existing source dump; without it, `--input` is the destination for the new linked-project dump. The split output path comes from `schema.output`, and reconstructed SQL from `schema.reconstructed`. Paths are relative to the project root unless absolute. Review and commit the split object files; the raw dump and reconstructed SQL are useful source/check artifacts.

## Process an existing local dump

`--no-sync` still runs the complete split → reconstruct → validate chain. For finer control over individual steps, use the equivalent top-level command:

```bash
supabee schema
supabee schema split --input path/to/schema.sql --output path/to/schema-files
supabee schema reconstruct
supabee schema validate
```

For `schema`, `--input` and `--output` depend on the step: split uses source file and split directory; reconstruct uses split directory and output SQL file; validate uses original and reconstructed SQL files. Defaults are configured under `schema` in `supabee.config.json`.

See the [syncing workflow](/docs/syncing/#sync-schema) and [configuration](/docs/configuration/).

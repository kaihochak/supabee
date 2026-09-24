---
layout: ../../../layouts/DocsLayout.astro
title: supabee cutoff detect
description: Resolve and inspect the post-seed migration cutoff Supabee will use.
eyebrow: Command
---

Resolves a cutoff from an explicit timestamp, linked local/remote migration alignment, or configured fallback. The output also reports migration alignment when available.

## Resolution order

1. An explicit timestamp positional argument wins.
2. Otherwise, Supabee uses the latest migration version shared by local files and the linked project.
3. If linked alignment cannot be resolved, it falls back to `postSeedCutoff` or `postSeedCutoffByEnv` in `supabee.config.json`.

The result includes the selected cutoff and its source. When it can read linked alignment, it also reports latest local, latest remote, and latest aligned versions. This command is read-only; it does not change migrations or the config file.

```bash
supabee cutoff detect
supabee cutoff detect 20260309180959
supabee cutoff detect --env staging --json
```

`--env <name>` selects a configured environment fallback. `--json` emits machine-readable output, including the cutoff source and alignment information.

Cutoff detection is used by [`supabee db reset`](/docs/commands/db-reset/) and [`supabee start`](/docs/commands/start/). See [configuration](/docs/configuration/#environment-specific-cutoffs).

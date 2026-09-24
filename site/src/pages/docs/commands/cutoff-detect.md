---
layout: ../../../layouts/DocsLayout.astro
title: supabee cutoff detect
description: Resolve and inspect the post-seed migration cutoff Supabee will use.
eyebrow: Command
---

Resolves a cutoff from an explicit timestamp, linked local/remote migration alignment, or configured fallback. The output also reports migration alignment when available.

```bash
supabee cutoff detect
supabee cutoff detect 20260309180959
supabee cutoff detect --env staging --json
```

`--env <name>` selects a configured environment fallback. `--json` emits machine-readable output, including the cutoff source and alignment information.

Cutoff detection is used by [`supabee db reset`](/docs/commands/db-reset/) and [`supabee start`](/docs/commands/start/). See [configuration](/docs/configuration/#environment-specific-cutoffs).

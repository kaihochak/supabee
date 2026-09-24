---
layout: ../../../layouts/DocsLayout.astro
title: supabee init
description: Initialize Supabee configuration and register seed files with Supabase.
eyebrow: Command
---

Creates `supabee.config.json` if it does not exist and updates `[db.seed].sql_paths` in `supabase/config.toml` to include Supabee's ordered split seed files.

```bash
supabee init
```

It preserves existing configuration and presents planned changes for review. Run it once when setting up a project, then again if the configured seed-file layout changes.

See [configuration](/docs/configuration/) and [getting started](/docs/getting-started/).

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-04-09

### Added
- Global-install-first usage docs with npm/pnpm/bun and one-off runner examples (`npx`, `pnpm dlx`, `bunx`)
- Supabase passthrough for unknown top-level commands and unknown `db` subcommands
- Automatic `supabase link` retry path for `db reset`/`start` auto-cutoff flows
- `postSeedCutoff` config support as persisted/fallback cutoff for CI and unlinked environments

### Fixed
- Auto-cutoff now resolves the latest common local/remote migration version even when remote history has gaps
- Migration list parsing now accepts both ASCII and Unicode table separators (`|` and `│`)

## [0.1.1] - 2025-03-28

### Fixed
- Removed `docs` from `files` list in package.json to keep the published package lean

## [0.1.0] - 2025-03-28

### Added
- `supabee init` command to update `supabase/config.toml` based on config
- `supabee schema` command to split, reconstruct, and validate schema dumps
- `supabee data` command to split, reconstruct, and validate data dumps
- Example configuration file (`supabee.config.example.json`)
- Full split -> reconstruct -> validate pipeline for each command

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-08-19

### Changed
- The linked-reset database URL prompt now directs IPv6 users to Direct connection and IPv4 users to Session pooler, while explicitly rejecting Transaction pooler port 6543.
- Migration classification now recognizes `CREATE OR REPLACE VIEW` and `CREATE OR REPLACE FUNCTION` as schema DDL.

## [0.6.0] - 2026-08-19

### Changed
- `supabee db reset --linked` now uses the resumable direct-`psql` seed workflow by default. It reads the direct port-5432 database URL from `SUPABASE_DB_URL` / `PGURI`, or securely prompts for it in an interactive terminal.

## [0.3.10] - 2026-06-15

### Added
- `db reset` / `db start` now warn by default when mixed schema+DML migrations at or before the cutoff will run as-is (compatibility mode). These are already applied on the linked remote, so they cannot be auto-split, and their embedded DML can collide with seed/dump rows (e.g. duplicate primary keys). Pass `--strict-mixed` to fail instead.

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

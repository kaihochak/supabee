# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release Please generates versioned entries. Preserve the detailed notes below when
reviewing the release PR, including migration requirements that generated summaries may omit.

## [Unreleased]

### Fixed
- Remote seeding now passes connection settings through a temporary PostgreSQL service file instead of placing a full URL in `PGDATABASE`, which caused `psql` to attempt a local socket connection. Passwords stay out of command arguments; temporary connection files are removed after success or failure.
- Data splitting preserves multiline SQL values containing semicolons, blank lines, and standard-conforming values ending in backslashes instead of truncating or corrupting seed rows.

### Changed
- The interactive linked-reset URL prompt now suggests a missing `/postgres` database or `sslmode=require` setting and asks `[Y/n]` before applying them. Existing settings and non-interactive URLs are preserved.

### Breaking Changes
- Remote resets using `--db-url` now use resumable file-by-file seeding automatically, matching `--linked`. Remote resets require `psql` and a Direct connection or Session pooler on port 5432. The existing `--resumable-seed` flag remains accepted for compatibility.

## [0.6.2] - 2026-09-04

### Fixed
- Data splitting preserves Unicode line and paragraph separators inside SQL values instead of converting them to newlines that invalidate JSON.
- Cutoff detection now accepts backtick-wrapped migration-list cells while retaining support for plain ASCII and Unicode tables.
- Remote seed resume hints no longer print database credentials or use angle-bracket placeholders that disappear in HTML-rendered terminals.
- Direct `psql` seeding keeps the database URL out of process arguments and redacts sensitive command diagnostics.

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

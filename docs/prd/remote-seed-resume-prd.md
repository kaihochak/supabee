# Remote Seed Resume PRD

> **Status: implemented.** Shipped as `supabee db seed-remote`, `supabee db reset --resumable-seed`, and the default remote workflow for `supabee db reset --linked`. This document reflects the as-built design; where it differs from the original MVP proposal, the change is noted inline.

## Overview
Provide a reliable remote seeding workflow for Supabase projects where `supabase db reset` seeding can time out on large datasets. The feature adds a resumable direct-`psql` seeding path and orchestrates it with the existing post-seed migration logic.

## Problem
The Supabase CLI seed step runs as one long operation and can hit the pooler/statement timeout on large split seed sets:
1. Failures happen late, wasting time.
2. A timeout mid-seed can leave the database **unhealthy** (the reset itself never finishes cleanly), so simply re-seeding does not recover it.
3. Recovery is manual and error-prone — re-running reseeds from the first file.

## Goals
1. A resumable remote seed command that runs split seed files directly against a remote database via `psql`.
2. A `db reset` mode that avoids the timeout-prone Supabase seed path while preserving the production-like ordering (defer post-cutoff migrations → reset → seed → reapply).
3. Keep failure recovery healthy: a timeout must never corrupt the schema, and resume must not duplicate rows.

## Key design decision: why a no-seed reset, not "resume onto a broken DB"
`supabase db reset` does drop schema → apply migrations → seed, all in one operation. A timeout during the seed leaves the reset half-finished (possible migration-history mismatch, hung locks, partial data). You cannot fix that by seeding alone.

So the resumable path **separates the two**:
1. `supabase db reset --no-seed` completes fast and leaves a **healthy, fully-migrated** schema (nothing long enough to time out).
2. Data is loaded afterwards via direct `psql`, file-by-file. This is the only long-running part, and if it times out the schema underneath is still healthy — so resuming just the data genuinely works.

## Commands

### `supabee db seed-remote` (core primitive, resumable)
1. Reads ordered seed files from `[db.seed].sql_paths` in `supabase/config.toml` (the same list Supabase seeds from), expanding globs in declared order, lexically sorted.
   - *Change from MVP:* the file list is derived from `config.toml` rather than hardcoded `seeds/split` / `seeds/institutions` paths, so it stays in sync with the project's own seed config.
2. Options:
   - `--db-url <url>`: Postgres connection string (falls back to `SUPABASE_DB_URL` / `PGURI` env).
     - *Change from MVP:* the connection is delivered via `--db-url` (env is a fallback) instead of a required `PGURI` env var, for consistency with `db reset --db-url`.
   - `--from <file>`: resume from this file (inclusive); matches by file name or relative path.
   - `--dry-run`: print the ordered queue and exit.
3. Each file runs atomically: `psql --single-transaction -v ON_ERROR_STOP=1 -f <file>`, streamed from disk, with `statement_timeout = 0` (`PGOPTIONS=-c statement_timeout=0`).
   - *Change from MVP:* atomic-per-file replaces the planned "conflict-tolerant INSERT rewrite". Because a timeout rolls the whole file back, resume re-runs the file cleanly with no duplicate rows — no SQL rewriting required.
4. By default the seeding session also sets `session_replication_role = replica`, disabling user triggers and FK enforcement during the load (added to `PGOPTIONS`). This matches `pg_dump`/`pg_restore` semantics and fixes two real failures seen on production-shaped seeds:
   - application triggers firing during seeding (e.g. an `auth.users` insert auto-creating a `profiles` row that FK-references a not-yet-seeded table);
   - cross-file FK ordering (a row referencing a table whose data is in a later seed file).
   `--keep-triggers` opts out and leaves triggers/FK checks live. Requires a role permitted to set `session_replication_role` (Supabase's `postgres` role normally is).
5. On failure, prints a credential-free `--from` resume command using a visible `YOUR_DATABASE_URL` placeholder.

### `supabee db reset --resumable-seed` / `--linked` (orchestrated path)
An explicit target uses `--db-url <url> --resumable-seed`. A linked target enables resumable seeding automatically and obtains a port-5432 URL from `SUPABASE_DB_URL` / `PGURI`, or a hidden interactive prompt. The prompt directs IPv6 users to Direct connection and IPv4 users to Session pooler. Flow:
1. Reuse existing cutoff resolution + defer/restore migration behavior.
2. Run `supabase db reset --db-url <url> --no-seed --yes`.
3. Run the `seed-remote` step.
4. Reapply deferred post-cutoff migrations (`supabase migration up --db-url <url> --yes`).
5. On seed failure: stop before the migration reapply, surface the `--from` resume command, and note that after seeding completes the post-cutoff migrations still need applying.

## CLI Interface
1. `supabee db seed-remote [--db-url <url>] [--from <file>] [--dry-run]`
2. `supabee db reset [cutoffTimestamp] --db-url <url> --resumable-seed [--yes]`
3. `supabee db reset [cutoffTimestamp] --linked [--yes]`

Notes:
- `--linked` prompts for the URL with hidden input and shows its hostname in the destructive confirmation. Non-interactive runs require `SUPABASE_DB_URL` or `PGURI`.
- `--resumable-seed` without a remote target fails with an actionable message.
- Use Direct connection (IPv6) or Session pooler (IPv4), both on port 5432. Transaction pooler on port 6543 is unsupported.
- Existing local `db reset` behavior is unchanged by default.

## One-off vs resumable trade-off
`db reset --linked` always uses the resumable path. The plain `db reset --db-url` path remains available for **smaller datasets** unless `--resumable-seed` is added. If a one-off seed times out, the database may be left unhealthy and the operator must reset the project / follow Supabase's recovery guidance. The resumable path does not attempt to rescue an already-broken one-off run.

## Acceptance Criteria (met)
1. Linked resets and explicit remote resets using `--resumable-seed` no longer depend on the Supabase seed timeout path.
2. A failed seed file resumes with `--from` and completes without manual file edits or duplicate rows.
3. Post-cutoff migration sequence remains: defer → reset (no-seed) → seed → reapply.
4. Existing non-remote `db reset` workflows remain backward-compatible.

## Validation
Verified end-to-end against a disposable Postgres (Docker) for both commands:
- ordered queue (`--dry-run`), full seed, and `--from` resume;
- **atomic rollback**: a file failing mid-way leaves none of its rows committed (schema stays healthy);
- full orchestration: `db reset --db-url --resumable-seed` runs no-seed reset → split-seed via psql → post-cutoff migration, in the correct order;
- orchestrated seed failure stops before the migration reapply and prints resume + follow-up guidance.
- linked URL input is hidden, malformed/non-5432 URLs are rejected, and cancellation occurs before database access.

## Known follow-ups
- [x] Redact connection strings in subprocess error output and keep direct `psql` connection URLs out of process arguments.
- `--strict` / non-strict modes from the original MVP were not needed: seeding always stops on the first failing file (the only safe default for a resumable workflow).

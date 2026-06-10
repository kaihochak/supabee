# Remote Seed Resume PRD (MVP)

## Overview
Add a reliable remote seeding workflow for Supabase projects where `supabase db reset --linked` seeding can timeout on large datasets. The feature provides a resumable direct-`psql` path and optional orchestration with existing post-seed migration logic.

## Problem
Current remote reset workflows can fail during seed execution due to pooler/statement timeout behavior in the Supabase CLI seed path. For large split seed sets:
1. Failures happen late, wasting time.
2. Recovery is manual and error-prone.
3. Teams lose the production-like ordering that `supabee db reset` provides (defer post-cutoff migrations, seed, then reapply post-cutoff).

## Goals
1. Provide a resumable remote seed command that runs split seed files directly against the linked remote database via `psql`.
2. Preserve current `supabee db reset` post-cutoff behavior and allow a timeout-safe remote-seed mode without waiting for Supabase seed timeout.
3. Keep operator UX simple and explicit.

## Non-Goals (MVP)
1. Auto-detect timeout text from Supabase CLI and recover implicitly.
2. Replace Supabase CLI reset/migration functionality.
3. Introduce automatic conflict-resolution beyond controlled resume behavior.

## User Workflow (Target)
Primary path:
1. Project is linked (`supabase link`) or auto-link path is used.
2. Operator runs a single reset command in remote-seed mode.
3. Tool performs reset without Supabase seeding, runs direct remote seeding, then reapplies deferred post-cutoff migrations.

Recovery path:
1. If remote seeding fails in file N, tool prints an exact resume command.
2. Operator reruns resume from failed file.

## Product Decision
Ship as two capabilities, with one recommended path:
1. Core primitive: `supabee db seed-remote` (standalone, resumable).
2. Orchestrated path: `supabee db reset ... --linked --seed-remote` (recommended daily operation).

Why:
- Standalone command is easy to test/debug and remains useful independently.
- Orchestrated mode gives one-command production-like ordering and avoids timeout path preemptively.

## MVP Scope
### 1) New command: `supabee db seed-remote`
Required behavior:
1. Reads ordered seed files from:
   - `supabase/seeds/split/*.sql`
   - `supabase/seeds/institutions/seeding_sql/*/*.seed.sql`
2. Supports:
   - `--from <basename>`: resume from this file (inclusive)
   - `--strict`: stop on first SQL error (`ON_ERROR_STOP=1`)
   - `--dry-run`: print ordered queue only
3. Requires connection input:
   - `PGURI` env var (MVP default)
4. Applies session options to disable statement timeout paths for long statements.
5. In resume mode, first resumed file uses conflict-tolerant handling for compatible `INSERT ... VALUES` statements to tolerate partial prior commits.
6. Emits clear per-file progress logs and final error summary.
7. On failure, prints copy-paste-ready resume command.

### 2) Extend existing command: `supabee db reset`
Required behavior for `--seed-remote` mode:
1. Reuse existing cutoff resolution + defer/restore migration behavior.
2. Execute `supabase db reset --linked --no-seed` (avoid timeout-prone seed path).
3. Execute `seed-remote` step.
4. Reapply deferred migrations using linked-project mode (`supabase migration up --linked` or equivalent selected apply mode).
5. Preserve current behavior when `--seed-remote` is not set.

## CLI Interface Changes
1. `supabee db seed-remote [options]`
   - `--from <file>`
   - `--strict`
   - `--dry-run`
2. `supabee db reset [cutoffTimestamp]`
   - add `--linked` (explicitly target linked remote reset path in this command)
   - add `--seed-remote` (use direct-psql remote seeding after reset)

Notes:
- If `--seed-remote` is provided without `--linked`, command fails with actionable message.
- Existing `db reset` local behavior remains unchanged by default.

## Acceptance Criteria
1. Large remote seed runs no longer depend on Supabase seed timeout path when `--seed-remote` is used.
2. A failed seeded file can be resumed with `--from` and completes without manual file edits.
3. Post-cutoff migration sequence remains: defer -> reset -> seed -> reapply.
4. Existing non-remote `supabee db reset` workflows remain backward-compatible.

## Test Plan
1. Unit tests:
   - file queue ordering
   - `--from` selection and not-found behavior
   - strict vs non-strict handling
   - resume-command rendering
2. Command integration (mocked subprocess):
   - `db reset --linked --seed-remote` invokes `supabase db reset --linked --no-seed`
   - deferred migration restore always executes on failures
3. Manual staging validation:
   - linked remote dry-run path
   - intentional SQL failure then resume
   - successful completion with deferred migrations reapplied

## Risks
1. Over-broad SQL rewrite during resume could alter non-INSERT statements.
2. `psql` availability/environment differences on contributor machines.
3. Ambiguity between local and linked reset semantics in CLI UX.

Mitigation:
1. Limit resume rewrite logic to compatible `INSERT ... VALUES` statements only.
2. Add upfront executable checks and precise setup docs.
3. Require explicit `--linked --seed-remote` combination.

## Milestones
1. M1: Add `db seed-remote` command with tests.
2. M2: Add `db reset --seed-remote` orchestration path.
3. M3: Update README usage guides and troubleshooting.
4. M4: Validate on a representative large dataset project.

## Rollout
1. Ship behind explicit flags (`db seed-remote`, `db reset --seed-remote`).
2. Keep current reset path as default.
3. Promote recommended command in docs after staging validation.

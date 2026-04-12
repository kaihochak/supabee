# Manual Test Plan: Data-Mutation Migration Workflow

Use this plan to validate `supabee` in a separate integration repository before publish and again after publish. The goal is to prove the practical difference between pure `Supabase` replay and using `supabee` for projects that have data-mutation migrations.

## Objective

Validate that `supabee` works end to end in a real external repo where:

- migrations include at least one dedicated data-only migration
- seed data exists and can conflict with historical data mutations
- reset/start behavior must remain stable across feature, staging, and production-style flows

This plan is intentionally manual. It is the release gate for workflow correctness, not just command smoke tests.

## Test Repo Requirements

Run this in a different repository, not in the `supabee` repo itself.

The target repository should have:

- a valid Supabase project setup
- `supabase/config.toml`
- at least one seed dataset or split seed path
- at least one migration that mutates data
- at least one case where a migration inserts rows that can later appear in a synced data snapshot

If the target repo does not already have a clean test case, add one first:

- a seeded reference table such as `statuses`
- a dedicated data-only migration (marker optional)
- a mutation that inserts rows into another table using the seeded reference row

Do not use a mixed schema-plus-data migration for this test. Mixed files must be split before reset/start testing.

## Environment Prerequisites

On the machine running the test:

- Node.js installed
- Supabase CLI installed and authenticated
- access to the integration repository
- access to the target Supabase project(s) used for staging or production-style validation

Record these values before starting:

- package version under test
- integration repository path
- staging project ref, if used
- production project ref, if used
- cutoff values or linked environments used during the run

## Phase 1: Pre-Publish Validation with Local Tarball

This phase proves the package before it is published.

### 1. Build and pack Supabee

In the `supabee` repo:

```bash
npm install
npm run typecheck
npm run build
npm run test
npm run pack:check
npm_config_cache=.npm-cache npm pack
```

Expected result:

- all commands succeed
- a `.tgz` tarball is created

Record:

- tarball filename
- git commit SHA under test

### 2. Install the tarball into the integration repo

In the separate repo:

```bash
npm install /absolute/path/to/supabee-<version>.tgz
npx supabee --help
```

Expected result:

- install succeeds without missing files or broken entrypoints
- `npx supabee --help` shows the expected commands, including `cutoff detect`

Record:

- install method used
- CLI help output screenshot or terminal capture

## Phase 2: CLI Surface and Config Validation

### 3. Validate `init`

In the integration repo:

```bash
npx supabee init
```

Expected result:

- `supabee.config.json` exists if it did not exist already
- generated or updated config includes:
  - `postSeedCutoff`
  - `postSeedCutoffByEnv`
  - `dataMigrationMarker`
- `supabase/config.toml` is updated as expected for seed paths

Record:

- relevant config excerpt
- whether existing config was preserved correctly

### 3.1 Validate `migration audit` and `migration mark`

In the integration repo:

```bash
npx supabee migration audit
npx supabee migration mark
```

Expected result:

- `migration audit` prints per-file classification, reasons, and recommendations
- `migration mark` prompts and applies marker writes by default

Preview path:

```bash
npx supabee migration mark --dry-run
```

Expected result:

- no files are modified
- output lists planned marker additions

CI/scripted path:

```bash
npx supabee migration mark --yes
```

Expected result:

- non-interactive marker apply succeeds

Optional rollback path:

```bash
npx supabee migration unmark --dry-run
npx supabee migration unmark --yes
```

Expected result:

- dry-run shows marker removals without writes
- `--yes` removes marker lines non-interactively

### 4. Validate `cutoff detect`

Run both explicit and environment-aware variants:

```bash
npx supabee cutoff detect 20260309180959
npx supabee cutoff detect --env staging
npx supabee cutoff detect --env staging --json
```

Expected result:

- explicit timestamp path resolves successfully
- environment-aware path resolves from linked project or config fallback
- JSON output is well-formed and includes cutoff source information

Record:

- resolved cutoff for each run
- whether source was `argument`, `linked`, or `config`

## Phase 3: Reset Behavior for a New Data-Mutation Migration

This validates the case where the data migration is still "new" relative to the chosen cutoff and must run after seeds.

### 5. Prepare the test state

Use or create:

- a seeded reference row such as `statuses.name = 'verified'`
- a dedicated migration file with DML-only logic (marker optional)
- a mutation that inserts dependent rows into another table

Example shape:

```sql
INSERT INTO domains (...)
SELECT ...
FROM statuses
WHERE ...
```

Run audit before reset:

```bash
npx supabee migration audit
```

Expected result:

- target file is classified as `data`
- no `mixed` classifications for files that will be part of reset/start

Choose a cutoff before this migration timestamp.

### 6. Run `db reset`

```bash
npx supabee db reset <cutoff-before-migration>
```

Expected result:

- reset succeeds
- seeds load successfully
- the data migration is applied after seed load
- inserted rows exist after reset
- the migration file on disk is unchanged after the command completes

Record:

- cutoff used
- rows created by the migration
- confirmation that the migration file content was restored unchanged

## Phase 4: Historical Data-Mutation Behavior

This validates the case where the data mutation is already represented in the current dataset and should not be replayed as a live historical mutation during reset.

### 7. Prepare the historical state

Create or obtain a dataset where the effect of the data migration is already present.

Examples:

- dump data from staging after the data mutation has already been deployed there
- or create an equivalent local seed snapshot that already contains those rows

Ensure the chosen environment or cutoff treats the data migration as historical for that reset.

### 8. Run `db reset` against the historical state

Use one of these patterns:

```bash
npx supabee db reset --env staging
```

or

```bash
npx supabee db reset <historical-cutoff>
```

Expected result:

- reset succeeds
- no duplicate key error from historical data rows
- no foreign key failure caused by replaying historical data mutation too early
- final data state is correct
- migration SQL on disk is restored after the command completes

Record:

- environment or cutoff used
- confirmation that no duplicate row was created
- confirmation that the migration file was not left modified

## Phase 5: `start` Parity

### 9. Validate `start`

Run:

```bash
npx supabee start --env staging
```

Expected result:

- behavior matches the `db reset` orchestration model
- no persistent mutation is left in migration files

Record:

- whether startup completed
- whether historical/new data-migration handling matched expectations

## Phase 6: Sync Guardrail

This validates that data sync is treated as a dataset workflow rather than just a dump command.

### 10. Validate aligned sync

In a state where local and remote migrations are aligned:

```bash
npx supabee sync data
```

Expected result:

- sync proceeds normally

### 11. Validate misaligned sync failure

In a state where local and remote migrations are intentionally not aligned:

```bash
npx supabee sync data
```

Expected result:

- command fails before dump processing
- failure clearly indicates migration alignment mismatch

### 12. Validate forced override

```bash
npx supabee sync data --force
```

Expected result:

- sync proceeds despite the alignment warning

Record for steps 10-12:

- aligned or misaligned state used
- exact command behavior
- whether `--force` behaved as documented

## Phase 7: Post-Publish Validation with `latest`

This phase proves that the published package behaves the same as the tarball.

### 13. Publish the package

In the `supabee` repo:

```bash
npm publish --access public
```

Record:

- published version
- npm package URL

### 14. Re-test in the integration repo using `latest`

In a fresh clone or clean branch of the integration repo:

```bash
npm install --save-dev supabee@latest
npx supabee --help
npx supabee cutoff detect --env staging
```

Re-run at minimum:

- `init`
- `migration audit`
- `cutoff detect`
- one successful `db reset` case for a new data migration
- one successful `db reset` case for a historical data migration
- one `sync data` alignment test

Expected result:

- published package behavior matches the tarball-tested behavior

## Pass / Fail Criteria

The release is ready only if all of the following are true:

1. Tarball install works in another repo.
2. Published `latest` install works in another repo.
3. `cutoff detect` behaves correctly for explicit and environment-aware cases.
4. New data migrations run successfully after seeds.
5. Historical data migrations do not cause duplicate or ordering failures during reset/start.
6. Migration files are unchanged on disk after every `db reset` and `start` run.
7. Sync alignment preflight blocks unsafe sync by default and allows explicit override with `--force`.

Any failure in those areas blocks publish or requires a follow-up patch release.

## Evidence to Keep

Capture these artifacts for the release record:

- package version and commit SHA
- tarball filename
- terminal capture for `npx supabee --help`
- terminal capture for `cutoff detect`
- terminal capture for successful new-migration reset
- terminal capture for successful historical-migration reset
- terminal capture for `migration audit` classification output
- terminal capture for sync preflight failure and `--force` override
- confirmation that migration files were restored unchanged after reset/start

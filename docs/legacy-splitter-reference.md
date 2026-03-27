# Legacy Splitter Reference (Baseline)

This document defines the **old/legacy splitter method** currently implemented inside `courseRater`, and is the baseline for parity checks against `supabase-splitter`.

## Source of Truth (Legacy)

- Schema splitter script: `supabase/schemas/schema-splitter.js`
- Seed splitter script: `supabase/seeds/seed-splitter.js`

## How Main Source Files Are Produced (From Production)

Splitting only works after generating fresh source files from production.

```bash
# generate main schema source used by schema splitter
supabase db dump > supabase/schemas/prod-schemas.sql

# generate main data source used by seed splitter
supabase db dump --data-only > supabase/seeds/prod-data.sql
```

Precondition: Supabase CLI is already linked to the target project.

## Legacy Schema Splitter

Note: split schema files are primarily for declarative organization/workflows.  
If project reset is migration-driven, Supabase applies `supabase/migrations/*.sql` unless `[db.migrations].schema_paths` is configured.

### Command

```bash
# full flow: split + reconstruct + validate
node supabase/schemas/schema-splitter.js

# split only
node supabase/schemas/schema-splitter.js --split

# reconstruct/validate only
node supabase/schemas/schema-splitter.js --reconstruct
```

### Default Inputs/Outputs

- Input: `supabase/schemas/prod-schemas.sql`
- Output root: `supabase/schemas/`
- Split folders: `00_extensions` … `12_others`
- Reconstructed file: `supabase/schemas/reconstructed.sql`
- Order index: `supabase/schemas/order-index.json`

### Legacy Behavior Summary

- Splits SQL statements by category/folder using regex classification.
- Preserves original statement line-range metadata in each split file header.
- Generates `order-index.json` to retain original statement order.
- Reconstructs SQL from split files and validates by MD5 hash match.

## Legacy Seed Splitter

### Command

```bash
# default input path
node supabase/seeds/seed-splitter.js

# custom input path
node supabase/seeds/seed-splitter.js /path/to/seed.sql
```

### Default Inputs/Outputs

- Default input: `supabase/seeds/prod-data.sql`
- Output dir: `supabase/seeds/data/`
- Standard files:
  - `001_setup.sql`
  - numbered table files (e.g. `002_public_states.sql`)
  - optional `*_sequences.sql`
  - `999_cleanup.sql`
- Existing `800_refresh_materialized_view.sql` is intentionally preserved during cleanup.

### Legacy Behavior Summary

- Parses `INSERT INTO schema.table` statements and groups by table.
- Writes ordered split files in `supabase/seeds/data/`.
- Has special chunking logic for large `cities` inserts.
- Includes setup (`session_replication_role='replica'`) and cleanup (`RESET ALL`) wrappers.
- Reconstructs `reconstructed.seed.sql` from split files and validates row-count/sequence parity against the source seed.

## Important Safety Note

`seed-splitter.js` removes most existing `supabase/seeds/data/*.sql` files before re-writing outputs.  
If the input seed file is missing, the script can fail after cleanup.

## Legacy Verification (Must Pass Before Cleanup)

1. Run legacy schema splitter full flow.
2. Confirm reconstruction hash matches `prod.sql`.
3. Run legacy seed splitter with real baseline seed input.
4. Confirm expected seed files are regenerated.
5. Confirm `supabase db reset` works with generated legacy outputs.

## Parity Target for `supabase-splitter`

`supabase-splitter` passes parity when it matches legacy behavior for:

- schema split/reconstruct/validate correctness
- seed split ordering and loadability
- successful `supabase db reset` using generated seed outputs

# Internal RC Checklist

Use this checklist before publishing `supabee` to npm.

## Build + Package

- `npm install`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run pack:check`

## Tarball Install Validation

1. Create package tarball:
   - `npm_config_cache=.npm-cache npm pack`
2. In a clean test workspace:
   - `npm install /absolute/path/to/supabee-<version>.tgz`
3. Validate command entry:
   - `npx supabee --help`

## Behavior Parity Checks

- `npx supabee init`
- `npx supabee schema` (full chain)
- `npx supabee data` (full chain)
- Verify backup behavior:
  - dirty output fails fast without `--backup`
  - `--backup` creates timestamped backup folder
  - configured `keepFiles` are restored into fresh split output
- Verify reconstruction/validation:
  - schema validate matches checksum for equivalent files
  - data validate matches row-count + sequence semantics

## Docs + Release Readiness

- README commands/examples match current CLI output.
- PRD terminology matches `schema` / `data` command contract.
- `CHANGELOG`/release notes drafted for target version.
- Publish command ready:
  - `npm publish --access public`

# Contributing

Thanks for contributing to `supabee`.

## Development Setup

1. Install Node.js 20.11+ for the CLI, or Node.js 24 to work on both the CLI and docs website.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run quality checks:
   ```bash
   npm run typecheck
   npm run build
   npm run test
   npm run pack:check
   ```

## Pull Requests

1. Keep changes focused and small.
2. Update docs when behavior or flags change.
3. Ensure all checks pass before opening a PR.
4. Include a short summary of behavior changes and any migration notes.

## Releases

See [Publishing](docs/publishing.md) for npm trusted publisher setup, version-tag releases, and the independent docs website workflow.

## Reporting Bugs

Open an issue with:
- Repro steps
- Expected behavior
- Actual behavior
- Node.js version and OS

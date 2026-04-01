# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

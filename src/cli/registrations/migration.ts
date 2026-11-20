import type { Command } from 'commander';
import {
  runMigrationAuditCommand, runMigrationMarkCommand, runMigrationUnmarkCommand, runMigrationSplitCommand,
  type MigrationAuditOptions, type MigrationMarkOptions, type MigrationUnmarkOptions, type MigrationSplitOptions,
} from '../../commands/migration.js';

export function registerMigrationCommand(program: Command): void {
  const migrationCommand = program.command('migration').description('Migration classification helpers');

  migrationCommand
    .command('audit')
    .description('Classify migrations as data/schema/mixed/unknown and show suggested marker actions')
    .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
    .option('--json', 'Print machine-readable audit output')
    .option('--verbose', 'Include detailed classifier evidence in output')
    .action((options: MigrationAuditOptions = {}) => runMigrationAuditCommand(options));

  migrationCommand
    .command('mark')
    .description('Add marker comments to classified migration files (interactive by default)')
    .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
    .option('--dry-run', 'Preview marker updates without writing files')
    .option('--yes', 'Apply all suggested marker updates without interactive prompts')
    .action((options: MigrationMarkOptions = {}) =>
      runMigrationMarkCommand(options),
    );

  migrationCommand
    .command('unmark')
    .description('Remove marker comments from migration files (interactive by default)')
    .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
    .option('--dry-run', 'Preview marker removals without writing files')
    .option('--yes', 'Remove all found marker updates without interactive prompts')
    .action((options: MigrationUnmarkOptions = {}) => runMigrationUnmarkCommand(options));

  migrationCommand
    .command('split [cutoffTimestamp]')
    .description('Split mixed migrations after the seed cutoff; --all includes every mixed migration')
    .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
    .option('--dry-run', 'Preview planned rewrites without changing files')
    .option('--all', 'Include mixed migrations at or before the cutoff too')
    .option('--env <name>', 'Environment key used for postSeedCutoffByEnv fallback lookup')
    .action((cutoffTimestamp: string | undefined, options: MigrationSplitOptions = {}) =>
      runMigrationSplitCommand(cutoffTimestamp, options),
    );
}

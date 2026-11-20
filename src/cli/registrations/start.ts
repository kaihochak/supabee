import type { Command } from 'commander';
import { runStartCommand, type PostSeedCommandOptions } from '../../commands/db-reset.js';

export function registerStartCommand(program: Command): void {
  program
    .command('start [cutoffTimestamp]')
    .description('Start Supabase with deferred post-seed migrations applied after startup')
    .option('--psql', 'Apply deferred migrations via raw psql instead of supabase migration up')
    .option('--strict-mixed', 'Fail when any mixed schema+DML migration is detected (default: warn at/before cutoff, split/fail after cutoff)')
    .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
    .option('--temp-dir <path>', 'Temporary directory for deferred migrations', 'supabase/.tmp-migrations')
    .option('--env <name>', 'Environment key used for postSeedCutoffByEnv fallback lookup')
    .addHelpText(
      'after',
      `
What This Command Does
  1) Defers migrations with timestamps greater than [cutoffTimestamp]
  2) Runs \`supabase start\`
  3) Restores deferred migration files
  4) Reapplies deferred migrations

Examples
  supabee start 20260309180959
  supabee start
  supabee start --psql
`,
    )
    .action(
      (
        cutoffTimestamp: string | undefined,
        options: PostSeedCommandOptions = {},
      ) => runStartCommand(cutoffTimestamp, options),
    );
}

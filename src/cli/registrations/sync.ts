import type { Command } from 'commander';
import { runSchemaCommand } from '../../commands/schema.js';
import { runDataCommand } from '../../commands/data.js';
import { runSyncCommand } from '../../commands/sync.js';
import { buildStepArgs, type StepCliOptions } from '../step-args.js';

export function registerSyncCommand(program: Command): void {
  const syncCommand = program
    .command('sync')
    .description('Dump from a linked project, or use --no-sync to process a local dump')
    .addHelpText(
      'after',
      `
Main Usage
  supabee sync schema
  supabee sync data

Examples
  supabee sync schema
  supabee sync schema --no-sync --input path/to/schema.sql
  supabee sync data
  supabee sync data --no-sync --input path/to/data.sql

Note
  Requires \`supabase link\` to be configured for this project.
`,
    );

  syncCommand
    .command('schema')
    .description('Dump linked schema and process it (use --no-sync to process an existing dump)')
    .option('--no-sync', 'Process an existing local schema dump without calling Supabase')
    .option('--input <path>', 'Dump output path, or existing local schema dump with --no-sync')
    .option('--output <path>', 'Split output path override for schema processing')
    .option('--backup', 'Backup existing split output before replacing')
    .option('--no-backup', 'Do not backup dirty split output folder before split')
    .option('--force', 'Skip linked migration alignment preflight for sync')
    .action((options: StepCliOptions = {}) => {
      if (options.sync === false) {
        if (options.force) {
          console.error('--force cannot be used with --no-sync.');
          process.exitCode = 1;
          return;
        }
        return runSchemaCommand(buildStepArgs(undefined, undefined, options));
      }
      return runSyncCommand('schema', options);
    });

  syncCommand
    .command('data')
    .description('Dump linked data and process it (use --no-sync to process an existing dump)')
    .option('--no-sync', 'Process an existing local data dump without calling Supabase')
    .option('--input <path>', 'Dump output path, or existing local data dump with --no-sync')
    .option('--output <path>', 'Split output path override for data processing')
    .option('--backup', 'Backup existing split output before replacing')
    .option('--no-backup', 'Do not backup dirty split output folder before split')
    .option('--force', 'Skip linked migration alignment preflight for sync')
    .action((options: StepCliOptions = {}) => {
      if (options.sync === false) {
        if (options.force) {
          console.error('--force cannot be used with --no-sync.');
          process.exitCode = 1;
          return;
        }
        return runDataCommand(buildStepArgs(undefined, undefined, options));
      }
      return runSyncCommand('data', options);
    });
}

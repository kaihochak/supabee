#!/usr/bin/env node

import { Command } from 'commander';
import { runSchemaCommand } from './commands/schema.js';
import { runDataCommand } from './commands/data.js';
import { runInitCommand } from './commands/init.js';
import { runSyncCommand } from './commands/sync.js';
import { runDbResetCommand, runStartCommand } from './commands/db-reset.js';
import { error as errText } from './lib/ui.js';

type StepCliOptions = {
  input?: string;
  output?: string;
  backup?: boolean;
};

function buildStepArgs(step?: string, reconstructed?: string, options: StepCliOptions = {}): string[] {
  const args: string[] = [];
  if (step) args.push(step);
  if (options.input) args.push('--input', options.input);
  if (options.output) args.push('--output', options.output);
  if (options.backup === false) {
    args.push('--no-backup');
  } else if (options.backup) {
    args.push('--backup');
  }
  if (reconstructed) args.push(reconstructed);
  return args;
}

const program = new Command();
program
  .name('supabee')
  .description('Supabase sync and migration orchestration CLI.')
  .showHelpAfterError('(run with --help for usage)')
  .addHelpText(
    'after',
    `
Main Workflows
  supabee sync schema
  supabee sync data
  supabee db reset [cutoff_timestamp]
  supabee start [cutoff_timestamp]

Setup (once per project)
  supabee init
  supabase link

Examples
  supabee sync schema
  supabee sync data
  supabee db reset 20260309180959
  supabee start 20260309180959

Manual Processing (existing dump files)
  supabee schema
  supabee data
`,
  );

program
  .command('init')
  .description('Create config (if missing) and update supabase/config.toml seed paths')
  .action(async () => {
    await runInitCommand([]);
  });

for (const commandName of ['schema', 'data']) {
  program
    .command(`${commandName} [step] [reconstructed]`)
    .description(`${commandName} split/reconstruct/validate (full chain when step is omitted)`)
    .option('--input <path>', 'Input SQL file or split folder (reconstruct)')
    .option('--output <path>', 'Split output folder (split) or reconstructed file')
    .option('--backup', 'Backup existing split output before replacing')
    .option('--no-backup', 'Do not backup dirty split output folder before split')
    .action(async (step?: string, reconstructed?: string, options: StepCliOptions = {}) => {
      const forwarded = buildStepArgs(step, reconstructed, options);
      if (commandName === 'schema') {
        await runSchemaCommand(forwarded);
        return;
      }
      await runDataCommand(forwarded);
    });
}

const syncCommand = program
  .command('sync')
  .description('Dump from linked project, then split/reconstruct/validate')
  .addHelpText(
    'after',
    `
Main Usage
  supabee sync schema
  supabee sync data

Examples
  supabee sync schema
  supabee sync data --input supabase/seeds/prod-data.sql
  supabee sync data --no-backup

Note
  Requires \`supabase link\` to be configured for this project.
`,
  );

syncCommand
  .command('schema')
  .description('Run `supabase db dump`, then process schema files')
  .option('--input <path>', 'Dump output path (defaults to schema.input from config)')
  .option('--output <path>', 'Split output path override for schema processing')
  .option('--backup', 'Backup existing split output before replacing')
  .option('--no-backup', 'Do not backup dirty split output folder before split')
  .action(async (options: StepCliOptions = {}) => {
    await runSyncCommand('schema', options);
  });

syncCommand
  .command('data')
  .description('Run `supabase db dump --data-only`, then process data files')
  .option('--input <path>', 'Dump output path (defaults to data.input from config)')
  .option('--output <path>', 'Split output path override for data processing')
  .option('--backup', 'Backup existing split output before replacing')
  .option('--no-backup', 'Do not backup dirty split output folder before split')
  .action(async (options: StepCliOptions = {}) => {
    await runSyncCommand('data', options);
  });

const dbCommand = program.command('db').description('Database orchestration commands');

dbCommand
  .command('reset [cutoffTimestamp]')
  .description('Reset DB, then apply deferred post-seed migrations (auto cutoff if omitted)')
  .option('--psql', 'Apply deferred migrations via raw psql instead of supabase migration up')
  .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
  .option('--temp-dir <path>', 'Temporary directory for deferred migrations', 'supabase/.tmp-migrations')
  .addHelpText(
    'after',
    `
What This Command Does
  1) Defers migrations with timestamps greater than <cutoffTimestamp>
  2) Runs \`supabase db reset\`
  3) Restores deferred migration files
  4) Reapplies deferred migrations

Examples
  supabee db reset 20260309180959
  supabee db reset
  supabee db reset 20260309180959 --psql
`,
  )
  .action(
    async (
      cutoffTimestamp: string | undefined,
      options: { psql?: boolean; migrationsDir?: string; tempDir?: string } = {},
    ) => {
      await runDbResetCommand(cutoffTimestamp, options);
    },
  );

program
  .command('start [cutoffTimestamp]')
  .description('Start Supabase with deferred post-seed migrations applied after startup')
  .option('--psql', 'Apply deferred migrations via raw psql instead of supabase migration up')
  .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
  .option('--temp-dir <path>', 'Temporary directory for deferred migrations', 'supabase/.tmp-migrations')
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
    async (
      cutoffTimestamp: string | undefined,
      options: { psql?: boolean; migrationsDir?: string; tempDir?: string } = {},
    ) => {
      await runStartCommand(cutoffTimestamp, options);
    },
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(errText(message));
  process.exit(1);
});

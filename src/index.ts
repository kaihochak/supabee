#!/usr/bin/env node

import fs from 'node:fs';
import { Command } from 'commander';
import { runSchemaCommand } from './commands/schema.js';
import { runDataCommand } from './commands/data.js';
import { runInitCommand } from './commands/init.js';
import { runSyncCommand } from './commands/sync.js';
import { runDbResetCommand, runStartCommand } from './commands/db-reset.js';
import { runCommand } from './lib/subprocess.js';
import { error as errText, info, warn } from './lib/ui.js';

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

function readCliVersion(): string {
  try {
    const packageJsonPath = new URL('../package.json', import.meta.url);
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    if (typeof parsed.version === 'string' && parsed.version.trim() !== '') {
      return parsed.version;
    }
  } catch {
    // fallback below
  }
  return '0.0.0';
}

const KNOWN_TOP_LEVEL_COMMANDS = new Set(['init', 'schema', 'data', 'sync', 'db', 'start', 'help']);
const KNOWN_DB_SUBCOMMANDS = new Set(['reset', 'help']);

function firstNonOptionToken(args: string[]): { token: string; index: number } | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--') break;
    if (token.startsWith('-')) continue;
    return { token, index };
  }
  return null;
}

function detectWrapperInvocation(): 'pnpm' | 'npx' | 'bunx' | null {
  const userAgent = (process.env.npm_config_user_agent ?? '').toLowerCase();
  const execPath = (process.env.npm_execpath ?? '').toLowerCase();
  const npmCommand = (process.env.npm_command ?? '').toLowerCase();
  const lifecycleScript = (process.env.npm_lifecycle_script ?? '').toLowerCase();
  const packageManager = (process.env.npm_config_user_agent ?? '').split(' ')[0] ?? '';

  if (userAgent.includes('pnpm') || execPath.includes('pnpm')) return 'pnpm';
  if (userAgent.includes('bun') || execPath.includes('bun')) return 'bunx';
  if (npmCommand === 'exec') return 'npx';
  if (packageManager.startsWith('pnpm/')) return 'pnpm';
  if (packageManager.startsWith('bun/')) return 'bunx';
  if (lifecycleScript.includes('pnpm ') || lifecycleScript.includes('pnpm\t')) return 'pnpm';
  if (lifecycleScript.includes('bunx ') || lifecycleScript.includes('bunx\t')) return 'bunx';
  if (lifecycleScript.includes('npx ') || lifecycleScript.includes('npx\t')) return 'npx';

  return null;
}

function maybePrintGlobalInstallHint(args: string[]) {
  if (process.env.SUPABEE_NO_GLOBAL_HINT === '1') return;
  if (args.length === 0) return;

  const wrapper = detectWrapperInvocation();
  if (!wrapper) return;

  console.log(info(`Install globally for direct usage:`));
  console.log(warn('  npm i -g supabee  |  pnpm add -g supabee  |  bun add -g supabee'));
  console.log(info('One-off runners: npx supabee ... | pnpm dlx supabee ... | bunx supabee ...'));
  console.log('');
}

async function maybePassthroughToSupabase(args: string[]): Promise<boolean> {
  const topLevel = firstNonOptionToken(args);
  if (!topLevel) return false;

  if (KNOWN_TOP_LEVEL_COMMANDS.has(topLevel.token)) {
    if (topLevel.token !== 'db') return false;

    const dbSubcommand = firstNonOptionToken(args.slice(topLevel.index + 1));
    if (!dbSubcommand || KNOWN_DB_SUBCOMMANDS.has(dbSubcommand.token)) {
      return false;
    }

    console.log(info(`Forwarding to Supabase CLI: supabase ${args.join(' ')}`));
    await runCommand('supabase', args);
    return true;
  }

  console.log(info(`Forwarding to Supabase CLI: supabase ${args.join(' ')}`));
  await runCommand('supabase', args);
  return true;
}

const program = new Command();
program
  .name('supabee')
  .version(readCliVersion(), '-V, --version', 'display version number')
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

async function main() {
  const args = process.argv.slice(2);
  maybePrintGlobalInstallHint(args);
  const isForwarded = await maybePassthroughToSupabase(args);
  if (isForwarded) return;
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(errText(message));
  process.exit(1);
});

#!/usr/bin/env node

import fs from 'node:fs';
import { Command } from 'commander';
import { runSchemaCommand } from './commands/schema.js';
import { runDataCommand } from './commands/data.js';
import { runInitCommand } from './commands/init.js';
import { runSyncCommand } from './commands/sync.js';
import { runDbResetCommand, runStartCommand, type PostSeedCommandOptions } from './commands/db-reset.js';
import { runSeedCommand, type SeedOptions } from './commands/seed.js';
import { runCutoffDetectCommand, type CutoffDetectOptions } from './commands/cutoff.js';
import {
  type MigrationAuditOptions, type MigrationMarkOptions, type MigrationUnmarkOptions, type MigrationSplitMixedOptions,
  runMigrationAuditCommand,
  runMigrationMarkCommand,
  runMigrationSplitMixedCommand,
  runMigrationUnmarkCommand,
} from './commands/migration.js';
import { runCommand } from './lib/subprocess.js';
import { error as errText, info, warn } from './lib/ui.js';

type StepCliOptions = {
  input?: string;
  output?: string;
  backup?: boolean;
  force?: boolean;
  sync?: boolean;
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

const KNOWN_TOP_LEVEL_COMMANDS = new Set(['init', 'schema', 'data', 'sync', 'db', 'seed', 'start', 'cutoff', 'migration', 'help']);
const KNOWN_DB_SUBCOMMANDS = new Set(['reset', 'seed-remote', 'help']);
const KNOWN_MIGRATION_SUBCOMMANDS = new Set(['audit', 'mark', 'unmark', 'split-mixed', 'help']);

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

function readCliVersion(): string {
  try {
    const packageJsonPath = new URL('../package.json', import.meta.url);
    const raw = fs.readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    if (typeof parsed.version === 'string' && parsed.version.trim() !== '') {
      return parsed.version;
    }
  } catch {
    // fall through
  }
  return '0.0.0';
}

async function maybePassthroughToSupabase(args: string[]): Promise<boolean> {
  const topLevel = firstNonOptionToken(args);
  if (!topLevel) return false;

  if (KNOWN_TOP_LEVEL_COMMANDS.has(topLevel.token)) {
    if (topLevel.token === 'db') {
      const dbSubcommand = firstNonOptionToken(args.slice(topLevel.index + 1));
      if (!dbSubcommand || KNOWN_DB_SUBCOMMANDS.has(dbSubcommand.token)) {
        return false;
      }

      console.log(info(`Forwarding to Supabase CLI: supabase ${args.join(' ')}`));
      await runCommand('supabase', args);
      return true;
    }

    if (topLevel.token === 'migration') {
      const migrationSubcommand = firstNonOptionToken(args.slice(topLevel.index + 1));
      if (!migrationSubcommand || KNOWN_MIGRATION_SUBCOMMANDS.has(migrationSubcommand.token)) {
        return false;
      }

      console.log(info(`Forwarding to Supabase CLI: supabase ${args.join(' ')}`));
      await runCommand('supabase', args);
      return true;
    }

    return false;
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
  supabee db reset --remote              Remote reset using Supabase login (resumable)
  supabee seed                          Seed the local project without resetting
  supabee seed --remote                 Seed the linked project using Supabase login
  supabee start [cutoff_timestamp]

Setup (once per project)
  supabee init
  supabase link

Examples
  supabee sync schema
  supabee sync data
  supabee db reset 20260309180959
  supabee db reset --remote
  supabee db reset --remote=<project-ref>
  supabee db reset --remote=<branch>
  supabee db reset --remote="postgresql://...:5432/postgres?sslmode=require"
  supabee db reset --linked
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

program
  .command('schema [step] [reconstructed]')
  .description('schema split/reconstruct/validate (process an existing local dump)')
  .option('--input <path>', 'Input SQL file or split folder (reconstruct)')
  .option('--output <path>', 'Split output folder (split) or reconstructed file')
  .option('--backup', 'Backup existing split output before replacing')
  .option('--no-backup', 'Do not backup dirty split output folder before split')
  .action((step?: string, reconstructed?: string, options: StepCliOptions = {}) =>
    runSchemaCommand(buildStepArgs(step, reconstructed, options)),
  );

program
  .command('data [step] [reconstructed]')
  .description('data split/reconstruct/validate (process an existing local dump)')
  .option('--input <path>', 'Input SQL file or split folder (reconstruct)')
  .option('--output <path>', 'Split output folder (split) or reconstructed file')
  .option('--backup', 'Backup existing split output before replacing')
  .option('--no-backup', 'Do not backup dirty split output folder before split')
  .action((step?: string, reconstructed?: string, options: StepCliOptions = {}) =>
    runDataCommand(buildStepArgs(step, reconstructed, options)),
  );

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

const cutoffCommand = program.command('cutoff').description('Cutoff detection helpers');

cutoffCommand
  .command('detect [cutoffTimestamp]')
  .description('Resolve cutoff from argument, linked migration alignment, or configured fallback')
  .option('--env <name>', 'Environment key used for postSeedCutoffByEnv fallback lookup')
  .option('--json', 'Print machine-readable JSON output')
  .action((cutoffTimestamp: string | undefined, options: CutoffDetectOptions = {}) =>
    runCutoffDetectCommand(cutoffTimestamp, options),
  );

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
  .command('split-mixed')
  .description('Preview or apply mixed-migration split rewrites')
  .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
  .option('--apply', 'Apply planned rewrite after confirmation')
  .action((options: MigrationSplitMixedOptions = {}) => runMigrationSplitMixedCommand(options));

const dbCommand = program.command('db').description('Database orchestration commands');

dbCommand
  .command('reset [cutoffTimestamp]')
  .description('Reset DB, then apply deferred post-seed migrations (auto cutoff if omitted)')
  .option('--psql', 'Apply deferred migrations via raw psql instead of supabase migration up')
  .option('--strict-mixed', 'Fail when any mixed schema+DML migration is detected (default: warn at/before cutoff, split/fail after cutoff)')
  .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
  .option('--temp-dir <path>', 'Temporary directory for deferred migrations', 'supabase/.tmp-migrations')
  .option('--env <name>', 'Environment key used for postSeedCutoffByEnv fallback lookup')
  .option('--remote [target]', 'Reset linked project, project ref, branch name/UUID, or Postgres URL (Supabase CLI v3)')
  .option('--linked', 'Legacy URL-based remote mode (reads environment URL or prompts for one)')
  .option('--db-url <url>', 'Legacy explicit URL option; prefer --remote=<postgres-url>')
  .option('--url <url>', 'Alias for --db-url')
  .option('--yes', 'Skip the remote-reset confirmation prompt (for CI / non-interactive runs)')
  .option('--resumable-seed', 'Compatibility flag: resumable seeding is automatic for all remote resets')
  .option('--keep-triggers', 'Keep triggers/FK checks active during remote seeding (default: disabled)')
  .addHelpText(
    'after',
    `
What This Command Does
  1) Resolves the target and cutoff, then defers newer migrations
  2) Runs \`supabase db reset\` (local by default; --remote selects a remote target)
  3) Restores migration files and loads remote seed data file-by-file via psql
  4) Applies the newer migrations after seeding

Remote Target Selection (Supabase CLI v3)
  --remote                 Linked project: environment -> saved link -> project picker
  --remote=<project-ref>   Explicit project
  --remote=<branch>        Branch name or UUID under the linked project
  --remote=<postgres-url>  Explicit Direct or Session pooler URL on port 5432

Project and branch targets reuse supabase login or SUPABASE_ACCESS_TOKEN.
Temporary seed credentials are obtained automatically; no separate URL is needed.
The seed connection is checked before reset. Remote resets WIPE the target's
application schema and data. Confirmation is required; --yes skips the prompt.

Resume a failed project seed without resetting again:
  supabee seed --remote=<project-ref> --from <failed-file>
  supabase migration up --remote=<project-ref> --yes

Legacy URL Options
  --linked reads SUPABASE_DB_URL / PGURI or prompts securely for a database URL.
  --db-url and --url accept an explicit database URL. These remain supported.

Examples
  supabee db reset
  supabee db reset 20260309180959
  supabee db reset --remote
  supabee db reset --remote=<project-ref>
  supabee db reset --remote=<branch>
  supabee db reset --remote="postgresql://...:5432/postgres?sslmode=require"
  supabee db reset 20260309180959 --remote --yes
`,
  )
  .action(
    (
      cutoffTimestamp: string | undefined,
      options: PostSeedCommandOptions = {},
    ) => runDbResetCommand(cutoffTimestamp, options),
  );

dbCommand
  .command('seed-remote', { hidden: true })
  .allowUnknownOption()
  .allowExcessArguments()
  .action(() => {
    throw new Error('`supabee db seed-remote` has moved. Use `supabee seed --remote` or `supabee seed --url <url>`.');
  });

program
  .command('seed')
  .description('Seed the local project, or a remote project/database with --remote / --url')
  .option('--remote [target]', 'Seed linked project, project ref, branch, or URL; uses Supabase login for project targets')
  .option('--linked', 'Seed a remote database using SUPABASE_DB_URL / PGURI or a hidden URL prompt')
  .option('--url <url>', 'Seed this remote database (Direct connection or Session pooler, port 5432)')
  .option('--db-url <url>', 'Alias for --url')
  .option('--from <file>', 'Resume from this seed file (inclusive); matches by file name or relative path')
  .option('--dry-run', 'Print the ordered seed queue and exit without seeding')
  .option('--keep-triggers', 'Keep triggers/FK checks active during seeding (default: disabled, like a restore)')
  .addHelpText(
    'after',
    `
What This Command Does
  1) Reads ordered seed files from [db.seed].sql_paths in supabase/config.toml
  2) Runs each file directly via psql, atomically (--single-transaction + ON_ERROR_STOP)
  3) Disables statement_timeout so long inserts are not cut off
  4) On failure, prints a --from command to resume from the failed file

Without a remote option, uses the local project's connection from supabase status.
--linked reads SUPABASE_DB_URL / PGURI or securely prompts for a URL, like db reset.
--remote uses the linked project or --remote=<project-ref|branch|postgres-url>.
Project targets reuse supabase login or SUPABASE_ACCESS_TOKEN; no URL prompt.
--url (alias --db-url) supplies a remote URL directly. Do not combine it with --linked.
Remote connections require Direct connection or Session pooler on port 5432.
This only loads data: it does not reset the database or apply migrations.
--dry-run only lists files and does not connect to a database or prompt for a URL.

Examples
  supabee seed
  supabee seed --dry-run
  supabee seed --linked
  supabee seed --linked --from 015_public_cities_69.sql
  supabee seed --url "postgresql://...:5432/postgres?sslmode=require"
`,
  )
  .action((options: SeedOptions = {}) => runSeedCommand(options));

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

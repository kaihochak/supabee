#!/usr/bin/env node

import fs from 'node:fs';
import { Command } from 'commander';
import { runSchemaCommand } from './commands/schema.js';
import { runDataCommand } from './commands/data.js';
import { runInitCommand } from './commands/init.js';
import { runSyncCommand } from './commands/sync.js';
import { runDbResetCommand, runStartCommand } from './commands/db-reset.js';
import { runSeedRemoteCommand } from './commands/seed-remote.js';
import { runCutoffDetectCommand } from './commands/cutoff.js';
import {
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

const KNOWN_TOP_LEVEL_COMMANDS = new Set(['init', 'schema', 'data', 'sync', 'db', 'start', 'cutoff', 'migration', 'help']);
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
  supabee db reset --linked              Remote reset (resumable; prompts for DB URL)
  supabee start [cutoff_timestamp]

Setup (once per project)
  supabee init
  supabase link

Examples
  supabee sync schema
  supabee sync data
  supabee db reset 20260309180959
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
  .option('--force', 'Skip linked migration alignment preflight for sync')
  .action((options: StepCliOptions = {}) => runSyncCommand('schema', options));

syncCommand
  .command('data')
  .description('Run `supabase db dump --data-only`, then process data files')
  .option('--input <path>', 'Dump output path (defaults to data.input from config)')
  .option('--output <path>', 'Split output path override for data processing')
  .option('--backup', 'Backup existing split output before replacing')
  .option('--no-backup', 'Do not backup dirty split output folder before split')
  .option('--force', 'Skip linked migration alignment preflight for sync')
  .action((options: StepCliOptions = {}) => runSyncCommand('data', options));

const cutoffCommand = program.command('cutoff').description('Cutoff detection helpers');

cutoffCommand
  .command('detect [cutoffTimestamp]')
  .description('Resolve cutoff from argument, linked migration alignment, or configured fallback')
  .option('--env <name>', 'Environment key used for postSeedCutoffByEnv fallback lookup')
  .option('--json', 'Print machine-readable JSON output')
  .action((cutoffTimestamp: string | undefined, options: { env?: string; json?: boolean } = {}) =>
    runCutoffDetectCommand(cutoffTimestamp, options),
  );

const migrationCommand = program.command('migration').description('Migration classification helpers');

migrationCommand
  .command('audit')
  .description('Classify migrations as data/schema/mixed/unknown and show suggested marker actions')
  .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
  .option('--json', 'Print machine-readable audit output')
  .option('--verbose', 'Include detailed classifier evidence in output')
  .action((options: { migrationsDir?: string; json?: boolean; verbose?: boolean } = {}) => runMigrationAuditCommand(options));

migrationCommand
  .command('mark')
  .description('Add marker comments to classified migration files (interactive by default)')
  .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
  .option('--dry-run', 'Preview marker updates without writing files')
  .option('--yes', 'Apply all suggested marker updates without interactive prompts')
  .action((options: { migrationsDir?: string; dryRun?: boolean; yes?: boolean } = {}) =>
    runMigrationMarkCommand(options),
  );

migrationCommand
  .command('unmark')
  .description('Remove marker comments from migration files (interactive by default)')
  .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
  .option('--dry-run', 'Preview marker removals without writing files')
  .option('--yes', 'Remove all found marker updates without interactive prompts')
  .action((options: { migrationsDir?: string; dryRun?: boolean; yes?: boolean } = {}) => runMigrationUnmarkCommand(options));

migrationCommand
  .command('split-mixed')
  .description('Preview or apply mixed-migration split rewrites')
  .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
  .option('--apply', 'Apply planned rewrite after confirmation')
  .action((options: { migrationsDir?: string; apply?: boolean } = {}) => runMigrationSplitMixedCommand(options));

const dbCommand = program.command('db').description('Database orchestration commands');

dbCommand
  .command('reset [cutoffTimestamp]')
  .description('Reset DB, then apply deferred post-seed migrations (auto cutoff if omitted)')
  .option('--psql', 'Apply deferred migrations via raw psql instead of supabase migration up')
  .option('--strict-mixed', 'Fail when any mixed schema+DML migration is detected (default: warn at/before cutoff, split/fail after cutoff)')
  .option('--migrations-dir <path>', 'Migrations directory', 'supabase/migrations')
  .option('--temp-dir <path>', 'Temporary directory for deferred migrations', 'supabase/.tmp-migrations')
  .option('--env <name>', 'Environment key used for postSeedCutoffByEnv fallback lookup')
  .option('--linked', 'Reset the linked project with resumable direct-psql seeding (prompts for confirmation and DB URL)')
  .option('--db-url <url>', 'Reset the database at this Postgres connection string instead of local (destructive; prompts for confirmation)')
  .option('--yes', 'Skip the remote-reset confirmation prompt (for CI / non-interactive runs)')
  .option('--resumable-seed', 'Use no-seed reset + resumable direct-psql seeding (automatic with --linked; otherwise requires --db-url)')
  .option('--keep-triggers', 'With --resumable-seed, keep triggers/FK checks active during seeding (default: disabled)')
  .addHelpText(
    'after',
    `
What This Command Does
  1) Defers migrations with timestamps greater than <cutoffTimestamp>
  2) Runs \`supabase db reset\` (add --linked/--db-url to target a remote database)
  3) Restores deferred migration files
  4) Reapplies deferred migrations

Remote resets are destructive: they WIPE the target database and reseed it from
local seed files. They prompt for confirmation; pass --yes to skip that prompt.

--linked uses resumable seeding automatically and securely prompts for a port-5432
URL: Direct connection for IPv6 or Session pooler for IPv4. Never use port 6543.
Set SUPABASE_DB_URL or PGURI to avoid the URL prompt (CI).

Large remote datasets: the Supabase seed path can time out and leave the database
unhealthy. --linked avoids that path automatically. For an explicit --db-url,
add --resumable-seed to load data file-by-file via direct psql and resume with
\`supabee db seed-remote --from <file>\` instead of starting over.

Examples
  supabee db reset 20260309180959
  supabee db reset
  supabee db reset 20260309180959 --psql
  supabee db reset --linked
  supabee db reset 20260309180959 --linked --yes
  supabee db reset --db-url "postgresql://...:5432/postgres?sslmode=require" --resumable-seed --yes
`,
  )
  .action(
    (
      cutoffTimestamp: string | undefined,
      options: {
        psql?: boolean;
        strictMixed?: boolean;
        migrationsDir?: string;
        tempDir?: string;
        env?: string;
        linked?: boolean;
        dbUrl?: string;
        yes?: boolean;
        resumableSeed?: boolean;
        keepTriggers?: boolean;
      } = {},
    ) => runDbResetCommand(cutoffTimestamp, options),
  );

dbCommand
  .command('seed-remote')
  .description('Seed a remote database from split seed files via psql (resumable on timeout)')
  .option('--db-url <url>', 'Postgres connection string (falls back to SUPABASE_DB_URL / PGURI env)')
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

Because each file is atomic, a timeout rolls that file back — the remote schema
stays healthy and resume re-runs the failed file with no duplicate rows. Use the
Direct connection (IPv6) or Session pooler (IPv4), both on port 5432. Do not use
Transaction pooler on port 6543.

Examples
  supabee db seed-remote --db-url "postgresql://...:5432/postgres?sslmode=require"
  supabee db seed-remote --db-url "postgresql://...:5432/postgres" --dry-run
  supabee db seed-remote --db-url "postgresql://...:5432/postgres" --from 015_public_cities_69.sql
`,
  )
  .action((options: { dbUrl?: string; from?: string; dryRun?: boolean; keepTriggers?: boolean } = {}) =>
    runSeedRemoteCommand(options),
  );

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
      options: { psql?: boolean; strictMixed?: boolean; migrationsDir?: string; tempDir?: string; env?: string } = {},
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

import type { Command } from 'commander';
import { runSeedCommand, type SeedOptions } from '../../commands/seed.js';

export function registerSeedCommand(program: Command): void {
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
}

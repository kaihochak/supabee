import type { Command } from 'commander';
import { runDbResetCommand, type PostSeedCommandOptions } from '../../commands/db-reset.js';

export function registerDbCommand(program: Command): void {
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
}

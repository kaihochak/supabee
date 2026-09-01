import { runCommand } from '../lib/subprocess.js';
import { sectionWithNote, title, info, ok, fail, warn } from '../lib/ui.js';
import { discoverSeedFiles, type SeedFile } from '../lib/seed-files.js';

export type SeedRemoteOptions = {
  dbUrl?: string;
  from?: string;
  dryRun?: boolean;
  keepTriggers?: boolean;
  configPath?: string;
  supabaseDir?: string;
};

function resolveDbUrl(optionUrl?: string): string {
  const fromOption = optionUrl?.trim();
  if (fromOption) return fromOption;
  const fromEnv = process.env.SUPABASE_DB_URL?.trim() || process.env.PGURI?.trim();
  if (fromEnv) return fromEnv;
  throw new Error(
    'db seed-remote requires a connection string. Pass --db-url <url> (or set SUPABASE_DB_URL / PGURI).',
  );
}

function findResumeIndex(files: SeedFile[], from: string): number {
  const needle = from.trim();
  return files.findIndex(
    (file) => file.basename === needle || file.relPath === needle || file.relPath.endsWith(`/${needle}`),
  );
}

function printResumeHint(file: SeedFile, keepTriggers: boolean) {
  const triggersFlag = keepTriggers ? ' --keep-triggers' : '';
  console.log('');
  console.log(warn('Seeding stopped — the remote schema is intact, only data is incomplete.'));
  console.log(info('Resume from the failed file (already-seeded files are skipped):'));
  console.log(
    info(
      `  SUPABASE_DB_URL='YOUR_DATABASE_URL' supabee db seed-remote --from ${file.basename}${triggersFlag}`,
    ),
  );
  console.log(info('Replace YOUR_DATABASE_URL locally; supabee never prints stored credentials in resume hints.'));
}

export async function runSeedRemoteCommand(options: SeedRemoteOptions = {}) {
  const dbUrl = resolveDbUrl(options.dbUrl);
  const { files, patterns } = discoverSeedFiles({
    configPath: options.configPath,
    supabaseDir: options.supabaseDir,
  });

  const sessionSetup = ['SET statement_timeout = 0;'];
  if (!options.keepTriggers) sessionSetup.push('SET session_replication_role = replica;');
  const sessionSetupSql = sessionSetup.join(' ');

  console.log(
    sectionWithNote(
      title('Seed remote'),
      'Applies split seed files directly via psql. Each file is atomic, so a failure can be resumed with --from.',
    ),
  );

  if (patterns.length === 0) {
    throw new Error('No [db.seed].sql_paths configured in supabase/config.toml — nothing to seed.');
  }
  if (files.length === 0) {
    throw new Error(`No seed files matched sql_paths: ${patterns.join(', ')}`);
  }

  let queue = files;
  if (options.from) {
    const index = findResumeIndex(files, options.from);
    if (index === -1) {
      throw new Error(`--from file not found in seed queue: ${options.from}`);
    }
    const skipped = index;
    queue = files.slice(index);
    console.log(info(`Resuming from ${files[index].relPath} (skipping ${skipped} already-seeded file(s)).`));
  }

  console.log(info(`Seed queue: ${queue.length} file(s) from ${patterns.length} pattern(s).`));
  console.log(
    info(
      options.keepTriggers
        ? 'Triggers/FK checks: ENABLED (--keep-triggers).'
        : 'Triggers/FK checks: disabled for the load (session_replication_role=replica, like a restore).',
    ),
  );
  console.log('');

  if (options.dryRun) {
    console.log(info('Dry run — ordered seed queue:'));
    queue.forEach((file, i) => console.log(info(`  ${String(i + 1).padStart(4)}  ${file.relPath}`)));
    console.log('');
    console.log(ok('Dry run complete. No data was seeded.'));
    return;
  }

  for (let i = 0; i < queue.length; i += 1) {
    const file = queue[i];
    console.log(info(`[${i + 1}/${queue.length}] Seeding ${file.relPath}...`));
    try {
      await runCommand('psql', [
        '-X',
        '--single-transaction',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        sessionSetupSql,
        '-f',
        file.absPath,
      ], {
        env: { PGDATABASE: dbUrl },
        sensitiveValues: [dbUrl],
      });
    } catch (error) {
      console.log('');
      console.log(fail(`Failed seeding ${file.relPath}: ${error instanceof Error ? error.message : String(error)}`));
      printResumeHint(file, options.keepTriggers === true);
      throw new Error(`Remote seeding failed at ${file.relPath}.`);
    }
  }

  console.log('');
  console.log(ok(`Seeded ${queue.length} file(s) successfully.`));
}

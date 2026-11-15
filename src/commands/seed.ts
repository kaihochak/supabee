import { runCommand } from '../lib/subprocess.js';
import { sectionWithNote, title, info, ok, fail, warn } from '../lib/ui.js';
import { discoverSeedFiles, type SeedFile } from '../lib/seed-files.js';
import { withPsqlConnection } from '../lib/psql-connection.js';
import { explicitDbUrl, resolveRemoteDbUrl } from '../lib/remote-db-url.js';
import { resolveLocalDbUrl } from '../lib/local-db-url.js';

export type SeedOptions = {
  linked?: boolean;
  url?: string;
  dbUrl?: string;
  from?: string;
  dryRun?: boolean;
  keepTriggers?: boolean;
  configPath?: string;
  supabaseDir?: string;
};

function findResumeIndex(files: SeedFile[], from: string): number {
  const needle = from.trim();
  return files.findIndex(
    (file) => file.basename === needle || file.relPath === needle || file.relPath.endsWith(`/${needle}`),
  );
}

function printResumeHint(file: SeedFile, keepTriggers: boolean, remote: boolean) {
  const triggersFlag = keepTriggers ? ' --keep-triggers' : '';
  console.log('');
  console.log(warn('Seeding stopped — the schema is intact, only data is incomplete.'));
  console.log(info('Resume from the failed file (already-seeded files are skipped):'));
  console.log(
    info(
      `  supabee seed${remote ? ' --linked' : ''} --from ${file.basename}${triggersFlag}`,
    ),
  );
  if (remote) console.log(info('Use the same database URL as this run; --linked reads SUPABASE_DB_URL / PGURI or prompts securely.'));
}

export async function runSeedCommand(options: SeedOptions = {}) {
  const explicitUrl = explicitDbUrl(options);
  if (options.linked && explicitUrl) throw new Error('Use either --linked or --url / --db-url, not both.');
  const remote = options.linked === true || explicitUrl !== undefined;
  const { files, patterns } = discoverSeedFiles({
    configPath: options.configPath,
    supabaseDir: options.supabaseDir,
  });

  const sessionSetup = ['SET statement_timeout = 0;'];
  if (!options.keepTriggers) sessionSetup.push('SET session_replication_role = replica;');
  const sessionSetupSql = sessionSetup.join(' ');

  console.log(
    sectionWithNote(
      title(remote ? 'Seed remote' : 'Seed local'),
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

  const dbUrl = explicitUrl ?? (remote
    ? await resolveRemoteDbUrl('supabee seed --linked')
    : await resolveLocalDbUrl());

  for (let i = 0; i < queue.length; i += 1) {
    const file = queue[i];
    console.log(info(`[${i + 1}/${queue.length}] Seeding ${file.relPath}...`));
    try {
      if (i === 0) console.log(info(`Target: ${remote ? 'remote' : 'local'} database at ${new URL(dbUrl).hostname}:${new URL(dbUrl).port || '5432'}.`));
      await withPsqlConnection(dbUrl, async (env) => {
        await runCommand('psql', [
          '-X', '-w', '--single-transaction', '-v', 'ON_ERROR_STOP=1',
          '-c', sessionSetupSql,
          '-f', file.absPath,
        ], {
          env,
          sensitiveValues: [dbUrl, decodeURIComponent(new URL(dbUrl).password)],
        });
      });
    } catch (error) {
      console.log('');
      console.log(fail(`Failed seeding ${file.relPath}: ${error instanceof Error ? error.message : String(error)}`));
      printResumeHint(file, options.keepTriggers === true, remote);
      throw new Error(`${remote ? 'Remote' : 'Local'} seeding failed at ${file.relPath}.`);
    }
  }

  console.log('');
  console.log(ok(`Seeded ${queue.length} file(s) successfully.`));
}

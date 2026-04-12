import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../lib/subprocess.js';
import { sectionWithNote, title, info, ok } from '../lib/ui.js';
import { parseCutoffTimestamp, resolvePostSeedCutoff } from '../lib/post-seed-cutoff.js';
import { classifyMigrations, resolveMarkers } from '../lib/migration-classifier.js';

export type PostSeedCommandOptions = {
  psql?: boolean;
  migrationsDir?: string;
  tempDir?: string;
  env?: string;
  strictMixed?: boolean;
};

type PostSeedMode = 'reset' | 'start';

const DEFAULT_MIGRATIONS_DIR = 'supabase/migrations';
const DEFAULT_TEMP_DIR = 'supabase/.tmp-migrations';
const DATA_MIGRATION_STUB_HEADER = '-- supabee:auto-stub:data-migration';

function buildDataMigrationStub(fileName: string, cutoffTimestampRaw: string): string {
  return `${DATA_MIGRATION_STUB_HEADER}
-- original file: ${fileName}
-- reason: historical data migration at/before cutoff ${cutoffTimestampRaw}
SELECT 1;
`;
}

async function stubHistoricalDataMigrations(
  fileNames: string[],
  migrationsDir: string,
  stubOriginalsDir: string,
  cutoffTimestampRaw: string,
) {
  if (fileNames.length === 0) return;

  await fs.promises.mkdir(stubOriginalsDir, { recursive: true });
  for (const fileName of fileNames) {
    const sourcePath = path.join(migrationsDir, fileName);
    const originalPath = path.join(stubOriginalsDir, fileName);
    await fs.promises.rename(sourcePath, originalPath);
    await fs.promises.writeFile(sourcePath, buildDataMigrationStub(fileName, cutoffTimestampRaw), 'utf8');
  }
}

async function restoreStubbedMigrations(fileNames: string[], stubOriginalsDir: string, migrationsDir: string) {
  if (fileNames.length === 0) return;

  for (const fileName of fileNames) {
    const liveStubPath = path.join(migrationsDir, fileName);
    const originalPath = path.join(stubOriginalsDir, fileName);
    await fs.promises.rm(liveStubPath, { force: true });
    await fs.promises.rename(originalPath, liveStubPath);
  }
}

async function moveFiles(fileNames: string[], fromDir: string, toDir: string) {
  await fs.promises.mkdir(toDir, { recursive: true });
  for (const fileName of fileNames) {
    await fs.promises.rename(path.join(fromDir, fileName), path.join(toDir, fileName));
  }
}

async function removeIfEmpty(dirPath: string) {
  try {
    const entries = await fs.promises.readdir(dirPath);
    if (entries.length === 0) {
      await fs.promises.rmdir(dirPath);
    }
  } catch {
    // ignore cleanup errors
  }
}

async function ensureDirectoryExists(dirPath: string) {
  const stats = await fs.promises.stat(dirPath).catch(() => null);
  if (!stats || !stats.isDirectory()) {
    throw new Error(`Migrations directory not found: ${dirPath}`);
  }
}

function modeDisplayName(mode: PostSeedMode): string {
  return mode === 'reset' ? 'DB reset' : 'Start';
}

function modeCommandLabel(mode: PostSeedMode): string {
  return mode === 'reset' ? 'supabase db reset' : 'supabase start';
}

async function runPostSeedCommand(
  mode: PostSeedMode,
  cutoffTimestampRaw: string | undefined,
  options: PostSeedCommandOptions = {},
) {
  const resolvedCutoff = await resolvePostSeedCutoff(cutoffTimestampRaw, { env: options.env });
  const resolvedCutoffRaw = resolvedCutoff.value;
  const cutoff = parseCutoffTimestamp(resolvedCutoffRaw);

  const migrationsDir = path.resolve(process.cwd(), options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
  const tempRootDir = path.resolve(process.cwd(), options.tempDir ?? DEFAULT_TEMP_DIR);
  const activeTempDir = path.join(tempRootDir, `deferred_${Date.now()}_${process.pid}`);
  const activeStubDir = path.join(tempRootDir, `stubbed_${Date.now()}_${process.pid}`);
  const usePsql = options.psql === true;
  const strictMixed = options.strictMixed === true;
  const markers = resolveMarkers();

  await ensureDirectoryExists(migrationsDir);

  console.log(
    sectionWithNote(
      title(modeDisplayName(mode)),
      `Defers post-seed migrations, runs ${modeCommandLabel(mode)}, restores files, then reapplies deferred migrations.`,
    ),
  );
  const cutoffSourceSuffix =
    resolvedCutoff.source === 'linked'
      ? ' (auto-detected from linked project)'
      : resolvedCutoff.source === 'config'
        ? ' (from postSeedCutoff in config)'
        : '';
  console.log(info(`cutoff = ${resolvedCutoffRaw}${cutoffSourceSuffix}`));
  console.log(info(`migrationsDir = ${migrationsDir}`));
  console.log(info(`tempDir = ${activeTempDir}`));
  console.log(info(`dataMarker = ${markers.dataMarker}`));
  console.log(info(`schemaMarker = ${markers.schemaMarker}`));
  console.log(info(`strictMixed = ${strictMixed ? 'true' : 'false'}`));
  console.log(info(`applyMode = ${usePsql ? 'psql' : 'supabase migration up'}`));
  console.log('');

  const classified = await classifyMigrations({ migrationsDir });
  const mixedFiles = classified.filter((migration) => migration.classification === 'mixed');
  const mixedBeforeOrAtCutoff = mixedFiles.filter((migration) => migration.timestamp <= cutoff);
  const mixedAfterCutoff = mixedFiles.filter((migration) => migration.timestamp > cutoff);
  if (strictMixed && mixedFiles.length > 0) {
    const mixedList = mixedFiles.map((migration) => `- ${migration.fileName} (${migration.reasons.join('; ')})`).join('\n');
    throw new Error(
      `Mixed schema+DML migrations are not supported with --strict-mixed.\n` +
        `Split each mixed migration into separate schema-only and data-only files:\n${mixedList}`,
    );
  }
  if (mixedAfterCutoff.length > 0) {
    const mixedList = mixedAfterCutoff
      .map((migration) => `- ${migration.fileName} (${migration.reasons.join('; ')})`)
      .join('\n');
    throw new Error(
      `Mixed schema+DML migrations detected after cutoff ${resolvedCutoffRaw}.\n` +
        `Split each mixed migration into separate schema-only and data-only files:\n${mixedList}`,
    );
  }
  if (mixedBeforeOrAtCutoff.length > 0) {
    console.log(
      info(
        `Detected ${mixedBeforeOrAtCutoff.length} mixed migration(s) at/before cutoff; continuing in compatibility mode.`,
      ),
    );
    for (const migration of mixedBeforeOrAtCutoff) {
      console.log(info(`  ${migration.fileName}`));
    }
    console.log('');
  }

  const unknownFiles = classified.filter((migration) => migration.classification === 'unknown');
  if (unknownFiles.length > 0) {
    console.log(
      info(
        `Detected ${unknownFiles.length} unknown migration(s); treating them as schema for reset/start handling unless explicitly marked.`,
      ),
    );
    for (const migration of unknownFiles) {
      console.log(info(`  ${migration.fileName}`));
    }
    console.log('');
  }

  const replayDeferred = classified.filter((migration) => migration.timestamp > cutoff);
  const replayDeferredNames = replayDeferred.map((migration) => migration.fileName);
  const historicalDataMigrations = classified.filter(
    (migration) => migration.timestamp <= cutoff && migration.classification === 'data',
  );
  const historicalDataMigrationNames = historicalDataMigrations.map((migration) => migration.fileName);

  if (replayDeferredNames.length > 0) {
    console.log(info(`Deferring ${replayDeferredNames.length} migrations after ${resolvedCutoffRaw}:`));
    for (const fileName of replayDeferredNames) {
      console.log(info(`  ${fileName}`));
    }
  } else {
    console.log(info(`No migrations found after ${resolvedCutoffRaw}.`));
  }
  if (historicalDataMigrationNames.length > 0) {
    console.log(
      info(`Stubbing ${historicalDataMigrationNames.length} historical data migrations at/before ${resolvedCutoffRaw}:`),
    );
    for (const fileName of historicalDataMigrationNames) {
      console.log(info(`  ${fileName}`));
    }
  }
  console.log('');

  let baseCommandError: unknown = null;
  let restoreErrors: string[] = [];
  let movedReplayDeferred = false;
  let stubbedHistorical = false;

  if (replayDeferredNames.length > 0) {
    await moveFiles(replayDeferredNames, migrationsDir, activeTempDir);
    movedReplayDeferred = true;
    console.log(ok(`Moved ${replayDeferredNames.length} migrations to ${activeTempDir}`));
    console.log('');
  }

  if (historicalDataMigrationNames.length > 0) {
    await stubHistoricalDataMigrations(historicalDataMigrationNames, migrationsDir, activeStubDir, resolvedCutoffRaw);
    stubbedHistorical = true;
    console.log(ok(`Stubbed ${historicalDataMigrationNames.length} historical data migrations in-place`));
    console.log('');
  }

  try {
    console.log(info(`Running ${modeCommandLabel(mode)}...`));
    await runCommand('supabase', mode === 'reset' ? ['db', 'reset'] : ['start']);
    console.log(ok(`${modeCommandLabel(mode)} completed.`));
  } catch (error) {
    baseCommandError = error;
  } finally {
    if (movedReplayDeferred) {
      try {
        await moveFiles(replayDeferredNames, activeTempDir, migrationsDir);
        console.log(ok(`Restored deferred migrations to ${migrationsDir}`));
      } catch (error) {
        restoreErrors.push(
          `Failed restoring deferred migrations: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (stubbedHistorical) {
      try {
        await restoreStubbedMigrations(historicalDataMigrationNames, activeStubDir, migrationsDir);
        console.log(ok(`Restored original SQL for ${historicalDataMigrationNames.length} historical data migrations`));
      } catch (error) {
        restoreErrors.push(
          `Failed restoring stubbed historical migrations: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    await removeIfEmpty(activeTempDir);
    await removeIfEmpty(activeStubDir);
    await removeIfEmpty(tempRootDir);
  }

  if (restoreErrors.length > 0) {
    throw new Error(`Failed while restoring migrations:\n${restoreErrors.join('\n')}`);
  }

  if (baseCommandError) {
    throw baseCommandError;
  }

  if (replayDeferredNames.length === 0) {
    if (historicalDataMigrationNames.length > 0) {
      console.log(ok(`Done. No post-seed migrations to apply. Historical data migrations skipped: ${historicalDataMigrationNames.length}.`));
    } else {
      console.log(ok('Done. No post-seed migrations to apply.'));
    }
    return;
  }

  if (usePsql) {
    console.log(info('Applying deferred migrations via psql...'));
    for (const fileName of replayDeferredNames) {
      const migrationPath = path.join(migrationsDir, fileName);
      console.log(info(`  ${fileName}`));
      await runCommand(
        'psql',
        ['-h', '127.0.0.1', '-p', '6543', '-U', 'postgres', '-d', 'postgres', '-f', migrationPath, '-v', 'ON_ERROR_STOP=1'],
        { env: { PGPASSWORD: 'postgres' } },
      );
    }
  } else {
    console.log(info('Applying deferred migrations via supabase migration up...'));
    await runCommand('supabase', ['migration', 'up']);
  }

  console.log(ok(`Done. Applied ${replayDeferredNames.length} post-seed migrations.`));
}

export async function runDbResetCommand(
  cutoffTimestampRaw: string | undefined,
  options: PostSeedCommandOptions = {},
) {
  await runPostSeedCommand('reset', cutoffTimestampRaw, options);
}

export async function runStartCommand(
  cutoffTimestampRaw: string | undefined,
  options: PostSeedCommandOptions = {},
) {
  await runPostSeedCommand('start', cutoffTimestampRaw, options);
}

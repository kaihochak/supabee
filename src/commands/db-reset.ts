import fs from 'node:fs';
import path from 'node:path';
import { runCommand, runCommandCapture } from '../lib/subprocess.js';
import { readToolConfig, updateToolConfig } from '../lib/config.js';
import { sectionWithNote, title, info, ok, warn } from '../lib/ui.js';

export type PostSeedCommandOptions = {
  psql?: boolean;
  migrationsDir?: string;
  tempDir?: string;
};

type MigrationFile = {
  fileName: string;
  timestamp: number;
};

type MigrationListRow = {
  local: string;
  remote: string;
  timeUtc: string;
};

type PostSeedMode = 'reset' | 'start';
type CutoffSource = 'argument' | 'linked' | 'config';

const DEFAULT_MIGRATIONS_DIR = 'supabase/migrations';
const DEFAULT_TEMP_DIR = 'supabase/.tmp-migrations';

function parseCutoffTimestamp(raw: string): number {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid cutoff timestamp "${raw}". Expected numeric format like 20260309180959.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid cutoff timestamp "${raw}".`);
  }
  return parsed;
}

function isValidMigrationVersion(raw: string): boolean {
  return /^\d+$/.test(raw.trim());
}

function compareMigrationVersions(a: string, b: string): number {
  const trimmedA = a.trim();
  const trimmedB = b.trim();
  if (trimmedA.length !== trimmedB.length) {
    return trimmedA.length - trimmedB.length;
  }
  return trimmedA.localeCompare(trimmedB);
}

function parseMigrationListOutput(output: string): MigrationListRow[] {
  const rows: MigrationListRow[] = [];
  const lines = output.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.replaceAll('│', '|').trimEnd();
    if (!line.includes('|')) continue;
    if (line.includes('Local') && line.includes('Remote')) continue;
    if (line.match(/^-+\|-+\|-+$/)) continue;

    const parts = line.split('|').map((part) => part.trim());
    if (parts.length < 3) continue;
    if (/^-+$/.test(parts[0]) && /^-+$/.test(parts[1])) continue;

    const local = parts[0];
    const remote = parts[1];
    const timeUtc = parts[2];
    if (!local && !remote) continue;

    rows.push({ local, remote, timeUtc });
  }

  return rows;
}

async function detectCutoffFromLinkedProject(): Promise<string> {
  const { stdout } = await runCommandCapture('supabase', ['migration', 'list', '--linked']);
  const rows = parseMigrationListOutput(stdout);
  if (rows.length === 0) {
    throw new Error(
      'Could not read migration list from linked project. Provide cutoff timestamp explicitly or run `supabase link` first.',
    );
  }

  const localVersions = new Set<string>();
  const remoteVersions = new Set<string>();
  for (const row of rows) {
    const local = row.local;
    const remote = row.remote;
    if (isValidMigrationVersion(local)) localVersions.add(local);
    if (isValidMigrationVersion(remote)) remoteVersions.add(remote);
  }

  let latestAligned: string | null = null;
  for (const localVersion of localVersions) {
    if (!remoteVersions.has(localVersion)) continue;
    if (!latestAligned || compareMigrationVersions(localVersion, latestAligned) > 0) {
      latestAligned = localVersion;
    }
  }

  if (!latestAligned) {
    throw new Error(
      'No common local/remote migration version found. Provide cutoff timestamp explicitly (e.g. `supabee db reset 20260309180959`).',
    );
  }

  return latestAligned;
}

function isLikelyUnlinkedError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('supabase link') ||
    message.includes('not linked') ||
    message.includes('project ref') ||
    message.includes('cannot find project')
  );
}

async function detectCutoffWithAutoLinkRetry(): Promise<string> {
  try {
    return await detectCutoffFromLinkedProject();
  } catch (error) {
    if (!isLikelyUnlinkedError(error)) {
      throw error;
    }
    console.log(info('No linked Supabase project detected. Running `supabase link`...'));
    await runCommand('supabase', ['link']);
    return detectCutoffFromLinkedProject();
  }
}

function readConfiguredPostSeedCutoff(): string | null {
  const configured = readToolConfig().postSeedCutoff;
  if (typeof configured !== 'string') return null;

  const trimmed = configured.trim();
  if (!trimmed) return null;
  if (!isValidMigrationVersion(trimmed)) {
    console.log(warn(`Ignoring invalid postSeedCutoff value in config: ${configured}`));
    return null;
  }

  return trimmed;
}

function persistPostSeedCutoff(cutoffTimestamp: string) {
  try {
    const configPath = updateToolConfig((current) => ({ ...current, postSeedCutoff: cutoffTimestamp }));
    console.log(info(`Saved postSeedCutoff = ${cutoffTimestamp} in ${configPath}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(warn(`Unable to persist postSeedCutoff: ${message}`));
  }
}

async function resolveCutoffTimestamp(cutoffTimestampRaw: string | undefined): Promise<{ value: string; source: CutoffSource }> {
  if (cutoffTimestampRaw && cutoffTimestampRaw.trim()) {
    return { value: cutoffTimestampRaw.trim(), source: 'argument' };
  }

  try {
    const detected = await detectCutoffWithAutoLinkRetry();
    persistPostSeedCutoff(detected);
    return { value: detected, source: 'linked' };
  } catch (error) {
    const fallback = readConfiguredPostSeedCutoff();
    if (fallback) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(warn(`Could not auto-detect cutoff from linked project. Falling back to postSeedCutoff: ${fallback}`));
      console.log(info(message));
      return { value: fallback, source: 'config' };
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not auto-detect cutoff from linked project and no postSeedCutoff is configured.\n${message}`,
    );
  }
}

async function listMigrations(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = await fs.promises.readdir(migrationsDir, { withFileTypes: true });
  const files: MigrationFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
    const timestampPart = entry.name.split('_')[0];
    if (!/^\d+$/.test(timestampPart)) continue;
    files.push({
      fileName: entry.name,
      timestamp: Number(timestampPart),
    });
  }

  files.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.fileName.localeCompare(b.fileName);
  });

  return files;
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
  const resolvedCutoff = await resolveCutoffTimestamp(cutoffTimestampRaw);
  const resolvedCutoffRaw = resolvedCutoff.value;
  const cutoff = parseCutoffTimestamp(resolvedCutoffRaw);

  const migrationsDir = path.resolve(process.cwd(), options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
  const tempRootDir = path.resolve(process.cwd(), options.tempDir ?? DEFAULT_TEMP_DIR);
  const activeTempDir = path.join(tempRootDir, `deferred_${Date.now()}_${process.pid}`);
  const usePsql = options.psql === true;

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
  console.log(info(`applyMode = ${usePsql ? 'psql' : 'supabase migration up'}`));
  console.log('');

  const allMigrations = await listMigrations(migrationsDir);
  const deferred = allMigrations.filter((migration) => migration.timestamp > cutoff);
  const deferredNames = deferred.map((migration) => migration.fileName);

  if (deferredNames.length > 0) {
    console.log(info(`Deferring ${deferredNames.length} migrations after ${resolvedCutoffRaw}:`));
    for (const fileName of deferredNames) {
      console.log(info(`  ${fileName}`));
    }
  } else {
    console.log(info(`No migrations found after ${resolvedCutoffRaw}.`));
  }
  console.log('');

  let baseCommandError: unknown = null;
  let restoreError: unknown = null;

  if (deferredNames.length > 0) {
    await moveFiles(deferredNames, migrationsDir, activeTempDir);
    console.log(ok(`Moved ${deferredNames.length} migrations to ${activeTempDir}`));
    console.log('');
  }

  try {
    console.log(info(`Running ${modeCommandLabel(mode)}...`));
    await runCommand('supabase', mode === 'reset' ? ['db', 'reset'] : ['start']);
    console.log(ok(`${modeCommandLabel(mode)} completed.`));
  } catch (error) {
    baseCommandError = error;
  } finally {
    if (deferredNames.length > 0) {
      try {
        await moveFiles(deferredNames, activeTempDir, migrationsDir);
        await removeIfEmpty(activeTempDir);
        await removeIfEmpty(tempRootDir);
        console.log(ok(`Restored deferred migrations to ${migrationsDir}`));
      } catch (error) {
        restoreError = error;
      }
    }
  }

  if (restoreError) {
    throw new Error(
      `Failed while restoring deferred migrations: ${
        restoreError instanceof Error ? restoreError.message : String(restoreError)
      }`,
    );
  }

  if (baseCommandError) {
    throw baseCommandError;
  }

  if (deferredNames.length === 0) {
    console.log(ok('Done. No post-seed migrations to apply.'));
    return;
  }

  if (usePsql) {
    console.log(info('Applying deferred migrations via psql...'));
    for (const fileName of deferredNames) {
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

  console.log(ok(`Done. Applied ${deferredNames.length} post-seed migrations.`));
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

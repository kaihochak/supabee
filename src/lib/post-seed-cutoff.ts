import { runCommand, runCommandCapture } from './subprocess.js';
import { readToolConfig, updateToolConfig } from './config.js';
import { info, warn } from './ui.js';

export type MigrationListRow = {
  local: string;
  remote: string;
  timeUtc: string;
};

export type CutoffSource = 'argument' | 'linked' | 'config';
export type ResolvedCutoff = { value: string; source: CutoffSource };
export type MigrationAlignment = {
  latestLocal: string | null;
  latestRemote: string | null;
  latestAligned: string | null;
};

export function parseCutoffTimestamp(raw: string): number {
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

export function isValidMigrationVersion(raw: string): boolean {
  return /^\d+$/.test(raw.trim());
}

export function compareMigrationVersions(a: string, b: string): number {
  const trimmedA = a.trim();
  const trimmedB = b.trim();
  if (trimmedA.length !== trimmedB.length) {
    return trimmedA.length - trimmedB.length;
  }
  return trimmedA.localeCompare(trimmedB);
}

export function parseMigrationListOutput(output: string): MigrationListRow[] {
  const rows: MigrationListRow[] = [];
  const lines = output.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.replaceAll('│', '|').trimEnd();
    if (!line.includes('|')) continue;
    if (line.includes('Local') && line.includes('Remote')) continue;
    if (line.match(/^-+\|-+\|-+$/)) continue;

    const parts = line.split('|').map((part) => part.trim().replace(/^`(.*)`$/, '$1').trim());
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

function latestVersionFromSet(versions: Set<string>): string | null {
  let latest: string | null = null;
  for (const version of versions) {
    if (!latest || compareMigrationVersions(version, latest) > 0) {
      latest = version;
    }
  }
  return latest;
}

export function summarizeMigrationAlignment(rows: MigrationListRow[]): MigrationAlignment {
  const localVersions = new Set<string>();
  const remoteVersions = new Set<string>();

  for (const row of rows) {
    if (isValidMigrationVersion(row.local)) localVersions.add(row.local);
    if (isValidMigrationVersion(row.remote)) remoteVersions.add(row.remote);
  }

  let latestAligned: string | null = null;
  for (const localVersion of localVersions) {
    if (!remoteVersions.has(localVersion)) continue;
    if (!latestAligned || compareMigrationVersions(localVersion, latestAligned) > 0) {
      latestAligned = localVersion;
    }
  }

  return {
    latestLocal: latestVersionFromSet(localVersions),
    latestRemote: latestVersionFromSet(remoteVersions),
    latestAligned,
  };
}

export async function readLinkedMigrationAlignment(): Promise<MigrationAlignment> {
  const { stdout } = await runCommandCapture('supabase', ['migration', 'list', '--linked']);
  const rows = parseMigrationListOutput(stdout);
  if (rows.length === 0) {
    throw new Error(
      'Could not read migration list from linked project. Provide cutoff timestamp explicitly or run `supabase link` first.',
    );
  }

  return summarizeMigrationAlignment(rows);
}

async function detectCutoffFromLinkedProject(): Promise<string> {
  const alignment = await readLinkedMigrationAlignment();

  if (!alignment.latestAligned) {
    throw new Error(
      'No common local/remote migration version found. Provide cutoff timestamp explicitly (e.g. `supabee db reset 20260309180959`).',
    );
  }

  return alignment.latestAligned;
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

function readValidConfiguredCutoff(configured: unknown, label: string): string | null {
  if (typeof configured !== 'string') return null;
  const trimmed = configured.trim();
  if (!trimmed) return null;

  if (!isValidMigrationVersion(trimmed)) {
    console.log(warn(`Ignoring invalid ${label} value in config: ${configured}`));
    return null;
  }

  return trimmed;
}

function readConfiguredPostSeedCutoff(envName?: string): string | null {
  const config = readToolConfig();

  if (envName) {
    const byEnv = config.postSeedCutoffByEnv;
    if (byEnv && typeof byEnv === 'object' && !Array.isArray(byEnv)) {
      const envConfigured = (byEnv as Record<string, unknown>)[envName];
      const fromEnv = readValidConfiguredCutoff(envConfigured, `postSeedCutoffByEnv.${envName}`);
      if (fromEnv) return fromEnv;
    }
  }

  return readValidConfiguredCutoff(config.postSeedCutoff, 'postSeedCutoff');
}

function persistPostSeedCutoff(cutoffTimestamp: string, envName?: string) {
  try {
    const configPath = updateToolConfig((current) => {
      if (!envName) {
        return { ...current, postSeedCutoff: cutoffTimestamp };
      }

      const currentByEnv =
        current.postSeedCutoffByEnv && typeof current.postSeedCutoffByEnv === 'object'
          ? current.postSeedCutoffByEnv
          : {};

      return {
        ...current,
        postSeedCutoffByEnv: {
          ...currentByEnv,
          [envName]: cutoffTimestamp,
        },
      };
    });
    if (envName) {
      console.log(info(`Saved postSeedCutoffByEnv.${envName} = ${cutoffTimestamp} in ${configPath}`));
    } else {
      console.log(info(`Saved postSeedCutoff = ${cutoffTimestamp} in ${configPath}`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(warn(`Unable to persist postSeedCutoff: ${message}`));
  }
}

export async function resolvePostSeedCutoff(
  cutoffTimestampRaw: string | undefined,
  options: { env?: string } = {},
): Promise<ResolvedCutoff> {
  const envName = options.env?.trim() || undefined;

  if (cutoffTimestampRaw && cutoffTimestampRaw.trim()) {
    return { value: cutoffTimestampRaw.trim(), source: 'argument' };
  }

  try {
    const detected = await detectCutoffWithAutoLinkRetry();
    persistPostSeedCutoff(detected, envName);
    return { value: detected, source: 'linked' };
  } catch (error) {
    const fallback = readConfiguredPostSeedCutoff(envName);
    if (fallback) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackLabel = envName ? `postSeedCutoffByEnv.${envName}` : 'postSeedCutoff';
      console.log(warn(`Could not auto-detect cutoff from linked project. Falling back to ${fallbackLabel}: ${fallback}`));
      console.log(info(message));
      return { value: fallback, source: 'config' };
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not auto-detect cutoff from linked project and no postSeedCutoff is configured.\n${message}`,
    );
  }
}

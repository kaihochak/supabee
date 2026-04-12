import fs from 'node:fs';
import path from 'node:path';
import { runCommandCapture } from './subprocess.js';
import { isValidMigrationVersion, parseMigrationListOutput } from './post-seed-cutoff.js';
import { ok } from './ui.js';

const DDL_PATTERN =
  /\b(create|alter|drop)\s+(table|type|schema|extension|index|view|materialized|function|policy|trigger|publication|subscription)\b/i;
const DML_PATTERN = /\b(insert\s+into|delete\s+from|merge\s+into|truncate\s+table)\b/i;

type SplitKind = 'schema' | 'data';
type SplitSegment = { kind: SplitKind; statements: string[] };

function stripCommentsAndStrings(sql: string): string {
  let result = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < sql.length) {
    const c = sql[i];
    const n = i + 1 < sql.length ? sql[i + 1] : '';

    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false;
        result += '\n';
      } else {
        result += ' ';
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (c === '*' && n === '/') {
        inBlockComment = false;
        result += '  ';
        i += 2;
        continue;
      }
      result += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }

    if (inSingle) {
      if (c === "'" && n === "'") {
        result += '  ';
        i += 2;
        continue;
      }
      if (c === "'") {
        inSingle = false;
        result += ' ';
        i += 1;
        continue;
      }
      result += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }

    if (inDouble) {
      if (c === '"') {
        inDouble = false;
        result += ' ';
        i += 1;
        continue;
      }
      result += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }

    if (c === '-' && n === '-') {
      inLineComment = true;
      result += '  ';
      i += 2;
      continue;
    }

    if (c === '/' && n === '*') {
      inBlockComment = true;
      result += '  ';
      i += 2;
      continue;
    }

    if (c === "'") {
      inSingle = true;
      result += ' ';
      i += 1;
      continue;
    }

    if (c === '"') {
      inDouble = true;
      result += ' ';
      i += 1;
      continue;
    }

    result += c;
    i += 1;
  }

  return result;
}

function splitTopLevelSqlStatements(sql: string): string[] {
  const normalized = sql.replace(/\r\n/g, '\n');
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inDollarQuote = false;
  let dollarTag = '';

  for (let i = 0; i < normalized.length; i += 1) {
    const c = normalized[i];
    const n = i + 1 < normalized.length ? normalized[i + 1] : '';
    current += c;

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') {
        current += n;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      if (c === "'" && n === "'") {
        current += n;
        i += 1;
        continue;
      }
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      continue;
    }
    if (inDollarQuote) {
      const maybeTag = `$${dollarTag}$`;
      if (normalized.startsWith(maybeTag, i)) {
        current += maybeTag.slice(1);
        i += maybeTag.length - 1;
        inDollarQuote = false;
        dollarTag = '';
      }
      continue;
    }

    if (c === '-' && n === '-') {
      current += n;
      i += 1;
      inLineComment = true;
      continue;
    }
    if (c === '/' && n === '*') {
      current += n;
      i += 1;
      inBlockComment = true;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === '$') {
      const rest = normalized.slice(i);
      const match = rest.match(/^\$([a-zA-Z0-9_]*)\$/);
      if (match) {
        const tag = match[1];
        inDollarQuote = true;
        dollarTag = tag;
        const token = `$${tag}$`;
        current += token.slice(1);
        i += token.length - 1;
        continue;
      }
    }

    if (c === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

function classifyStatement(statement: string): SplitKind | 'unknown' {
  const normalized = stripCommentsAndStrings(statement);
  const hasDdl = DDL_PATTERN.test(normalized);
  const hasDml = DML_PATTERN.test(normalized) || /(?:^|[;\n]\s*)update\s+\S+/i.test(normalized);
  if (hasDdl && !hasDml) return 'schema';
  if (hasDml && !hasDdl) return 'data';
  if (hasDdl && hasDml) return 'schema';
  return 'unknown';
}

function buildSplitSegments(statements: string[]): SplitSegment[] {
  const segments: SplitSegment[] = [];
  let current: SplitSegment | null = null;

  for (const statement of statements) {
    const kind = classifyStatement(statement);
    const fallbackKind: SplitKind = current ? current.kind : 'schema';
    const resolvedKind: SplitKind = kind === 'unknown' ? fallbackKind : kind;
    if (!current || current.kind !== resolvedKind) {
      current = { kind: resolvedKind, statements: [statement] };
      segments.push(current);
      continue;
    }
    current.statements.push(statement);
  }

  return segments.filter((segment) => segment.statements.length > 0);
}

function parseTimestampFromFileName(fileName: string): string {
  const prefix = fileName.split('_')[0];
  if (!/^\d+$/.test(prefix)) {
    throw new Error(`Cannot parse migration timestamp from "${fileName}"`);
  }
  return prefix;
}

function parseBigIntVersion(version: string): bigint {
  if (!/^\d+$/.test(version)) {
    throw new Error(`Invalid migration version: ${version}`);
  }
  return BigInt(version);
}

function buildUniqueSplitVersions(
  originalVersion: string,
  count: number,
  existingVersions: Set<string>,
): string[] {
  const base = parseBigIntVersion(originalVersion);
  const nextHigher = [...existingVersions]
    .filter((version) => version !== originalVersion)
    .map((version) => parseBigIntVersion(version))
    .filter((value) => value > base)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];

  const versions: string[] = [];
  let candidate = base;
  while (versions.length < count) {
    const candidateText = candidate.toString();
    const available = candidateText === originalVersion || !existingVersions.has(candidateText);
    if (available) {
      if (nextHigher && candidate >= nextHigher) {
        throw new Error(
          `Cannot auto-split ${originalVersion}: no safe version slot before next migration ${nextHigher.toString()}.`,
        );
      }
      versions.push(candidateText);
    }
    candidate += 1n;
  }

  return versions;
}

function createSplitFileName(originalFileName: string, version: string, kind: SplitKind, index: number): string {
  const withoutPrefix = originalFileName.replace(/^\d+_/, '').replace(/\.sql$/i, '');
  return `${version}_${withoutPrefix}_${kind}_${index}.sql`;
}

async function readLinkedRemoteVersions(): Promise<Set<string>> {
  const { stdout } = await runCommandCapture('supabase', ['migration', 'list', '--linked']);
  const rows = parseMigrationListOutput(stdout);
  const versions = new Set<string>();
  for (const row of rows) {
    if (isValidMigrationVersion(row.remote)) versions.add(row.remote.trim());
  }
  return versions;
}

export async function autoSplitMixedMigrations(options: {
  fileNames: string[];
  migrationsDir: string;
  tempRootDir: string;
}): Promise<string[]> {
  const { fileNames, migrationsDir, tempRootDir } = options;
  const remoteVersions = await readLinkedRemoteVersions();
  const appliedRemote = fileNames.filter((fileName) => remoteVersions.has(parseTimestampFromFileName(fileName)));
  if (appliedRemote.length > 0) {
    throw new Error(
      `Cannot auto-split migrations already applied on linked remote:\n${appliedRemote.map((name) => `- ${name}`).join('\n')}\n` +
        'Only split migrations that are not pushed/applied.',
    );
  }

  const entries = await fs.promises.readdir(migrationsDir);
  const existingVersions = new Set<string>();
  for (const entry of entries) {
    if (!entry.endsWith('.sql')) continue;
    const version = entry.split('_')[0];
    if (/^\d+$/.test(version)) existingVersions.add(version);
  }

  const backupDir = path.join(tempRootDir, `mixed-split-backup_${Date.now()}_${process.pid}`);
  await fs.promises.mkdir(backupDir, { recursive: true });
  const createdFiles: string[] = [];

  try {
    for (const fileName of fileNames) {
      const originalPath = path.join(migrationsDir, fileName);
      const originalSql = await fs.promises.readFile(originalPath, 'utf8');
      const statements = splitTopLevelSqlStatements(originalSql);
      const segments = buildSplitSegments(statements);
      if (segments.length <= 1) {
        throw new Error(`Cannot split ${fileName}: parser did not find separable schema/data statement groups.`);
      }

      const originalVersion = parseTimestampFromFileName(fileName);
      existingVersions.delete(originalVersion);
      const splitVersions = buildUniqueSplitVersions(originalVersion, segments.length, existingVersions);
      for (const version of splitVersions) existingVersions.add(version);

      const backupPath = path.join(backupDir, fileName);
      await fs.promises.rename(originalPath, backupPath);

      let index = 1;
      for (const segment of segments) {
        const splitFileName = createSplitFileName(fileName, splitVersions[index - 1], segment.kind, index);
        const splitPath = path.join(migrationsDir, splitFileName);
        const sql = `${segment.statements.join('\n\n')}\n`;
        await fs.promises.writeFile(splitPath, sql, 'utf8');
        createdFiles.push(splitFileName);
        index += 1;
      }
      console.log(ok(`Split ${fileName} into ${segments.length} migration files.`));
    }
  } catch (error) {
    for (const fileName of createdFiles) {
      await fs.promises.rm(path.join(migrationsDir, fileName), { force: true }).catch(() => undefined);
    }
    const backups = await fs.promises.readdir(backupDir).catch(() => []);
    for (const backupName of backups) {
      const from = path.join(backupDir, backupName);
      const to = path.join(migrationsDir, backupName);
      await fs.promises.rename(from, to).catch(() => undefined);
    }
    throw error;
  }

  return createdFiles;
}

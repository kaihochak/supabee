import fs from 'node:fs';
import path from 'node:path';
import { runCommandCapture } from './subprocess.js';
import { isValidMigrationVersion, parseMigrationListOutput } from './post-seed-cutoff.js';

const DDL_PATTERN =
  /\b(create|alter|drop)\s+(table|type|schema|extension|index|view|materialized|function|policy|trigger|publication|subscription)\b/i;
const DML_PATTERN = /\b(insert\s+into|delete\s+from|merge\s+into|truncate\s+table)\b/i;

type SplitKind = 'schema' | 'data';
type SplitSegment = { kind: SplitKind; statements: string[] };
type MigrationFile = { fileName: string; version: string; versionBigInt: bigint };
type PlannedOutput = {
  sourceFileName: string;
  sourceVersion: string;
  fileSuffix: string;
  content: string;
  kind: 'split' | 'renumber';
};

export type MixedSplitPlanChange = {
  beforeFileName: string;
  afterFileNames: string[];
  kind: 'split' | 'renumber';
};

export type MixedSplitPlan = {
  earliestTargetVersion: string;
  changes: MixedSplitPlanChange[];
  touchedFileNames: string[];
  // internal execution details
  _outputs: Array<PlannedOutput & { newVersion: string; newFileName: string }>;
};

function parseVersion(fileName: string): string {
  const prefix = fileName.split('_')[0];
  if (!/^\d+$/.test(prefix)) {
    throw new Error(`Cannot parse migration version from "${fileName}"`);
  }
  return prefix;
}

function parseBigIntVersion(version: string): bigint {
  if (!/^\d+$/.test(version)) {
    throw new Error(`Invalid migration version: ${version}`);
  }
  return BigInt(version);
}

function toBigInt(fileName: string): bigint {
  return parseBigIntVersion(parseVersion(fileName));
}

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
      result += c === '\n' ? '\n' : ' ';
      if (c === '\n') inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') {
        result += '  ';
        i += 2;
        inBlockComment = false;
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
      result += c === '\n' ? '\n' : ' ';
      if (c === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (inDouble) {
      result += c === '\n' ? '\n' : ' ';
      if (c === '"') inDouble = false;
      i += 1;
      continue;
    }

    if (c === '-' && n === '-') {
      result += '  ';
      i += 2;
      inLineComment = true;
      continue;
    }
    if (c === '/' && n === '*') {
      result += '  ';
      i += 2;
      inBlockComment = true;
      continue;
    }
    if (c === "'") {
      result += ' ';
      inSingle = true;
      i += 1;
      continue;
    }
    if (c === '"') {
      result += ' ';
      inDouble = true;
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
    const detected = classifyStatement(statement);
    const kind: SplitKind = detected === 'unknown' ? (current ? current.kind : 'schema') : detected;
    if (!current || current.kind !== kind) {
      current = { kind, statements: [statement] };
      segments.push(current);
    } else {
      current.statements.push(statement);
    }
  }

  return segments.filter((segment) => segment.statements.length > 0);
}

async function readMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = await fs.promises.readdir(migrationsDir, { withFileTypes: true });
  const files: MigrationFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
    const version = parseVersion(entry.name);
    files.push({ fileName: entry.name, version, versionBigInt: parseBigIntVersion(version) });
  }
  files.sort((a, b) =>
    a.versionBigInt !== b.versionBigInt ? (a.versionBigInt < b.versionBigInt ? -1 : 1) : a.fileName.localeCompare(b.fileName),
  );
  return files;
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

export async function buildMixedSplitPlan(options: {
  fileNames: string[];
  migrationsDir: string;
}): Promise<MixedSplitPlan> {
  const targetSet = new Set(options.fileNames);
  if (targetSet.size === 0) {
    throw new Error('No mixed migrations provided for split planning.');
  }

  const allFiles = await readMigrationFiles(options.migrationsDir);
  const fileMap = new Map(allFiles.map((f) => [f.fileName, f]));
  for (const fileName of targetSet) {
    if (!fileMap.has(fileName)) {
      throw new Error(`Mixed migration file not found: ${fileName}`);
    }
  }

  const earliestTargetBigInt = [...targetSet]
    .map((name) => toBigInt(name))
    .sort((a, b) => (a < b ? -1 : 1))[0];

  const untouchedPrefix = allFiles.filter((file) => file.versionBigInt < earliestTargetBigInt);
  const affected = allFiles.filter((file) => file.versionBigInt >= earliestTargetBigInt);

  const plannedOutputs: PlannedOutput[] = [];
  for (const file of affected) {
    const fullPath = path.join(options.migrationsDir, file.fileName);
    const originalSql = await fs.promises.readFile(fullPath, 'utf8');

    if (!targetSet.has(file.fileName)) {
      plannedOutputs.push({
        sourceFileName: file.fileName,
        sourceVersion: file.version,
        fileSuffix: file.fileName.replace(/^\d+_/, ''),
        content: originalSql,
        kind: 'renumber',
      });
      continue;
    }

    const statements = splitTopLevelSqlStatements(originalSql);
    const segments = buildSplitSegments(statements);
    if (segments.length <= 1) {
      throw new Error(`Cannot split ${file.fileName}: parser did not find separable schema/data groups.`);
    }
    const baseName = file.fileName.replace(/^\d+_/, '').replace(/\.sql$/i, '');
    let segmentIndex = 1;
    for (const segment of segments) {
      plannedOutputs.push({
        sourceFileName: file.fileName,
        sourceVersion: file.version,
        fileSuffix: `${baseName}_${segment.kind}_${segmentIndex}.sql`,
        content: `${segment.statements.join('\n\n')}\n`,
        kind: 'split',
      });
      segmentIndex += 1;
    }
  }

  let cursor = earliestTargetBigInt;
  const outputsWithVersions = plannedOutputs.map((output) => {
    const newVersion = cursor.toString();
    cursor += 1n;
    return {
      ...output,
      newVersion,
      newFileName: `${newVersion}_${output.fileSuffix}`,
    };
  });

  const changesBySource = new Map<string, MixedSplitPlanChange>();
  for (const output of outputsWithVersions) {
    const existing = changesBySource.get(output.sourceFileName);
    if (existing) {
      existing.afterFileNames.push(output.newFileName);
      existing.kind = existing.kind === 'split' || output.kind === 'split' ? 'split' : 'renumber';
    } else {
      changesBySource.set(output.sourceFileName, {
        beforeFileName: output.sourceFileName,
        afterFileNames: [output.newFileName],
        kind: output.kind,
      });
    }
  }

  const orderedChanges = [...changesBySource.values()].sort((a, b) => {
    const av = toBigInt(a.beforeFileName);
    const bv = toBigInt(b.beforeFileName);
    if (av !== bv) return av < bv ? -1 : 1;
    return a.beforeFileName.localeCompare(b.beforeFileName);
  });

  const touched = [...new Set(affected.map((f) => f.fileName))];
  const _ = untouchedPrefix; // prefix intentionally untouched; used for clarity during planning
  void _;

  return {
    earliestTargetVersion: earliestTargetBigInt.toString(),
    changes: orderedChanges,
    touchedFileNames: touched,
    _outputs: outputsWithVersions,
  };
}

export async function applyMixedSplitPlan(options: {
  plan: MixedSplitPlan;
  migrationsDir: string;
  tempRootDir: string;
}): Promise<void> {
  const { plan, migrationsDir, tempRootDir } = options;
  const remoteVersions = await readLinkedRemoteVersions();
  const blocked = plan.touchedFileNames.filter((fileName) => remoteVersions.has(parseVersion(fileName)));
  if (blocked.length > 0) {
    throw new Error(
      `Cannot rewrite migrations already applied on linked remote:\n${blocked.map((name) => `- ${name}`).join('\n')}\n` +
        'Only split/reindex migrations that are not pushed/applied.',
    );
  }

  const backupDir = path.join(tempRootDir, `mixed-split-backup_${Date.now()}_${process.pid}`);
  await fs.promises.mkdir(backupDir, { recursive: true });

  const createdFiles: string[] = [];
  const backedUpFiles: string[] = [];
  try {
    for (const fileName of plan.touchedFileNames) {
      const source = path.join(migrationsDir, fileName);
      const backup = path.join(backupDir, fileName);
      await fs.promises.rename(source, backup);
      backedUpFiles.push(fileName);
    }

    for (const output of plan._outputs) {
      const targetPath = path.join(migrationsDir, output.newFileName);
      await fs.promises.writeFile(targetPath, output.content, 'utf8');
      createdFiles.push(output.newFileName);
    }
  } catch (error) {
    for (const fileName of createdFiles) {
      await fs.promises.rm(path.join(migrationsDir, fileName), { force: true }).catch(() => undefined);
    }
    for (const fileName of backedUpFiles) {
      await fs.promises.rename(path.join(backupDir, fileName), path.join(migrationsDir, fileName)).catch(() => undefined);
    }
    throw error;
  }
}

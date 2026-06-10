import fs from 'node:fs';
import path from 'node:path';
import { stat, readdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import { ok, info, error as errText } from '../lib/ui.js';
import { resolveCommandConfig, type SchemaConfig } from '../lib/config.js';
import { prepareSplitOutputDir } from '../lib/output.js';
import { resolveStepPaths } from '../lib/command-contract.js';
import { runStepCommand } from '../lib/step-command.js';

const SCHEMA_FOLDERS = {
  extensions: '00_extensions',
  setup: '01_setup',
  types: '02_types',
  functions: '03_functions',
  tables: '04_tables',
  views: '05_views',
  constraints: '06_constraints',
  indexes: '07_indexes',
  foreign_keys: '08_foreign_keys',
  rls: '09_rls',
  permissions: '10_permissions',
  ownership: '11_ownership',
  others: '12_others',
} as const;
type SchemaCategory = keyof typeof SCHEMA_FOLDERS;
type SchemaFolders = Record<SchemaCategory, string>;
type ParsedStatement = { sql: string; lineStart: number; lineEnd: number };
type CategorizedStatement = { sql: string; name: string; filename: string; lineRange: string };
type CategorizedStatements = Record<SchemaCategory, CategorizedStatement[]>;
type RuntimeSchemaConfig = SchemaConfig & { indexPath: string; folders: SchemaFolders };
type IndexedStatement = { category: SchemaCategory; filename: string; lineRange: string; path: string };
type ReconstructFile = { startLine: number; content: string };

function buildRuntimeConfig(options: Partial<{ input: string; output: string; reconstructed: string }>): RuntimeSchemaConfig {
  const resolved = resolveCommandConfig('schema', options);
  return {
    ...resolved,
    indexPath: path.join(resolved.outputDir, 'order-index.json'),
    folders: SCHEMA_FOLDERS,
  };
}

function sanitizeForFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

function createFilename(name: string, seqNum: number): string {
  return `${String(seqNum).padStart(4, '0')}_${sanitizeForFilename(name)}.sql`;
}

function extractCreateTableName(sql: string): string {
  return (
    sql.match(
      /CREATE\s+(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+|GLOBAL\s+TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"?[a-zA-Z0-9_]+"?)\.)?"?([a-zA-Z0-9_]+)"?/i,
    )?.[1] || 'table'
  );
}

function extractStatements(sql: string): CategorizedStatements {
  const normalizedSql = sql.replace(/\r\n/g, '\n');
  const results: CategorizedStatements = {
    extensions: [],
    setup: [],
    types: [],
    functions: [],
    tables: [],
    views: [],
    constraints: [],
    indexes: [],
    foreign_keys: [],
    rls: [],
    permissions: [],
    ownership: [],
    others: [],
  };

  const statements: ParsedStatement[] = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';
  let inBlockComment = false;
  let lineStart = 1;

  const lines = normalizedSql.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line.includes('/*') && !inDollarQuote && !inBlockComment) inBlockComment = true;
    if (line.includes('*/') && inBlockComment) inBlockComment = false;

    if (!inDollarQuote) {
      const dollarStart = line.match(/\$([a-zA-Z0-9_]*)\$/);
      if (dollarStart && !line.includes(dollarStart[0], line.indexOf(dollarStart[0]) + dollarStart[0].length)) {
        inDollarQuote = true;
        dollarTag = dollarStart[1];
      }
    } else {
      const dollarEndPattern = new RegExp(`\\$${dollarTag}\\$`);
      if (line.match(dollarEndPattern)) {
        inDollarQuote = false;
        dollarTag = '';
      }
    }

    current += `${line}\n`;

    if (line.trim().endsWith(';') && !inDollarQuote && !inBlockComment) {
      statements.push({ sql: current, lineStart, lineEnd: lineNum });
      current = '';
      lineStart = lineNum + 1;
    }
  }

  if (current.trim()) statements.push({ sql: current, lineStart, lineEnd: lines.length });

  const seqNumbers = {
    extensions: 1,
    setup: 1,
    types: 1,
    functions: 1,
    tables: 1,
    views: 1,
    constraints: 1,
    indexes: 1,
    foreign_keys: 1,
    rls: 1,
    permissions: 1,
    ownership: 1,
    others: 1,
  };

  for (const statement of statements) {
    let categorySql = statement.sql;
    while (categorySql.trim().startsWith('--')) {
      categorySql = categorySql.substring(categorySql.indexOf('\n') + 1);
    }
    categorySql = categorySql.trim();
    const firstLine = categorySql.split('\n')[0].trim();
    const lineRange = `${statement.lineStart}-${statement.lineEnd}`;

    const push = (category: SchemaCategory, objectName: string) => {
      const seqNum = seqNumbers[category]++;
      results[category].push({
        sql: statement.sql,
        name: objectName,
        filename: createFilename(objectName, seqNum),
        lineRange,
      });
    };

    if (firstLine.match(/^CREATE\s+EXTENSION\b/i)) {
      push(
        'extensions',
        categorySql.match(/CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/i)?.[1] || 'extension',
      );
    } else if (firstLine.match(/^SET\s+|^SELECT\s+pg_catalog\.set_config|^COMMENT\s+ON\s+SCHEMA/i)) {
      push('setup', `setup_${seqNumbers.setup}`);
    } else if (firstLine.match(/^CREATE\s+TYPE\b/i) || categorySql.includes('CREATE TYPE')) {
      push('types', categorySql.match(/CREATE\s+TYPE\s+(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?/i)?.[1] || 'type');
    } else if (firstLine.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i) || categorySql.includes('CREATE FUNCTION')) {
      push(
        'functions',
        categorySql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?/i)?.[1] ||
          'function',
      );
    } else if (
      firstLine.match(/^CREATE\s+(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+|GLOBAL\s+TEMPORARY\s+)?TABLE\b/i) ||
      /\bCREATE\s+(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+|GLOBAL\s+TEMPORARY\s+)?TABLE\b/i.test(categorySql)
    ) {
      push('tables', extractCreateTableName(categorySql));
    } else if (firstLine.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i) || categorySql.includes('CREATE VIEW')) {
      push(
        'views',
        categorySql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?/i)?.[1] || 'view',
      );
    } else if (firstLine.match(/^\s*ALTER\s+TABLE\s+.*\bADD\s+CONSTRAINT\b.*\b(PRIMARY\s+KEY|UNIQUE)\b/i)) {
      push('constraints', categorySql.match(/ADD\s+CONSTRAINT\s+"?([a-zA-Z0-9_]+)"?/i)?.[1] || 'constraint');
    } else if (firstLine.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i) || categorySql.includes('CREATE INDEX')) {
      push(
        'indexes',
        categorySql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/i)?.[1] || 'index',
      );
    } else if (firstLine.match(/^\s*ALTER\s+TABLE\s+.*\bADD\s+CONSTRAINT\b.*\bFOREIGN\s+KEY\b/i)) {
      push('foreign_keys', categorySql.match(/ADD\s+CONSTRAINT\s+"?([a-zA-Z0-9_]+)"?/i)?.[1] || 'fk');
    } else if (
      firstLine.match(/^ALTER\s+TABLE\s+.*\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i) ||
      firstLine.match(/^CREATE\s+POLICY\b/i)
    ) {
      push('rls', firstLine.includes('CREATE POLICY') ? categorySql.match(/CREATE\s+POLICY\s+"([^"]+)"/i)?.[1] || 'policy' : 'rls_enable');
    } else if (firstLine.match(/^GRANT\s+/i)) {
      push('permissions', `grant_${seqNumbers.permissions}`);
    } else if (firstLine.match(/^ALTER\s+.*\bOWNER\s+TO\b/i)) {
      push('ownership', `ownership_${seqNumbers.ownership}`);
    } else {
      push('others', `other_${seqNumbers.others}`);
    }
  }

  return results;
}

async function writeStatements(config: RuntimeSchemaConfig, statements: CategorizedStatements) {
  for (const folder of Object.values(config.folders)) {
    await fs.promises.mkdir(path.join(config.outputDir, folder), { recursive: true });
  }

  const allStatements: IndexedStatement[] = [];
  for (const [category, items] of Object.entries(statements)) {
    const typedCategory = category as SchemaCategory;
    for (const item of items) {
      allStatements.push({
        category: typedCategory,
        filename: item.filename,
        lineRange: item.lineRange,
        path: path.join(config.folders[typedCategory], item.filename),
      });

      const filePath = path.join(config.outputDir, config.folders[typedCategory], item.filename);
      const metadataComment = '-- Original SQL from lines ' + item.lineRange + ' in prod.sql\n\n';
      await fs.promises.writeFile(filePath, metadataComment + item.sql, 'utf8');
    }
  }

  allStatements.sort((a, b) => parseInt(a.lineRange.split('-')[0], 10) - parseInt(b.lineRange.split('-')[0], 10));
  const indexData = allStatements.map((item) => {
    const [startLine, endLine] = item.lineRange.split('-').map((n) => parseInt(n, 10));
    return { path: item.path, startLine, endLine };
  });

  await fs.promises.writeFile(config.indexPath, JSON.stringify(indexData, null, 2), 'utf8');
  console.log(info(`Index entries: ${indexData.length} (${config.indexPath})`));
}

async function reconstructSql(config: RuntimeSchemaConfig) {
  let reconstructed = '';
  const processedFiles: ReconstructFile[] = [];

  for (const folder of Object.values(config.folders)) {
    const folderPath = path.join(config.outputDir, folder);
    try {
      const stats = await stat(folderPath);
      if (!stats.isDirectory()) continue;
    } catch {
      continue;
    }

    const files = await readdir(folderPath);
    for (const file of files) {
      if (path.extname(file) !== '.sql') continue;
      const content = await fs.promises.readFile(path.join(folderPath, file), 'utf8');
      const lineRangeMatch = content.match(/^-- Original SQL from lines (\d+)-(\d+)/);
      if (!lineRangeMatch) continue;

      processedFiles.push({
        startLine: parseInt(lineRangeMatch[1], 10),
        content: content.replace(/^-- Original SQL from lines.*?\n\n/s, ''),
      });
    }
  }

  processedFiles.sort((a, b) => a.startLine - b.startLine);
  for (const file of processedFiles) {
    reconstructed += file.content;
    if (!file.content.endsWith('\n')) reconstructed += '\n';
  }

  await fs.promises.writeFile(config.reconstructedFile, reconstructed, 'utf8');
  console.log(ok(`Reconstructed SQL written to: ${config.reconstructedFile}`));
}

async function validateReconstruction(config: RuntimeSchemaConfig): Promise<boolean> {
  const originalContent = await fs.promises.readFile(config.inputFile, 'utf8');
  const reconstructedContent = await fs.promises.readFile(config.reconstructedFile, 'utf8');

  const normalizeSql = (content: string) => `${content.replace(/\r\n/g, '\n').trimEnd()}\n`;
  const originalNormalized = normalizeSql(originalContent);
  const reconstructedNormalized = normalizeSql(reconstructedContent);

  const originalMd5 = crypto.createHash('md5').update(originalNormalized).digest('hex');
  const reconstructedMd5 = crypto.createHash('md5').update(reconstructedNormalized).digest('hex');

  if (originalMd5 === reconstructedMd5) {
    console.log(ok('Validation successful: schema matches after normalizing EOF whitespace.'));
    return true;
  }

  const originalLines = originalNormalized.split('\n');
  const reconstructedLines = reconstructedNormalized.split('\n');
  const maxLineCount = Math.max(originalLines.length, reconstructedLines.length);
  let firstDiffLine = -1;

  for (let i = 0; i < maxLineCount; i += 1) {
    if ((originalLines[i] ?? '') !== (reconstructedLines[i] ?? '')) {
      firstDiffLine = i + 1;
      break;
    }
  }

  console.log(errText('Validation failed: files do not match.'));
  if (firstDiffLine !== -1) {
    console.log(info(`First difference at line ${firstDiffLine}.`));
    console.log(info(`Original:      ${originalLines[firstDiffLine - 1] ?? '(EOF)'}`));
    console.log(info(`Reconstructed: ${reconstructedLines[firstDiffLine - 1] ?? '(EOF)'}`));
  }
  console.log(info(`Original lines: ${originalLines.length}`));
  console.log(info(`Reconstructed lines: ${reconstructedLines.length}`));
  return false;
}

export async function runSchemaCommand(args: string[]) {
  await runStepCommand(args, {
    commandName: 'schema',
    commandDisplayName: 'Schema',
    detailNote: (step) =>
      ({
        split: ' Splitting schema into files...',
        reconstruct: ' Reconstructing schema SQL from split files...',
        validate: ' Validating reconstructed schema against original...',
      })[step],
    buildDefaults: () => buildRuntimeConfig({}),
    buildStepConfig: ({ step, defaults, options, subcommand }) => {
      const stepPaths = resolveStepPaths({ defaults, options, subcommand, step });
      return {
        ...defaults,
        ...stepPaths,
        indexPath: path.join(stepPaths.outputDir, 'order-index.json'),
      };
    },
    getDetailLines: (step, config) => {
      if (step === 'split') {
        return [
          `input = ${config.inputFile}`,
          `output = ${config.outputDir}`,
          `keepFiles = ${config.keepFiles.length}`,
        ];
      }
      if (step === 'reconstruct') {
        return [
          `input = ${config.outputDir}`,
          `reconstructed = ${config.reconstructedFile}`,
        ];
      }
      return [
        `input = ${config.inputFile}`,
        `reconstructed = ${config.reconstructedFile}`,
      ];
    },
    actions: {
      split: async ({ config, options }) => {
        const shouldBackup = options.backup ?? config.backupByDefault;
        await prepareSplitOutputDir(config.outputDir, shouldBackup, 'Schema', { keepFiles: config.keepFiles });
        console.log(info(`Reading schema file: ${config.inputFile}`));
        const sqlContent = await fs.promises.readFile(config.inputFile, 'utf8');
        console.log(ok(`Loaded schema file: ${(sqlContent.length / 1024 / 1024).toFixed(2)}MB`));
        const statements = extractStatements(sqlContent);
        const statementCount = Object.values(statements).reduce((count, items) => count + items.length, 0);
        console.log(info(`Processing ${statementCount} statements...`));
        await writeStatements(config, statements);
        console.log(ok(`Schema split completed. Output: ${config.outputDir}`));
      },
      reconstruct: async ({ config }) => {
        await reconstructSql(config);
      },
      validate: async ({ config }) => {
        return validateReconstruction(config);
      },
    },
  });
}

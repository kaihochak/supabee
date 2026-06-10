import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { info, ok, error as errText } from '../lib/ui.js';
import { resolveCommandConfig, type DataConfig } from '../lib/config.js';
import { prepareSplitOutputDir } from '../lib/output.js';
import { runStepCommand } from '../lib/step-command.js';

type ParsedSeedContent = {
  tableContent: Record<string, string[]>;
  sequenceLines: string[];
  lineCount: number;
};

type EffectiveTableLimits = {
  maxLinesPerFile: number;
  maxStatementsPerFile: number;
  maxRowsPerInsert: number;
  skip: boolean;
};

function countLines(str: string): number {
  return str.split('\n').length;
}

function countRowsInInsertStatement(statement: string): number {
  const lines = statement.split('\n');
  let valuesStartIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().toUpperCase().includes('VALUES')) {
      valuesStartIndex = i;
      break;
    }
  }
  if (valuesStartIndex === -1) return 0;

  const valueLines = lines.slice(valuesStartIndex + 1);
  let rowCount = 0;
  let parenCount = 0;
  let inString = false;
  let stringChar = '';

  for (const line of valueLines) {
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const prevChar = i > 0 ? line[i - 1] : '';

      if (!inString) {
        if (char === "'" || char === '"') {
          inString = true;
          stringChar = char;
        } else if (char === '(') {
          parenCount += 1;
        } else if (char === ')') {
          parenCount -= 1;
        }
      } else if (char === stringChar && prevChar !== '\\') {
        inString = false;
        stringChar = '';
      }

      if (!inString && parenCount === 0 && (char === ',' || char === ';')) rowCount += 1;
    }
  }

  return rowCount;
}

function breakDownInsertStatement(statement: string, tableName: string, maxRowsPerInsert: number): string[] {
  if (!Number.isFinite(maxRowsPerInsert) || maxRowsPerInsert <= 0) return [statement];

  const lines = statement.split('\n');
  let valuesStartIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().toUpperCase().includes('VALUES')) {
      valuesStartIndex = i;
      break;
    }
  }

  if (valuesStartIndex === -1) return [statement];

  const header = lines.slice(0, valuesStartIndex + 1).join('\n');
  const valueLines = lines.slice(valuesStartIndex + 1);

  const valueRows: string[] = [];
  let currentRow = '';
  let parenCount = 0;
  let inString = false;
  let stringChar = '';

  for (const line of valueLines) {
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const prevChar = i > 0 ? line[i - 1] : '';

      if (!inString) {
        if (char === "'" || char === '"') {
          inString = true;
          stringChar = char;
        } else if (char === '(') {
          parenCount += 1;
        } else if (char === ')') {
          parenCount -= 1;
        }
      } else if (char === stringChar && prevChar !== '\\') {
        inString = false;
        stringChar = '';
      }

      currentRow += char;
      if (!inString && parenCount === 0 && (char === ',' || char === ';')) {
        valueRows.push(currentRow.trim().slice(0, -1));
        currentRow = '';
      }
    }

    if (currentRow.trim() && !currentRow.endsWith('\n')) currentRow += '\n';
  }

  if (currentRow.trim()) valueRows.push(currentRow.trim());

  if (valueRows.length <= maxRowsPerInsert) return [statement];

  const chunks: string[] = [];
  for (let i = 0; i < valueRows.length; i += maxRowsPerInsert) {
    const chunk = valueRows.slice(i, i + maxRowsPerInsert);
    chunks.push(`${header}\n\t${chunk.join(',\n\t')};`);
  }

  console.log(info(`Broke down ${tableName} INSERT statement: ${valueRows.length} rows -> ${chunks.length} statements`));
  return chunks;
}

// Streams the file line-by-line instead of reading it into a single string.
// Large seed dumps (>512 MiB) exceed V8's max string length, so a whole-file
// read throws "Cannot create a string longer than 0x1fffffe8 characters".
async function parseSeedFile(filePath: string): Promise<ParsedSeedContent> {
  const tableContent: Record<string, string[]> = {};
  const sequenceLines: string[] = [];
  let currentTable: string | null = null;
  let currentStatement: string[] = [];
  let inInsertStatement = false;
  let lineCount = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineCount += 1;

    // Sequence detection mirrors the original whole-file filter: it runs on
    // every line, independent of INSERT-statement parsing.
    if (line.includes('SEQUENCE SET') || (line.trim().startsWith('SELECT') && line.includes('setval'))) {
      sequenceLines.push(line);
    }

    if (!inInsertStatement && (line.trim().startsWith('--') || line.trim() === '')) continue;

    const insertMatch = line.match(/^INSERT\s+INTO\s+(["`']?)([^."`'\s(]+)\1\.(["`']?)([^."`'\s(]+)\3/i);

    if (insertMatch) {
      if (inInsertStatement && currentTable && currentStatement.length > 0) {
        if (!tableContent[currentTable]) tableContent[currentTable] = [];
        tableContent[currentTable].push(currentStatement.join('\n'));
      }

      currentTable = `${insertMatch[2]}.${insertMatch[4]}`;
      currentStatement = [line];
      inInsertStatement = true;
      continue;
    }

    if (inInsertStatement) {
      currentStatement.push(line);
      if (line.trim().endsWith(';') && currentTable) {
        if (!tableContent[currentTable]) tableContent[currentTable] = [];
        tableContent[currentTable].push(currentStatement.join('\n'));
        currentStatement = [];
        inInsertStatement = false;
      }
    }
  }

  if (inInsertStatement && currentTable && currentStatement.length > 0) {
    if (!tableContent[currentTable]) tableContent[currentTable] = [];
    tableContent[currentTable].push(currentStatement.join('\n'));
  }

  return { tableContent, sequenceLines, lineCount };
}

// Promise wrapper around stream.write so we can serialize chunked writes and
// surface backpressure/errors with await.
function writeChunk(stream: fs.WriteStream, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

function asPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function getEffectiveTableLimits(table: string, config: DataConfig): EffectiveTableLimits {
  const tableRule = config.tableRules?.[table];
  if (!tableRule || typeof tableRule !== 'object') return { ...config.limits, skip: false };

  return {
    maxLinesPerFile: asPositiveNumber(tableRule.maxLinesPerFile, config.limits.maxLinesPerFile),
    maxStatementsPerFile: asPositiveNumber(tableRule.maxStatementsPerFile, config.limits.maxStatementsPerFile),
    maxRowsPerInsert: asPositiveNumber(tableRule.maxRowsPerInsert, config.limits.maxRowsPerInsert),
    skip: tableRule.skip === true,
  };
}

function writeTableChunks(config: DataConfig, table: string, statements: string[], counter: number): number {
  const tableLimits = getEffectiveTableLimits(table, config);
  if (tableLimits.skip) {
    console.log(info(`Skipping table by rule: ${table}`));
    return counter;
  }

  const cleanTableName = table.replace(/\./g, '_');
  let fileCounter = 0;

  const processedStatements: string[] = [];
  for (const statement of statements) {
    const rowCount = countRowsInInsertStatement(statement);
    if (rowCount > tableLimits.maxRowsPerInsert) {
      processedStatements.push(...breakDownInsertStatement(statement, table, tableLimits.maxRowsPerInsert));
    } else {
      processedStatements.push(statement);
    }
  }

  statements = processedStatements;
  const totalLines = statements.reduce((acc, stmt) => acc + countLines(stmt), 0);
  const totalStatements = statements.length;

  const needsSplitByLines = totalLines > tableLimits.maxLinesPerFile;
  const needsSplitByStatements = totalStatements > tableLimits.maxStatementsPerFile;
  const needsSplitting = needsSplitByLines || needsSplitByStatements;

  if (!needsSplitting) {
    const filename = `${String(counter).padStart(3, '0')}_${cleanTableName}.sql`;
    fs.writeFileSync(path.join(config.outputDir, filename), statements.join('\n\n'));
    console.log(info(`Created ${filename} with ${totalStatements} statements (${totalLines} lines)`));
    return counter + 1;
  }

  let currentChunk: string[] = [];
  let currentLines = 0;
  let writtenFiles = 0;

  for (const statement of statements) {
    const statementLines = countLines(statement);
    const wouldExceedLines = currentLines + statementLines > tableLimits.maxLinesPerFile;
    const wouldExceedStatements = currentChunk.length >= tableLimits.maxStatementsPerFile;

    if ((wouldExceedLines || wouldExceedStatements) && currentChunk.length > 0) {
      const filename = `${String(counter).padStart(3, '0')}_${cleanTableName}_${String(fileCounter + 1).padStart(2, '0')}.sql`;
      fs.writeFileSync(path.join(config.outputDir, filename), currentChunk.join('\n\n'));
      console.log(info(`Created ${filename} with ${currentChunk.length} statements (${currentLines} lines)`));
      currentChunk = [];
      currentLines = 0;
      fileCounter += 1;
      writtenFiles += 1;
    }

    currentChunk.push(statement);
    currentLines += statementLines;
  }

  if (currentChunk.length > 0) {
    const filename = `${String(counter).padStart(3, '0')}_${cleanTableName}_${String(fileCounter + 1).padStart(2, '0')}.sql`;
    fs.writeFileSync(path.join(config.outputDir, filename), currentChunk.join('\n\n'));
    console.log(info(`Created ${filename} with ${currentChunk.length} statements (${currentLines} lines)`));
    writtenFiles += 1;
  }

  console.log(info(`Table ${table} split into ${writtenFiles} files`));
  return counter + 1;
}

async function splitData(config: DataConfig) {
  console.log(info(`Reading data file: ${config.inputFile}`));
  const fileSizeBytes = fs.statSync(config.inputFile).size;
  console.log(ok(`Loaded data file: ${(fileSizeBytes / 1024 / 1024).toFixed(2)}MB`));

  fs.writeFileSync(path.join(config.outputDir, '001_setup.sql'), "-- Initial setup\nSET session_replication_role = 'replica';\n");
  fs.writeFileSync(path.join(config.outputDir, '999_cleanup.sql'), '-- Cleanup\nRESET ALL;\n');

  const parsed = await parseSeedFile(config.inputFile);
  console.log(info(`Processing ${parsed.lineCount} lines...`));

  let counter = 2;
  for (const [table, statements] of Object.entries(parsed.tableContent)) {
    if (statements.length === 0) continue;
    counter = writeTableChunks(config, table, statements, counter);
  }

  if (parsed.sequenceLines.length > 0) {
    const sequenceFile = `${String(counter).padStart(3, '0')}_sequences.sql`;
    fs.writeFileSync(path.join(config.outputDir, sequenceFile), `-- Sequence values\n${parsed.sequenceLines.join('\n')}`);
    console.log(info(`Created ${sequenceFile} with ${parsed.sequenceLines.length} sequence statements`));
  }

  const createdFiles = fs.readdirSync(config.outputDir).filter((file) => file.endsWith('.sql')).length;
  console.log(info(`Created files: ${createdFiles}`));
  console.log(ok(`Data split completed. Output: ${config.outputDir}`));
}

function toRegexPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function shouldIgnoreFile(fileName: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => {
    if (pattern.includes('*')) return toRegexPattern(pattern).test(fileName);
    return pattern === fileName || pattern.endsWith(`/${fileName}`);
  });
}

async function reconstructData(config: DataConfig) {
  const files = fs
    .readdirSync(config.outputDir)
    .filter((file) => file.endsWith('.sql'))
    .filter((file) => !shouldIgnoreFile(file, config.ignoreInReconstruct))
    .sort((a, b) => a.localeCompare(b));

  // Stream the joined output so a >512 MiB reconstruction never has to exist
  // as a single in-memory string. Mirrors `${contents.join('\n\n')}\n`.
  const out = fs.createWriteStream(config.reconstructedFile, { encoding: 'utf8' });
  const finished = new Promise<void>((resolve, reject) => {
    out.on('error', reject);
    out.on('finish', resolve);
  });

  for (let i = 0; i < files.length; i += 1) {
    const content = fs.readFileSync(path.join(config.outputDir, files[i]), 'utf8').trimEnd();
    if (i > 0) await writeChunk(out, '\n\n');
    await writeChunk(out, content);
  }
  await writeChunk(out, '\n');
  out.end();
  await finished;

  console.log(ok(`Reconstructed data written to: ${config.reconstructedFile}`));
}

function getRowCountByTable(tableContent: Record<string, string[]>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [table, statements] of Object.entries(tableContent)) {
    counts[table] = statements.reduce((acc, statement) => acc + countRowsInInsertStatement(statement), 0);
  }
  return counts;
}

async function validateData(config: DataConfig): Promise<boolean> {
  const originalParsed = await parseSeedFile(config.inputFile);
  const reconstructedParsed = await parseSeedFile(config.reconstructedFile);

  const originalRows = getRowCountByTable(originalParsed.tableContent);
  const reconstructedRows = getRowCountByTable(reconstructedParsed.tableContent);

  const originalTables = Object.keys(originalRows).sort();
  const reconstructedTables = Object.keys(reconstructedRows).sort();

  const missingTables = originalTables.filter((table) => !Object.hasOwn(reconstructedRows, table));
  const extraTables = reconstructedTables.filter((table) => !Object.hasOwn(originalRows, table));

  const mismatchedCounts: Array<{ table: string; original: number; reconstructed: number }> = [];
  for (const table of originalTables) {
    if (!Object.hasOwn(reconstructedRows, table)) continue;
    if (originalRows[table] !== reconstructedRows[table]) {
      mismatchedCounts.push({ table, original: originalRows[table], reconstructed: reconstructedRows[table] });
    }
  }

  const originalSequenceCount = originalParsed.sequenceLines.length;
  const reconstructedSequenceCount = reconstructedParsed.sequenceLines.length;

  if (
    missingTables.length === 0 &&
    extraTables.length === 0 &&
    mismatchedCounts.length === 0 &&
    originalSequenceCount === reconstructedSequenceCount
  ) {
    console.log(ok('Validation successful: row counts and sequence statements match.'));
    console.log(info(`Tables: ${originalTables.length}`));
    console.log(info(`Sequence statements: ${originalSequenceCount}`));
    return true;
  }

  console.log(errText('Validation failed: reconstructed data does not match original source.'));
  if (missingTables.length > 0) console.log(info(`Missing tables: ${missingTables.join(', ')}`));
  if (extraTables.length > 0) console.log(info(`Unexpected tables: ${extraTables.join(', ')}`));
  if (mismatchedCounts.length > 0) {
    console.log(info(`Row count mismatches: ${mismatchedCounts.length}`));
    mismatchedCounts.slice(0, 10).forEach((item) => {
      console.log(info(`  ${item.table}: original=${item.original}, reconstructed=${item.reconstructed}`));
    });
  }
  if (originalSequenceCount !== reconstructedSequenceCount) {
    console.log(info(`Sequence mismatch: original=${originalSequenceCount}, reconstructed=${reconstructedSequenceCount}`));
  }

  return false;
}

export async function runDataCommand(args: string[]) {
  await runStepCommand(args, {
    commandName: 'data',
    commandDisplayName: 'Data',
    detailNote: (step) =>
      ({
        split: ' Splitting data into files...',
        reconstruct: ' Reconstructing data SQL from split files...',
        validate: ' Validating reconstructed data against original...',
      })[step],
    buildDefaults: () => resolveCommandConfig('data', {}),
    getDetailLines: (step, config) => {
      if (step === 'split') {
        return [
          `input = ${config.inputFile}`,
          `output = ${config.outputDir}`,
          `maxLinesPerFile = ${config.limits.maxLinesPerFile}`,
          `maxStatementsPerFile = ${config.limits.maxStatementsPerFile}`,
          `maxRowsPerInsert = ${config.limits.maxRowsPerInsert}`,
          `tableRules = ${Object.keys(config.tableRules || {}).length}`,
          `keepFiles = ${config.keepFiles.length}`,
        ];
      }
      if (step === 'reconstruct') {
        return [
          `input = ${config.outputDir}`,
          `reconstructed = ${config.reconstructedFile}`,
          `ignoreInReconstruct = ${config.ignoreInReconstruct.length}`,
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
        await prepareSplitOutputDir(config.outputDir, shouldBackup, 'Data', { keepFiles: config.keepFiles });
        await splitData(config);
      },
      reconstruct: async ({ config }) => {
        await reconstructData(config);
      },
      validate: async ({ config }) => {
        return validateData(config);
      },
    },
  });
}

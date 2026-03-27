// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { stat, readdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import { ok, info, error as errText } from '../lib/ui.js';
import { resolveCommandConfig } from '../lib/config.js';
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
};

function buildRuntimeConfig(options) {
  const resolved = resolveCommandConfig('schema', options);
  return {
    ...resolved,
    indexPath: path.join(resolved.outputDir, 'order-index.json'),
    folders: SCHEMA_FOLDERS,
  };
}

function sanitizeForFilename(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

function createFilename(name, seqNum) {
  return `${String(seqNum).padStart(4, '0')}_${sanitizeForFilename(name)}.sql`;
}

function extractStatements(sql) {
  const normalizedSql = sql.replace(/\r\n/g, '\n');
  const results = {
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

  const statements = [];
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

    const push = (category, objectName) => {
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
    } else if (firstLine.match(/^CREATE\s+TABLE\b/i) || categorySql.includes('CREATE TABLE')) {
      push(
        'tables',
        categorySql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?/i)?.[1] ||
          'table',
      );
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

async function writeStatements(config, statements) {
  for (const folder of Object.values(config.folders)) {
    await fs.promises.mkdir(path.join(config.outputDir, folder), { recursive: true });
  }

  const allStatements = [];
  for (const [category, items] of Object.entries(statements)) {
    for (const item of items) {
      allStatements.push({
        category,
        filename: item.filename,
        lineRange: item.lineRange,
        path: path.join(config.folders[category], item.filename),
      });

      const filePath = path.join(config.outputDir, config.folders[category], item.filename);
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
  console.log(ok(`Wrote ${indexData.length} index entries: ${config.indexPath}`));
}

async function reconstructSql(config) {
  let reconstructed = '';
  const processedFiles = [];

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

async function validateReconstruction(config) {
  const originalContent = await fs.promises.readFile(config.inputFile, 'utf8');
  const reconstructedContent = await fs.promises.readFile(config.reconstructedFile, 'utf8');

  const originalMd5 = crypto.createHash('md5').update(originalContent).digest('hex');
  const reconstructedMd5 = crypto.createHash('md5').update(reconstructedContent).digest('hex');

  if (originalMd5 === reconstructedMd5) {
    console.log(ok('Validation successful: files match exactly.'));
    return true;
  }

  console.log(errText('Validation failed: files do not match.'));
  console.log(info(`Original MD5: ${originalMd5}`));
  console.log(info(`Reconstructed MD5: ${reconstructedMd5}`));
  return false;
}

export async function runSchemaCommand(args) {
  await runStepCommand(args, {
    commandName: 'schema',
    commandDisplayName: 'Schema',
    detailNote: (step) =>
      ({
        split: ' Splitting schemas into files...',
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
        await prepareSplitOutputDir(config.outputDir, options.backup, 'Schema', { keepFiles: config.keepFiles });
        const sqlContent = await fs.promises.readFile(config.inputFile, 'utf8');
        const statements = extractStatements(sqlContent);
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

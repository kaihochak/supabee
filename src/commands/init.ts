// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  section,
  sectionWithNote,
  ok,
  warn,
  error as errText,
  diffAdd,
  diffRemove,
  info,
  title,
  pass,
  recommended,
} from '../lib/ui.js';
import { readToolConfig } from '../lib/config.js';

const SPLIT_SEED_PATH = './seeds/split/*.sql';
const SEED_FILES_NOTE = 'This is to configure the data files you will use for seeding the database';

function parseOptions(args) {
  const options = { help: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--help' || args[i] === '-h') {
      options.help = true;
    }
  }
  return options;
}

function getSeedSection(lines) {
  const start = lines.findIndex((line) => line.trim() === '[db.seed]');
  if (start === -1) {
    return { start: -1, end: -1 };
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('[')) {
      end = i;
      break;
    }
  }

  return { start, end };
}

function getCurrentSeedValues(content) {
  const lines = content.split('\n');
  const section = getSeedSection(lines);
  if (section.start === -1) {
    return {};
  }

  const values = {};
  for (let i = section.start + 1; i < section.end; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('enabled =')) {
      values.enabled = line.replace(/^enabled\s*=\s*/, '');
    } else if (line.startsWith('sql_paths =')) {
      values.sql_paths = line.replace(/^sql_paths\s*=\s*/, '');
    }
  }
  return values;
}

function printCurrentSeedValues(values) {
  if (!values.enabled && !values.sql_paths) return;
  console.log(sectionWithNote(title('Current [db.seed] values'), SEED_FILES_NOTE));
  const expectedEnabled = 'true';
  const expectedSqlPaths = `[${`'${SPLIT_SEED_PATH}'`}, ...existing custom paths]`;

  const enabledValue = values.enabled ?? '(missing)';
  if (enabledValue === expectedEnabled) {
    console.log(pass(`enabled = ${enabledValue}`));
  } else {
    console.log(`enabled = ${enabledValue} ${recommended(`(recommended: ${expectedEnabled})`)}`);
  }

  const sqlPathsValue = values.sql_paths ?? '(missing)';
  const sqlPathEntries = parseTomlArrayString(values.sql_paths);
  if (sqlPathEntries.includes(SPLIT_SEED_PATH)) {
    console.log(pass(`sql_paths = ${sqlPathsValue}`));
  } else {
    console.log(`sql_paths = ${sqlPathsValue} ${recommended(`(recommended: ${expectedSqlPaths})`)}`);
  }
  console.log('');
}

function parseTomlArrayString(value) {
  if (!value) return [];
  const matches = value.matchAll(/['"]([^'"]+)['"]/g);
  return Array.from(matches, (match) => match[1]);
}

function toTomlArrayLiteral(values) {
  return `[${values.map((value) => `'${value}'`).join(', ')}]`;
}

function dedupePaths(paths) {
  return Array.from(new Set(paths.filter((entry) => typeof entry === 'string' && entry.trim() !== '')));
}

function getConfiguredSeedSqlPaths(toolConfig) {
  const configured = toolConfig?.init?.seedSqlPaths;
  if (!Array.isArray(configured) || configured.length === 0) return null;
  return dedupePaths(configured);
}

function buildSeedSqlPathsTarget(existingSqlPaths, configuredSeedSqlPaths) {
  if (configuredSeedSqlPaths && configuredSeedSqlPaths.length > 0) {
    return `sql_paths = ${toTomlArrayLiteral(configuredSeedSqlPaths)}`;
  }

  const existing = parseTomlArrayString(existingSqlPaths);
  const merged = dedupePaths([SPLIT_SEED_PATH, ...existing.filter((entry) => entry !== SPLIT_SEED_PATH)]);
  return `sql_paths = ${toTomlArrayLiteral(merged)}`;
}

function ensureTrailingNewlineGap(lines) {
  if (lines.length === 0) return;
  if (lines[lines.length - 1].trim() !== '') {
    lines.push('');
  }
}

function buildPlan(content, configuredSeedSqlPaths) {
  const lines = content.split('\n');
  const plan = [];
  const currentValues = getCurrentSeedValues(content);

  const section = getSeedSection(lines);

  if (section.start === -1) {
    plan.push({
      title: 'Add [db.seed] section',
      before: null,
      after: '[db.seed]',
      apply: (targetLines) => {
        const current = getSeedSection(targetLines);
        if (current.start !== -1) return;
        ensureTrailingNewlineGap(targetLines);
        targetLines.push('[db.seed]');
      },
    });
  }

  const enabledTarget = 'enabled = true';
  plan.push({
    title: 'Enable [db.seed].enabled',
    before: null,
    after: enabledTarget,
    apply: (targetLines) => {
      const current = getSeedSection(targetLines);
      if (current.start === -1) return;

      for (let i = current.start + 1; i < current.end; i += 1) {
        if (/^\s*enabled\s*=/.test(targetLines[i])) {
          targetLines[i] = enabledTarget;
          return;
        }
      }

      targetLines.splice(current.end, 0, enabledTarget);
    },
    detectBefore: (sourceLines) => {
      const current = getSeedSection(sourceLines);
      if (current.start === -1) return null;
      for (let i = current.start + 1; i < current.end; i += 1) {
        if (/^\s*enabled\s*=/.test(sourceLines[i])) {
          return sourceLines[i].trim();
        }
      }
      return null;
    },
  });

  const sqlPathsTarget = buildSeedSqlPathsTarget(currentValues.sql_paths, configuredSeedSqlPaths);
  plan.push({
    title: 'Update [db.seed].sql_paths',
    description: SEED_FILES_NOTE,
    before: null,
    after: sqlPathsTarget,
    apply: (targetLines) => {
      const current = getSeedSection(targetLines);
      if (current.start === -1) return;

      for (let i = current.start + 1; i < current.end; i += 1) {
        if (/^\s*sql_paths\s*=/.test(targetLines[i])) {
          targetLines[i] = sqlPathsTarget;
          return;
        }
      }

      targetLines.splice(current.end, 0, sqlPathsTarget);
    },
    detectBefore: (sourceLines) => {
      const current = getSeedSection(sourceLines);
      if (current.start === -1) return null;
      for (let i = current.start + 1; i < current.end; i += 1) {
        if (/^\s*sql_paths\s*=/.test(sourceLines[i])) {
          return sourceLines[i].trim();
        }
      }
      return null;
    },
  });

  const effective = [];
  for (const item of plan) {
    const before = item.detectBefore ? item.detectBefore(lines) : item.before;

    if (before === item.after) {
      continue;
    }

    effective.push({
      title: item.title,
      description: item.description,
      before,
      after: item.after,
      apply: item.apply,
    });
  }

  return { lines, changes: effective };
}

async function confirmChanges(changes) {
  const rl = readline.createInterface({ input, output });
  const accepted = [];

  try {
    for (const change of changes) {
      console.log(
        change.description
          ? sectionWithNote(title(change.title), change.description)
          : section(title(change.title)),
      );
      if (change.before) {
        console.log(diffRemove(change.before));
      }
      console.log(diffAdd(change.after));
      console.log('');

      const answer = await rl.question('Apply this change? [y/N] ');
      const isAccepted = answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
      if (isAccepted) {
        accepted.push(change);
      }
    }
  } finally {
    rl.close();
  }

  return { accepted };
}

export async function runInitCommand(args) {
  const options = parseOptions(args);

  if (options.help) {
    console.log(`init command:
  supabase-splitter init
`);
    return;
  }

  const configPath = path.resolve(process.cwd(), 'supabase/config.toml');
  const toolConfig = readToolConfig();
  const configuredSeedSqlPaths = getConfiguredSeedSqlPaths(toolConfig);

  if (!fs.existsSync(configPath)) {
    console.error(errText(`config.toml not found: ${configPath}`));
    process.exit(1);
  }

  const original = fs.readFileSync(configPath, 'utf8');
  const { changes } = buildPlan(original, configuredSeedSqlPaths);

  if (changes.length === 0) {
    console.log(ok(`No changes needed: ${configPath}`));
    printCurrentSeedValues(getCurrentSeedValues(original));
    return;
  }

  const { accepted: selectedChanges } = await confirmChanges(changes);

  if (selectedChanges.length === 0) {
    console.log('');
    console.log(warn('No changes selected. Nothing written.'));
    printCurrentSeedValues(getCurrentSeedValues(original));
    return;
  }

  const nextLines = original.split('\n');
  for (const change of selectedChanges) {
    change.apply(nextLines);
  }

  const updated = nextLines.join('\n');

  if (updated === original) {
    console.log(info('Selected changes resulted in no file modifications.'));
    printCurrentSeedValues(getCurrentSeedValues(original));
    return;
  }

  fs.writeFileSync(configPath, updated, 'utf8');
  console.log('');
  console.log(ok(`Updated seed config in: ${configPath}`));
  printCurrentSeedValues(getCurrentSeedValues(updated));
}

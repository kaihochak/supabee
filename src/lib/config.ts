// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS, DEFAULT_TOOL_CONFIG_PATH } from './constants.js';
import { error as errText } from './ui.js';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function asStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.filter((entry) => typeof entry === 'string' && entry.trim() !== '');
}

function asTableRules(value) {
  return asObject(value);
}

export function readToolConfig() {
  const configPath = path.resolve(process.cwd(), DEFAULT_TOOL_CONFIG_PATH);
  if (!fs.existsSync(configPath)) return {};

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return asObject(parsed);
  } catch (error) {
    console.error(errText(`Invalid tool config JSON at ${configPath}: ${error.message}`));
    process.exit(1);
  }
}

function resolveSchemaConfig(toolConfig, cliOptions) {
  const configured = asObject(toolConfig.schema);
  const merged = { ...DEFAULTS.schema, ...configured };

  const inputValue = cliOptions.input ?? merged.input;
  const outputValue = cliOptions.output ?? merged.output;
  const reconstructedValue = cliOptions.reconstructed ?? merged.reconstructed;

  return {
    inputFile: path.resolve(process.cwd(), inputValue),
    outputDir: path.resolve(process.cwd(), outputValue),
    reconstructedFile: path.resolve(process.cwd(), reconstructedValue),
    keepFiles: asStringArray(merged.keepFiles),
  };
}

function resolveDataConfig(toolConfig, cliOptions) {
  const configured = asObject(toolConfig.data);
  const merged = { ...DEFAULTS.data, ...configured };

  const inputValue = cliOptions.input ?? merged.input;
  const outputValue = cliOptions.output ?? merged.output;
  const reconstructedValue = cliOptions.reconstructed ?? merged.reconstructed;

  return {
    inputFile: path.resolve(process.cwd(), inputValue),
    outputDir: path.resolve(process.cwd(), outputValue),
    reconstructedFile: path.resolve(process.cwd(), reconstructedValue),
    limits: {
      maxLinesPerFile: asNumber(merged.maxLinesPerFile, DEFAULTS.data.maxLinesPerFile),
      maxStatementsPerFile: asNumber(merged.maxStatementsPerFile, DEFAULTS.data.maxStatementsPerFile),
      maxRowsPerInsert: asNumber(merged.maxRowsPerInsert, DEFAULTS.data.maxRowsPerInsert),
    },
    tableRules: asTableRules(merged.tableRules),
    keepFiles: asStringArray(merged.keepFiles),
    ignoreInReconstruct: asStringArray(merged.ignoreInReconstruct),
  };
}

export function resolveCommandConfig(commandName, cliOptions) {
  const toolConfig = readToolConfig();
  if (commandName === 'schema') {
    return resolveSchemaConfig(toolConfig, cliOptions);
  }
  if (commandName === 'data') {
    return resolveDataConfig(toolConfig, cliOptions);
  }

  throw new Error(`Unsupported config command: ${commandName}`);
}

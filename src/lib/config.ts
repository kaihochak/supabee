import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULTS,
  DEFAULT_TOOL_CONFIG_PATH,
  LEGACY_TOOL_CONFIG_PATH,
  type DataTableRule,
  type ToolConfig,
} from './constants.js';
import { error as errText, warn as warnText } from './ui.js';

type UnknownRecord = Record<string, unknown>;

export type SchemaConfig = {
  inputFile: string;
  outputDir: string;
  reconstructedFile: string;
  backupByDefault: boolean;
  keepFiles: string[];
};

export type DataLimits = {
  maxLinesPerFile: number;
  maxStatementsPerFile: number;
  maxRowsPerInsert: number;
  maxBytesPerFile: number;
};

export type DataConfig = {
  inputFile: string;
  outputDir: string;
  reconstructedFile: string;
  backupByDefault: boolean;
  limits: DataLimits;
  tableRules: Record<string, DataTableRule>;
  keepFiles: string[];
  ignoreInReconstruct: string[];
};

function asObject(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

function asTableRules(value: unknown): Record<string, DataTableRule> {
  return asObject(value) as Record<string, DataTableRule>;
}

function resolveExistingToolConfigPath(): string | null {
  const primaryConfigPath = path.resolve(process.cwd(), DEFAULT_TOOL_CONFIG_PATH);
  const legacyConfigPath = path.resolve(process.cwd(), LEGACY_TOOL_CONFIG_PATH);

  if (fs.existsSync(primaryConfigPath)) {
    return primaryConfigPath;
  }

  if (fs.existsSync(legacyConfigPath)) {
    return legacyConfigPath;
  }

  return null;
}

function parseToolConfig(configPath: string): ToolConfig {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return asObject(parsed) as ToolConfig;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(errText(`Invalid tool config JSON at ${configPath}: ${message}`));
    process.exit(1);
  }
}

export function readToolConfig(): ToolConfig {
  const configPath = resolveExistingToolConfigPath();

  if (!configPath) return {};

  if (path.basename(configPath) === LEGACY_TOOL_CONFIG_PATH) {
    console.log(
      warnText(
        `Using legacy config file ${LEGACY_TOOL_CONFIG_PATH}. Consider renaming it to ${DEFAULT_TOOL_CONFIG_PATH}.`,
      ),
    );
  }

  return parseToolConfig(configPath);
}

export function resolveWritableToolConfigPath(): string {
  const configPath = resolveExistingToolConfigPath();
  if (configPath) return configPath;
  return path.resolve(process.cwd(), DEFAULT_TOOL_CONFIG_PATH);
}

export function writeToolConfig(config: ToolConfig): string {
  const configPath = resolveWritableToolConfigPath();
  const serialized = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(configPath, serialized, 'utf8');
  return configPath;
}

export function updateToolConfig(updater: (current: ToolConfig) => ToolConfig): string {
  const configPath = resolveWritableToolConfigPath();
  const current = fs.existsSync(configPath) ? parseToolConfig(configPath) : {};
  const next = updater(current);
  return writeToolConfig(next);
}

function resolveSchemaConfig(toolConfig: ToolConfig, cliOptions: Partial<{ input: string; output: string; reconstructed: string }>): SchemaConfig {
  const configured = asObject(toolConfig.schema);
  const merged = { ...DEFAULTS.schema, ...configured };

  const inputValue = cliOptions.input ?? merged.input;
  const outputValue = cliOptions.output ?? merged.output;
  const reconstructedValue = cliOptions.reconstructed ?? merged.reconstructed;

  return {
    inputFile: path.resolve(process.cwd(), inputValue),
    outputDir: path.resolve(process.cwd(), outputValue),
    reconstructedFile: path.resolve(process.cwd(), reconstructedValue),
    backupByDefault: asBoolean(merged.backup, DEFAULTS.schema.backup),
    keepFiles: asStringArray(merged.keepFiles),
  };
}

function resolveDataConfig(toolConfig: ToolConfig, cliOptions: Partial<{ input: string; output: string; reconstructed: string }>): DataConfig {
  const configured = asObject(toolConfig.data);
  const merged = { ...DEFAULTS.data, ...configured };

  const inputValue = cliOptions.input ?? merged.input;
  const outputValue = cliOptions.output ?? merged.output;
  const reconstructedValue = cliOptions.reconstructed ?? merged.reconstructed;

  return {
    inputFile: path.resolve(process.cwd(), inputValue),
    outputDir: path.resolve(process.cwd(), outputValue),
    reconstructedFile: path.resolve(process.cwd(), reconstructedValue),
    backupByDefault: asBoolean(merged.backup, DEFAULTS.data.backup),
    limits: {
      maxLinesPerFile: asNumber(merged.maxLinesPerFile, DEFAULTS.data.maxLinesPerFile),
      maxStatementsPerFile: asNumber(merged.maxStatementsPerFile, DEFAULTS.data.maxStatementsPerFile),
      maxRowsPerInsert: asNumber(merged.maxRowsPerInsert, DEFAULTS.data.maxRowsPerInsert),
      maxBytesPerFile: asNumber(merged.maxBytesPerFile, DEFAULTS.data.maxBytesPerFile),
    },
    tableRules: asTableRules(merged.tableRules),
    keepFiles: asStringArray(merged.keepFiles),
    ignoreInReconstruct: asStringArray(merged.ignoreInReconstruct),
  };
}

export function resolveCommandConfig(commandName: 'schema', cliOptions: Partial<{ input: string; output: string; reconstructed: string }>): SchemaConfig;
export function resolveCommandConfig(commandName: 'data', cliOptions: Partial<{ input: string; output: string; reconstructed: string }>): DataConfig;
export function resolveCommandConfig(commandName: string, cliOptions: Partial<{ input: string; output: string; reconstructed: string }>) {
  const toolConfig = readToolConfig();
  if (commandName === 'schema') {
    return resolveSchemaConfig(toolConfig, cliOptions);
  }
  if (commandName === 'data') {
    return resolveDataConfig(toolConfig, cliOptions);
  }

  throw new Error(`Unsupported config command: ${commandName}`);
}

import fs from 'node:fs';
import path from 'node:path';
import { readToolConfig } from './config.js';

export type MigrationClassification = 'data' | 'schema' | 'mixed' | 'unknown';
export type MigrationClassificationSource = 'marker' | 'heuristic';
export type RecommendedMarker = 'data' | 'schema' | null;

export type MigrationClassificationResult = {
  fileName: string;
  filePath: string;
  timestamp: number;
  classification: MigrationClassification;
  source: MigrationClassificationSource;
  reasons: string[];
  hasDataMarker: boolean;
  hasSchemaMarker: boolean;
  recommendedMarker: RecommendedMarker;
};

export type MigrationClassifierOptions = {
  migrationsDir: string;
};

const DEFAULT_DATA_MARKER = 'supabee:data-migration';
const DEFAULT_SCHEMA_MARKER = 'supabee:schema-migration';

const DDL_PATTERN =
  /\b(create|alter|drop)\s+(table|type|schema|extension|index|view|materialized|function|policy|trigger|publication|subscription)\b/i;
const DML_PATTERN = /\b(insert\s+into|update\s+\S+|delete\s+from|merge\s+into|truncate\s+table)\b/i;

function resolveDataMarker(): string {
  const configured = readToolConfig().dataMigrationMarker;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  return DEFAULT_DATA_MARKER;
}

function resolveSchemaMarker(): string {
  const configured = readToolConfig().schemaMigrationMarker;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  return DEFAULT_SCHEMA_MARKER;
}

function hasMarker(sql: string, marker: string): boolean {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^\\s*--\\s*${escaped}(?:\\s|$)`, 'im');
  return regex.test(sql);
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

async function listMigrations(migrationsDir: string): Promise<Array<{ fileName: string; timestamp: number }>> {
  const entries = await fs.promises.readdir(migrationsDir, { withFileTypes: true });
  const files: Array<{ fileName: string; timestamp: number }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
    const timestampPart = entry.name.split('_')[0];
    if (!/^\d+$/.test(timestampPart)) continue;
    files.push({ fileName: entry.name, timestamp: Number(timestampPart) });
  }

  files.sort((a, b) => (a.timestamp !== b.timestamp ? a.timestamp - b.timestamp : a.fileName.localeCompare(b.fileName)));
  return files;
}

function classifySql(sql: string): { classification: MigrationClassification; source: MigrationClassificationSource; reasons: string[]; hasDataMarker: boolean; hasSchemaMarker: boolean } {
  const dataMarker = resolveDataMarker();
  const schemaMarker = resolveSchemaMarker();
  const hasData = hasMarker(sql, dataMarker);
  const hasSchema = hasMarker(sql, schemaMarker);
  const normalized = stripCommentsAndStrings(sql);
  const hasDdl = DDL_PATTERN.test(normalized);
  const hasDml = DML_PATTERN.test(normalized);

  if (hasData && hasSchema) {
    return {
      classification: 'mixed',
      source: 'marker',
      reasons: [`Both markers found (${dataMarker}, ${schemaMarker}).`],
      hasDataMarker: true,
      hasSchemaMarker: true,
    };
  }
  if (hasDdl && hasDml) {
    const markerReason = hasData
      ? ` Marker present: -- ${dataMarker}.`
      : hasSchema
        ? ` Marker present: -- ${schemaMarker}.`
        : '';
    return {
      classification: 'mixed',
      source: hasData || hasSchema ? 'marker' : 'heuristic',
      reasons: [`Detected both schema DDL and data DML patterns.${markerReason}`],
      hasDataMarker: hasData,
      hasSchemaMarker: hasSchema,
    };
  }

  if (hasData) {
    return {
      classification: 'data',
      source: 'marker',
      reasons: [`Marker found: -- ${dataMarker}`],
      hasDataMarker: true,
      hasSchemaMarker: false,
    };
  }
  if (hasSchema) {
    return {
      classification: 'schema',
      source: 'marker',
      reasons: [`Marker found: -- ${schemaMarker}`],
      hasDataMarker: false,
      hasSchemaMarker: true,
    };
  }
  if (hasDml) {
    return {
      classification: 'data',
      source: 'heuristic',
      reasons: ['Detected data DML patterns (INSERT/UPDATE/DELETE/MERGE/TRUNCATE).'],
      hasDataMarker: false,
      hasSchemaMarker: false,
    };
  }
  if (hasDdl) {
    return {
      classification: 'schema',
      source: 'heuristic',
      reasons: ['Detected schema DDL patterns (CREATE/ALTER/DROP ...).'],
      hasDataMarker: false,
      hasSchemaMarker: false,
    };
  }

  return {
    classification: 'unknown',
    source: 'heuristic',
    reasons: ['No marker and no recognized DDL/DML patterns.'],
    hasDataMarker: false,
    hasSchemaMarker: false,
  };
}

function recommendedMarkerFor(result: {
  classification: MigrationClassification;
  hasDataMarker: boolean;
  hasSchemaMarker: boolean;
}): RecommendedMarker {
  if (result.classification === 'data' && !result.hasDataMarker) return 'data';
  if (result.classification === 'schema' && !result.hasSchemaMarker) return 'schema';
  return null;
}

export async function classifyMigrations(options: MigrationClassifierOptions): Promise<MigrationClassificationResult[]> {
  const migrations = await listMigrations(options.migrationsDir);
  const results: MigrationClassificationResult[] = [];

  for (const migration of migrations) {
    const filePath = path.join(options.migrationsDir, migration.fileName);
    const sql = await fs.promises.readFile(filePath, 'utf8');
    const classified = classifySql(sql);
    results.push({
      fileName: migration.fileName,
      filePath,
      timestamp: migration.timestamp,
      classification: classified.classification,
      source: classified.source,
      reasons: classified.reasons,
      hasDataMarker: classified.hasDataMarker,
      hasSchemaMarker: classified.hasSchemaMarker,
      recommendedMarker: recommendedMarkerFor({
        classification: classified.classification,
        hasDataMarker: classified.hasDataMarker,
        hasSchemaMarker: classified.hasSchemaMarker,
      }),
    });
  }

  return results;
}

export function resolveMarkers(): { dataMarker: string; schemaMarker: string } {
  return {
    dataMarker: resolveDataMarker(),
    schemaMarker: resolveSchemaMarker(),
  };
}

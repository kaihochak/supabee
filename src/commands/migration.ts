import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  classifyMigrations,
  resolveMarkers,
  type MigrationClassificationResult,
  type RecommendedMarker,
} from '../lib/migration-classifier.js';
import { info, ok, sectionWithNote, title, warn } from '../lib/ui.js';

const DEFAULT_MIGRATIONS_DIR = 'supabase/migrations';

export type MigrationAuditOptions = {
  migrationsDir?: string;
  json?: boolean;
  verbose?: boolean;
};

export type MigrationMarkOptions = {
  migrationsDir?: string;
  dryRun?: boolean;
  yes?: boolean;
};

export type MigrationUnmarkOptions = {
  migrationsDir?: string;
  dryRun?: boolean;
  yes?: boolean;
};

function absoluteMigrationsDir(dir?: string): string {
  return path.resolve(process.cwd(), dir ?? DEFAULT_MIGRATIONS_DIR);
}

async function ensureDirectoryExists(dirPath: string) {
  const stats = await fs.promises.stat(dirPath).catch(() => null);
  if (!stats || !stats.isDirectory()) {
    throw new Error(`Migrations directory not found: ${dirPath}`);
  }
}

function recommendationText(result: MigrationClassificationResult): string {
  if (result.classification === 'mixed') {
    return 'Split file into schema-only and data-only migrations';
  }
  if (result.classification === 'unknown') {
    return 'No automatic action';
  }
  if (!result.recommendedMarker) {
    return 'No marker change needed';
  }
  return `Add ${result.recommendedMarker} marker`;
}

function markerLine(markerType: RecommendedMarker, markers: { dataMarker: string; schemaMarker: string }): string {
  if (markerType === 'data') return `-- ${markers.dataMarker}`;
  if (markerType === 'schema') return `-- ${markers.schemaMarker}`;
  throw new Error('Invalid marker type');
}

function prependMarker(sql: string, marker: string): string {
  if (sql.startsWith('\uFEFF')) {
    const withoutBom = sql.slice(1);
    return `\uFEFF${marker}\n\n${withoutBom}`;
  }
  return `${marker}\n\n${sql}`;
}

function removeMarkerLines(
  sql: string,
  markers: { dataMarker: string; schemaMarker: string },
): { updated: string; removed: boolean } {
  const hadBom = sql.startsWith('\uFEFF');
  const raw = hadBom ? sql.slice(1) : sql;
  const lines = raw.split('\n');
  const markerValues = [markers.dataMarker, markers.schemaMarker];
  let removed = false;

  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    for (const marker of markerValues) {
      if (trimmed === `-- ${marker}` || trimmed === `--${marker}`) {
        removed = true;
        return false;
      }
    }
    return true;
  });

  const updated = kept.join('\n');
  return { updated: hadBom ? `\uFEFF${updated}` : updated, removed };
}

function printClassificationRow(result: MigrationClassificationResult) {
  console.log(info(`${result.fileName}`));
  console.log(info(`  class = ${result.classification} (${result.source})`));
  console.log(info(`  reason = ${result.reasons.join('; ')}`));
  console.log(info(`  recommendation = ${recommendationText(result)}`));
}

function printEvidenceRow(result: MigrationClassificationResult) {
  const markerBits =
    result.evidence.markerMatches.length > 0
      ? result.evidence.markerMatches.map((match) => `${match.marker}@L${match.line}`).join(', ')
      : 'none';
  const ddlBits =
    result.evidence.ddlMatches.length > 0
      ? result.evidence.ddlMatches.map((match) => `${match.pattern}@L${match.line}`).join(', ')
      : 'none';
  const dmlBits =
    result.evidence.dmlMatches.length > 0
      ? result.evidence.dmlMatches.map((match) => `${match.pattern}@L${match.line}`).join(', ')
      : 'none';

  console.log(info(`  evidence.markers = ${markerBits}`));
  console.log(info(`  evidence.ddl = ${ddlBits}`));
  console.log(info(`  evidence.dml = ${dmlBits}`));
}

function summarizeResults(results: MigrationClassificationResult[]) {
  let dataCount = 0;
  let schemaCount = 0;
  let mixedCount = 0;
  let unknownCount = 0;
  let suggestedMarkerCount = 0;

  for (const result of results) {
    if (result.classification === 'data') dataCount += 1;
    if (result.classification === 'schema') schemaCount += 1;
    if (result.classification === 'mixed') mixedCount += 1;
    if (result.classification === 'unknown') unknownCount += 1;
    if (result.recommendedMarker) suggestedMarkerCount += 1;
  }

  return { dataCount, schemaCount, mixedCount, unknownCount, suggestedMarkerCount };
}

export async function runMigrationAuditCommand(options: MigrationAuditOptions = {}) {
  const migrationsDir = absoluteMigrationsDir(options.migrationsDir);
  await ensureDirectoryExists(migrationsDir);
  const markers = resolveMarkers();
  const results = await classifyMigrations({ migrationsDir });
  const summary = summarizeResults(results);

  if (options.json === true) {
    const payload = {
      metadata: {
        migrationsDir,
        dataMarker: markers.dataMarker,
        schemaMarker: markers.schemaMarker,
        verbose: options.verbose === true,
      },
      summary: {
        data: summary.dataCount,
        schema: summary.schemaCount,
        mixed: summary.mixedCount,
        unknown: summary.unknownCount,
        suggestedMarkerUpdates: summary.suggestedMarkerCount,
      },
      results: results.map((result) => ({
        fileName: result.fileName,
        filePath: result.filePath,
        timestamp: result.timestamp,
        classification: result.classification,
        source: result.source,
        reasons: result.reasons,
        recommendation: recommendationText(result),
        recommendedMarker: result.recommendedMarker,
        hasDataMarker: result.hasDataMarker,
        hasSchemaMarker: result.hasSchemaMarker,
        ...(options.verbose === true ? { evidence: result.evidence } : {}),
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(sectionWithNote(title('Migration audit'), 'Classifies migration files as data/schema/mixed/unknown.'));
  console.log(info(`migrationsDir = ${migrationsDir}`));
  console.log(info(`dataMarker = ${markers.dataMarker}`));
  console.log(info(`schemaMarker = ${markers.schemaMarker}`));
  console.log(info(`verbose = ${options.verbose === true ? 'true' : 'false'}`));
  console.log('');

  if (results.length === 0) {
    console.log(warn('No migration files found.'));
    return;
  }

  for (const result of results) {
    printClassificationRow(result);
    if (options.verbose === true) {
      printEvidenceRow(result);
    }
  }

  console.log('');
  console.log(
    ok(
      `Summary: data=${summary.dataCount} schema=${summary.schemaCount} mixed=${summary.mixedCount} unknown=${summary.unknownCount}`,
    ),
  );
  console.log(info(`Suggested marker updates: ${summary.suggestedMarkerCount}`));
  if (summary.mixedCount > 0) {
    console.log(warn('Mixed files detected. Split schema and data into separate migration files.'));
  }
}

export async function runMigrationMarkCommand(options: MigrationMarkOptions = {}) {
  const migrationsDir = absoluteMigrationsDir(options.migrationsDir);
  await ensureDirectoryExists(migrationsDir);
  const markers = resolveMarkers();
  const results = await classifyMigrations({ migrationsDir });
  const mixed = results.filter((result) => result.classification === 'mixed');
  if (mixed.length > 0) {
    const names = mixed.map((m) => m.fileName).join(', ');
    throw new Error(
      `Cannot mark migrations while mixed schema+DML files exist: ${names}\nSplit each mixed migration into schema-only and data-only files, then re-run.`,
    );
  }

  const candidates = results.filter((result) => result.recommendedMarker !== null);
  console.log(sectionWithNote(title('Migration mark'), 'Suggests and applies marker comments to migration files.'));
  console.log(info(`migrationsDir = ${migrationsDir}`));
  console.log(info(`candidates = ${candidates.length}`));
  console.log('');

  if (candidates.length === 0) {
    console.log(ok('No marker updates needed.'));
    return;
  }

  for (const candidate of candidates) {
    const marker = markerLine(candidate.recommendedMarker, markers);
    console.log(info(`${candidate.fileName}`));
    console.log(info(`  add = ${marker}`));
    console.log(info(`  reason = ${candidate.reasons.join('; ')}`));
  }

  if (options.dryRun === true) {
    console.log('');
    console.log(info('Dry run only. Re-run without `--dry-run` to confirm and write markers.'));
    return;
  }

  const confirmed: MigrationClassificationResult[] = [];
  if (options.yes === true) {
    confirmed.push(...candidates);
  } else {
    const rl = readline.createInterface({ input, output });
    try {
      for (const candidate of candidates) {
        const marker = markerLine(candidate.recommendedMarker, markers);
        const answer = await rl.question(`Add "${marker}" to ${candidate.fileName}? [y/N] `);
        const accepted = answer.trim().toLowerCase();
        if (accepted === 'y' || accepted === 'yes') {
          confirmed.push(candidate);
        }
      }
    } finally {
      rl.close();
    }
  }

  if (confirmed.length === 0) {
    console.log('');
    console.log(warn('No marker updates selected. Nothing written.'));
    return;
  }

  for (const candidate of confirmed) {
    const marker = markerLine(candidate.recommendedMarker, markers);
    const original = await fs.promises.readFile(candidate.filePath, 'utf8');
    const updated = prependMarker(original, marker);
    await fs.promises.writeFile(candidate.filePath, updated, 'utf8');
    console.log(ok(`Updated ${candidate.fileName}`));
  }
}

export async function runMigrationUnmarkCommand(options: MigrationUnmarkOptions = {}) {
  const migrationsDir = absoluteMigrationsDir(options.migrationsDir);
  await ensureDirectoryExists(migrationsDir);
  const markers = resolveMarkers();
  const results = await classifyMigrations({ migrationsDir });
  const candidates = results.filter((result) => result.hasDataMarker || result.hasSchemaMarker);

  console.log(sectionWithNote(title('Migration unmark'), 'Removes marker comments from migration files.'));
  console.log(info(`migrationsDir = ${migrationsDir}`));
  console.log(info(`candidates = ${candidates.length}`));
  console.log('');

  if (candidates.length === 0) {
    console.log(ok('No marker lines found.'));
    return;
  }

  for (const candidate of candidates) {
    const removals: string[] = [];
    if (candidate.hasDataMarker) removals.push(`-- ${markers.dataMarker}`);
    if (candidate.hasSchemaMarker) removals.push(`-- ${markers.schemaMarker}`);
    console.log(info(`${candidate.fileName}`));
    console.log(info(`  remove = ${removals.join(', ')}`));
    console.log(info(`  reason = explicit marker override cleanup`));
  }

  if (options.dryRun === true) {
    console.log('');
    console.log(info('Dry run only. Re-run without `--dry-run` to confirm and remove markers.'));
    return;
  }

  const confirmed: MigrationClassificationResult[] = [];
  if (options.yes === true) {
    confirmed.push(...candidates);
  } else {
    const rl = readline.createInterface({ input, output });
    try {
      for (const candidate of candidates) {
        const answer = await rl.question(`Remove markers from ${candidate.fileName}? [y/N] `);
        const accepted = answer.trim().toLowerCase();
        if (accepted === 'y' || accepted === 'yes') {
          confirmed.push(candidate);
        }
      }
    } finally {
      rl.close();
    }
  }

  if (confirmed.length === 0) {
    console.log('');
    console.log(warn('No files selected. Nothing written.'));
    return;
  }

  for (const candidate of confirmed) {
    const original = await fs.promises.readFile(candidate.filePath, 'utf8');
    const { updated, removed } = removeMarkerLines(original, markers);
    if (!removed) {
      console.log(warn(`Skipped ${candidate.fileName}; no marker line found at write time.`));
      continue;
    }
    await fs.promises.writeFile(candidate.filePath, updated, 'utf8');
    console.log(ok(`Updated ${candidate.fileName}`));
  }
}

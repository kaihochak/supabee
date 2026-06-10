import { hr, green, red } from './ui.js';

export type ResetClassification = 'data' | 'schema' | 'mixed' | 'unknown';
export type ResetMode = 'reset' | 'start';

export type ClassifiedMigrationLite = {
  timestamp: number;
  classification: ResetClassification;
};

export type ResetOutcome =
  | { status: 'success' }
  | {
      status: 'failure';
      step: number;
      stepLabel: string;
      errorMessage: string;
      restoreOk: boolean;
      newApplied: boolean;
    };

export type RenderResetSummaryOptions = {
  mode: ResetMode;
  classified: ClassifiedMigrationLite[];
  cutoffRaw: string;
  cutoff: number;
  outcome: ResetOutcome;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Canonical render order + display labels for each classification.
const CLASS_ORDER: ResetClassification[] = ['schema', 'data', 'mixed', 'unknown'];
const CLASS_LABEL: Record<ResetClassification, string> = {
  schema: 'schema',
  data: 'data',
  mixed: 'schema+data',
  unknown: 'unrecognized',
};

const HR_WIDTH = 60;
const DETAIL_INDENT = '     '; // 5 spaces: header labels sit at 2, detail numbers at 5
const ARROW_JOIN = '   → '; // 3-space gap before the arrow

type Grid = Record<ResetClassification, number>;

export function formatDeployDate(raw: string): { full: string; short: string } {
  const digits = raw.trim();
  if (digits.length < 8 || !/^\d{8}/.test(digits)) {
    return { full: digits, short: digits };
  }
  const year = digits.slice(0, 4);
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const monthName = MONTHS[month - 1] ?? digits.slice(4, 6);
  const short = `${monthName} ${day}`;
  return { full: `${short} ${year}`, short };
}

function gridFor(classified: ClassifiedMigrationLite[], keep: (m: ClassifiedMigrationLite) => boolean): Grid {
  const grid: Grid = { schema: 0, data: 0, mixed: 0, unknown: 0 };
  for (const migration of classified) {
    if (!keep(migration)) continue;
    grid[migration.classification] += 1;
  }
  return grid;
}

function gridTotal(grid: Grid): number {
  return grid.schema + grid.data + grid.mixed + grid.unknown;
}

function parts(grid: Grid, includeKeys: ResetClassification[]): string {
  const segments: string[] = [];
  for (const key of CLASS_ORDER) {
    if (!includeKeys.includes(key)) continue;
    if (grid[key] <= 0) continue;
    segments.push(`${grid[key]} ${CLASS_LABEL[key]}`);
  }
  return segments.join(' · ');
}

function leadingDigits(text: string): number {
  const match = text.match(/^\d+/);
  return match ? match[0].length : 0;
}

// Right-aligns the leading number of each row, then aligns the arrows into one column.
function alignDetailRows(rows: Array<{ parts: string; arrow: string }>): string[] {
  if (rows.length === 0) return [];
  const countWidth = Math.max(...rows.map((row) => leadingDigits(row.parts)));
  const lefts = rows.map((row) => DETAIL_INDENT + ' '.repeat(countWidth - leadingDigits(row.parts)) + row.parts);
  const maxLeft = Math.max(...lefts.map((left) => left.length));
  return rows.map((row, index) => `${lefts[index].padEnd(maxLeft)}${ARROW_JOIN}${row.arrow}`);
}

function renderSuccess(options: RenderResetSummaryOptions, deploy: { full: string; short: string }): string[] {
  const { classified, cutoff, mode } = options;
  const verb = mode === 'reset' ? 'Reset' : 'Start';

  const preGrid = gridFor(classified, (m) => m.timestamp <= cutoff);
  const postGrid = gridFor(classified, (m) => m.timestamp > cutoff);
  const preTotal = gridTotal(preGrid);
  const postTotal = gridTotal(postGrid);

  // Detail rows are aligned together so the arrow column is shared across sections.
  const preRebuildParts = parts(preGrid, ['schema', 'mixed', 'unknown']);
  const preSkippedParts = parts(preGrid, ['data']);
  const postParts = parts(postGrid, CLASS_ORDER);

  const detailSpecs: Array<{ section: 'pre' | 'post'; parts: string; arrow: string }> = [];
  if (preRebuildParts) detailSpecs.push({ section: 'pre', parts: preRebuildParts, arrow: 'ran during rebuild' });
  if (preSkippedParts) detailSpecs.push({ section: 'pre', parts: preSkippedParts, arrow: 'skipped (already in seed)' });
  if (postParts) detailSpecs.push({ section: 'post', parts: postParts, arrow: 'applied after seeding' });

  const aligned = alignDetailRows(detailSpecs);
  const preLines = aligned.filter((_, index) => detailSpecs[index].section === 'pre');
  const postLines = aligned.filter((_, index) => detailSpecs[index].section === 'post');

  const lines: string[] = [];
  lines.push(hr(HR_WIDTH));
  lines.push(`${green('✔')} ${verb} complete — local DB matches a fresh production deploy`);
  lines.push(`  Last deploy: ${deploy.full} · ${classified.length} migrations`);
  lines.push(`  Already deployed (≤ ${deploy.short}) — ${preTotal}`);
  lines.push(...preLines);
  lines.push(`  New since deploy (> ${deploy.short}) — ${postTotal}`);
  lines.push(...postLines);
  lines.push(hr(HR_WIDTH));
  return lines;
}

function renderFailure(
  options: RenderResetSummaryOptions,
  deploy: { full: string; short: string },
): string[] {
  const { classified, cutoff, mode, outcome } = options;
  if (outcome.status !== 'failure') return [];
  const verb = mode === 'reset' ? 'Reset' : 'Start';

  const preGrid = gridFor(classified, (m) => m.timestamp <= cutoff);
  const postGrid = gridFor(classified, (m) => m.timestamp > cutoff);
  const preTotal = gridTotal(preGrid);
  const postTotal = gridTotal(postGrid);

  // Mirror the success layout: rebuild classes first, then the stubbed `data` group last.
  const preParts = [parts(preGrid, ['schema', 'mixed', 'unknown']), parts(preGrid, ['data'])]
    .filter(Boolean)
    .join(' · ');
  const labelWidth = Math.max('Already deployed'.length, 'New since deploy'.length);
  const preLabel = 'Already deployed'.padEnd(labelWidth);
  const postLabel = 'New since deploy'.padEnd(labelWidth);

  const lines: string[] = [];
  lines.push(hr(HR_WIDTH));
  lines.push(`${red('✗')} ${verb} FAILED at STEP ${outcome.step} (${outcome.stepLabel})`);
  for (const errorLine of outcome.errorMessage.split('\n')) {
    lines.push(`  ${errorLine}`);
  }
  if (outcome.restoreOk) {
    lines.push(`  ${green('✔')} Migration folder restored to original — your files are safe`);
  } else {
    lines.push(`  ${red('✗')} Restore incomplete — check .tmp-migrations/ before re-running`);
  }
  lines.push('  Attempted plan:');
  lines.push(`  ${preLabel} (≤ ${deploy.short}) — ${preTotal}${preParts ? `  (${preParts})` : ''}`);

  let postSuffix = '';
  if (postTotal > 0) {
    postSuffix = outcome.newApplied
      ? `  (${parts(postGrid, CLASS_ORDER)})`
      : '  — NOT applied (failed before this step)';
  }
  lines.push(`  ${postLabel} (> ${deploy.short}) — ${postTotal}${postSuffix}`);
  lines.push(hr(HR_WIDTH));
  return lines;
}

export function renderResetSummary(options: RenderResetSummaryOptions): string {
  const deploy = formatDeployDate(options.cutoffRaw);
  const lines =
    options.outcome.status === 'success' ? renderSuccess(options, deploy) : renderFailure(options, deploy);
  return lines.join('\n');
}

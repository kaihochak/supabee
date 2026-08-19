import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin as input, stdout as output } from 'node:process';
import { runCommand } from '../lib/subprocess.js';
import { sectionWithNote, title, info, ok, fail, warn } from '../lib/ui.js';
import { parseCutoffTimestamp, resolvePostSeedCutoff } from '../lib/post-seed-cutoff.js';
import { classifyMigrations } from '../lib/migration-classifier.js';
import { applyMixedSplitPlan, buildMixedSplitPlan, type MixedSplitPlan } from '../lib/mixed-migration-splitter.js';
import { renderResetSummary, type ClassifiedMigrationLite } from '../lib/reset-summary.js';
import { runSeedRemoteCommand } from './seed-remote.js';

export type PostSeedCommandOptions = {
  psql?: boolean;
  migrationsDir?: string;
  tempDir?: string;
  env?: string;
  strictMixed?: boolean;
  /** Target the linked Supabase project instead of the local database (reset only). */
  linked?: boolean;
  /** Target an explicit Postgres connection string instead of the local database (reset only). */
  dbUrl?: string;
  /** Skip the interactive remote-reset confirmation prompt (for CI / non-interactive runs). */
  yes?: boolean;
  /** Reset with --no-seed, then seed via the resumable direct-psql path. Implicit with --linked. */
  resumableSeed?: boolean;
  /** Keep triggers/FK checks active during resumable seeding (default: disabled, like a restore). */
  keepTriggers?: boolean;
};

type RemoteTarget = { args: string[]; label: string; isDbUrl: boolean };

/**
 * Resolve whether the run targets a remote database and, if so, the supabase CLI
 * flags to forward. Returns null for a local run. Throws on invalid flag combos.
 *
 * A remote reset is destructive: `supabase db reset --linked/--db-url` wipes the
 * target's public schema and reseeds it from local seed files. The destructive
 * confirmation is handled separately by confirmRemoteReset().
 */
function resolveRemoteTarget(mode: PostSeedMode, options: PostSeedCommandOptions): RemoteTarget | null {
  const linked = options.linked === true;
  const dbUrl = options.dbUrl;
  if (!linked && !dbUrl) return null;

  if (mode !== 'reset') {
    throw new Error('Remote targets (--linked / --db-url) are only supported by `db reset`, not `start`.');
  }
  if (linked && dbUrl) {
    throw new Error('Use either --linked or --db-url, not both.');
  }
  if (options.psql === true) {
    throw new Error('--psql applies migrations to the local database only; it cannot be combined with a remote target.');
  }

  // Forward supabase's own global --yes so the underlying `supabase db reset` /
  // `migration up` do not prompt again. supabee has already gated the destructive
  // action via confirmRemoteReset(), so a second downstream prompt would be a
  // redundant double-confirm interactively and a hang ("context canceled") in CI.
  return dbUrl
    ? { args: ['--db-url', dbUrl, '--yes'], label: 'remote (--db-url)', isDbUrl: true }
    : { args: ['--linked', '--yes'], label: 'linked remote project', isDbUrl: false };
}

function validateDirectDbUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid database URL. Expected postgresql://user:password@host:5432/postgres?sslmode=require.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('Invalid database URL. Expected a postgres:// or postgresql:// connection string.');
  }
  if (parsed.port && parsed.port !== '5432') {
    throw new Error('Use the direct database connection on port 5432, not the transaction pooler on port 6543.');
  }
  return value;
}

async function promptForSecret(question: string): Promise<string> {
  let muted = false;
  const silentOutput = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) output.write(chunk);
      callback();
    },
  });
  const rl = readline.createInterface({ input, output: silentOutput, terminal: true });
  try {
    const answerPromise = rl.question(question);
    muted = true;
    const answer = await answerPromise;
    muted = false;
    output.write('\n');
    return answer;
  } finally {
    rl.close();
  }
}

async function resolveLinkedDbUrl(): Promise<string> {
  const fromEnv = process.env.SUPABASE_DB_URL?.trim() || process.env.PGURI?.trim();
  if (fromEnv) return validateDirectDbUrl(fromEnv);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      '`supabee db reset --linked` needs a direct database URL for resumable seeding.\n' +
        'Set SUPABASE_DB_URL or PGURI to the direct port-5432 connection string.',
    );
  }

  console.log(info('Direct database URL required.'));
  console.log(info('Find it in Supabase Dashboard -> your project -> Connect -> Direct connection.'));
  console.log(info('Copy the port-5432 URI and replace [YOUR-PASSWORD] with your database password.'));
  console.log(info('Input is hidden.'));
  const dbUrl = (await promptForSecret('Database URL: ')).trim();
  if (!dbUrl) throw new Error('Database URL is required for a linked remote reset.');
  return validateDirectDbUrl(dbUrl);
}

/**
 * Confirm a destructive remote reset before any files are touched. Returns true
 * to proceed. `--yes` skips the prompt; a non-interactive shell without `--yes`
 * refuses rather than wiping a remote database unattended.
 */
async function confirmRemoteReset(target: RemoteTarget, options: PostSeedCommandOptions): Promise<boolean> {
  if (options.yes === true) return true;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Refusing to reset a remote database in a non-interactive shell without confirmation.\n' +
        'This WIPES the target database and reseeds it from your local seed files.\n' +
        'Re-run with --yes to proceed.',
    );
  }

  console.log(
    warn(`About to reset ${target.label}. This WIPES the target database and reseeds it from your local seed files.`),
  );
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`Reset ${target.label}? [y/N] `);
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

type PostSeedMode = 'reset' | 'start';

const DEFAULT_MIGRATIONS_DIR = 'supabase/migrations';
const DEFAULT_TEMP_DIR = 'supabase/.tmp-migrations';
const DATA_MIGRATION_STUB_HEADER = '-- supabee:auto-stub:data-migration';

function buildDataMigrationStub(fileName: string, cutoffTimestampRaw: string): string {
  return `${DATA_MIGRATION_STUB_HEADER}
-- original file: ${fileName}
-- reason: historical data migration at/before cutoff ${cutoffTimestampRaw}
SELECT 1;
`;
}

async function stubHistoricalDataMigrations(
  fileNames: string[],
  migrationsDir: string,
  stubOriginalsDir: string,
  cutoffTimestampRaw: string,
) {
  if (fileNames.length === 0) return;

  await fs.promises.mkdir(stubOriginalsDir, { recursive: true });
  for (const fileName of fileNames) {
    const sourcePath = path.join(migrationsDir, fileName);
    const originalPath = path.join(stubOriginalsDir, fileName);
    await fs.promises.rename(sourcePath, originalPath);
    await fs.promises.writeFile(sourcePath, buildDataMigrationStub(fileName, cutoffTimestampRaw), 'utf8');
  }
}

async function restoreStubbedMigrations(fileNames: string[], stubOriginalsDir: string, migrationsDir: string) {
  if (fileNames.length === 0) return;

  for (const fileName of fileNames) {
    const liveStubPath = path.join(migrationsDir, fileName);
    const originalPath = path.join(stubOriginalsDir, fileName);
    await fs.promises.rm(liveStubPath, { force: true });
    await fs.promises.rename(originalPath, liveStubPath);
  }
}

async function moveFiles(fileNames: string[], fromDir: string, toDir: string) {
  await fs.promises.mkdir(toDir, { recursive: true });
  for (const fileName of fileNames) {
    await fs.promises.rename(path.join(fromDir, fileName), path.join(toDir, fileName));
  }
}

async function removeIfEmpty(dirPath: string) {
  try {
    const entries = await fs.promises.readdir(dirPath);
    if (entries.length === 0) {
      await fs.promises.rmdir(dirPath);
    }
  } catch {
    // ignore cleanup errors
  }
}

async function ensureDirectoryExists(dirPath: string) {
  const stats = await fs.promises.stat(dirPath).catch(() => null);
  if (!stats || !stats.isDirectory()) {
    throw new Error(`Migrations directory not found: ${dirPath}`);
  }
}

function modeDisplayName(mode: PostSeedMode): string {
  return mode === 'reset' ? 'DB reset' : 'Start';
}

function modeCommandLabel(mode: PostSeedMode): string {
  return mode === 'reset' ? 'supabase db reset' : 'supabase start';
}

function printSplitPlan(
  plan: MixedSplitPlan,
  classificationsByFile: Map<string, string>,
) {
  console.log(info('Proposed migration rewrite (before -> after):'));
  for (const change of plan.changes) {
    const classification = classificationsByFile.get(change.beforeFileName) ?? 'unknown';
    console.log(info(`  ${change.beforeFileName} [${classification}]`));
    for (const after of change.afterFileNames) {
      console.log(info(`    -> ${after}`));
    }
  }
}

async function promptForSplit(
  plan: MixedSplitPlan,
  classificationsByFile: Map<string, string>,
): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  printSplitPlan(plan, classificationsByFile);
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question('Apply this migration rewrite and continue? [y/N] ');
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

async function runPostSeedCommand(
  mode: PostSeedMode,
  cutoffTimestampRaw: string | undefined,
  options: PostSeedCommandOptions = {},
) {
  // Fail fast on invalid flag combinations before touching the cutoff or disk.
  let remoteTarget = resolveRemoteTarget(mode, options);
  const linkedTarget = options.linked === true;
  let effectiveDbUrl = options.dbUrl?.trim();
  let resumableSeed = options.resumableSeed === true;

  if (resumableSeed && !remoteTarget) {
    throw new Error('--resumable-seed requires a remote target (--linked or --db-url).');
  }

  // Linked resets use the resumable path by default. Obtain the DB URL before
  // confirmation so the actual hostname is shown to the user.
  if (linkedTarget) {
    effectiveDbUrl = await resolveLinkedDbUrl();
    remoteTarget = {
      args: ['--db-url', effectiveDbUrl, '--yes'],
      label: `linked remote project at ${new URL(effectiveDbUrl).hostname} (resumable seed)`,
      isDbUrl: true,
    };
    resumableSeed = true;
  }

  if (resumableSeed && !effectiveDbUrl) {
    throw new Error('--resumable-seed requires --db-url, SUPABASE_DB_URL, or PGURI.');
  }

  // Confirm the destructive remote reset up front, before cutoff detection or disk work.
  if (remoteTarget) {
    const confirmed = await confirmRemoteReset(remoteTarget, options);
    if (!confirmed) {
      console.log(info('Aborted. No changes made.'));
      return;
    }
  }

  const resolvedCutoff = await resolvePostSeedCutoff(cutoffTimestampRaw, { env: options.env });
  const resolvedCutoffRaw = resolvedCutoff.value;
  const cutoff = parseCutoffTimestamp(resolvedCutoffRaw);

  const migrationsDir = path.resolve(process.cwd(), options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
  const tempRootDir = path.resolve(process.cwd(), options.tempDir ?? DEFAULT_TEMP_DIR);
  const activeTempDir = path.join(tempRootDir, `deferred_${Date.now()}_${process.pid}`);
  const activeStubDir = path.join(tempRootDir, `stubbed_${Date.now()}_${process.pid}`);
  const usePsql = options.psql === true;
  const strictMixed = options.strictMixed === true;
  const applyLabel = usePsql ? 'psql' : 'supabase migration up';

  await ensureDirectoryExists(migrationsDir);

  console.log(
    sectionWithNote(
      title(modeDisplayName(mode)),
      `Defers post-seed migrations, runs ${modeCommandLabel(mode)}, restores files, then reapplies deferred migrations.`,
    ),
  );

  // ---- Classify migrations and resolve mixed files before touching anything on disk ----
  let classified = await classifyMigrations({ migrationsDir });
  let mixedFiles = classified.filter((migration) => migration.classification === 'mixed');
  let mixedAfterCutoff = mixedFiles.filter((migration) => migration.timestamp > cutoff);
  if (strictMixed && mixedFiles.length > 0) {
    const mixedList = mixedFiles.map((migration) => `- ${migration.fileName} (${migration.reasons.join('; ')})`).join('\n');
    throw new Error(
      `Mixed schema+DML migrations are not supported with --strict-mixed.\n` +
        `Split each mixed migration into separate schema-only and data-only files:\n${mixedList}`,
    );
  }

  // Mixed migrations at/before cutoff are already applied on the linked remote, so they
  // cannot be auto-split (renumbering applied history is blocked). They run verbatim during
  // reset, and any embedded DML re-runs on top of the seed/dump — a common source of
  // duplicate-key collisions. Warn by default (compatibility mode); --strict-mixed fails instead.
  const mixedAtOrBeforeCutoff = mixedFiles.filter((migration) => migration.timestamp <= cutoff);
  if (mixedAtOrBeforeCutoff.length > 0) {
    console.log(
      warn(`${mixedAtOrBeforeCutoff.length} mixed schema+DML migration(s) at/before cutoff will run as-is (compatibility mode):`),
    );
    for (const migration of mixedAtOrBeforeCutoff) {
      console.log(info(`  ${migration.fileName} (${migration.reasons.join('; ')})`));
    }
    console.log(
      info(
        'These are already applied on the linked remote, so supabee cannot auto-split them. Their embedded DML re-runs during reset and may collide with seed/dump rows (e.g. duplicate primary keys). Make the DML idempotent or move it out of the migration, or pass --strict-mixed to fail fast.',
      ),
    );
    console.log('');
  }

  if (mixedAfterCutoff.length > 0) {
    const plan = await buildMixedSplitPlan({
      fileNames: mixedAfterCutoff.map((migration) => migration.fileName),
      migrationsDir,
    });
    const classificationsByFile = new Map(classified.map((m) => [m.fileName, m.classification]));
    const splitConfirmed = await promptForSplit(plan, classificationsByFile);
    if (!splitConfirmed) {
      const mixedList = mixedAfterCutoff
        .map((migration) => `- ${migration.fileName} (${migration.reasons.join('; ')})`)
        .join('\n');
      throw new Error(
        `Mixed schema+DML migrations detected after cutoff ${resolvedCutoffRaw}.\n` +
          `Split each mixed migration into separate schema-only and data-only files:\n${mixedList}`,
      );
    }

    const { backupDir } = await applyMixedSplitPlan({
      plan,
      migrationsDir,
      tempRootDir,
    });
    console.log(info(`Backup of originals kept at: ${backupDir}`));

    classified = await classifyMigrations({ migrationsDir });
    mixedFiles = classified.filter((migration) => migration.classification === 'mixed');
    mixedAfterCutoff = mixedFiles.filter((migration) => migration.timestamp > cutoff);
    if (mixedAfterCutoff.length > 0) {
      const mixedList = mixedAfterCutoff
        .map((migration) => `- ${migration.fileName} (${migration.reasons.join('; ')})`)
        .join('\n');
      throw new Error(
        `Mixed schema+DML migrations still remain after auto-split.\n` +
          `Please split manually:\n${mixedList}`,
      );
    }
    console.log(ok('Auto-split completed for post-cutoff mixed migrations.'));
  }

  // ---- Build the plan: which files are deferred (after cutoff) vs stubbed (historical data) ----
  const replayDeferred = classified.filter((migration) => migration.timestamp > cutoff);
  const replayDeferredNames = replayDeferred.map((migration) => migration.fileName);
  const historicalDataMigrations = classified.filter(
    (migration) => migration.timestamp <= cutoff && migration.classification === 'data',
  );
  const historicalDataMigrationNames = historicalDataMigrations.map((migration) => migration.fileName);

  const classifiedLite: ClassifiedMigrationLite[] = classified.map((migration) => ({
    timestamp: migration.timestamp,
    classification: migration.classification,
  }));

  const cutoffSourceSuffix =
    resolvedCutoff.source === 'linked'
      ? ' (auto-detected from linked project)'
      : resolvedCutoff.source === 'config'
        ? ' (from postSeedCutoff in config)'
        : '';

  // ---- Failure tracking for the end-of-run summary ----
  let failedStep = 0;
  let stepLabel = '';
  let failureMessage = '';
  let restoreOk = true;
  let newApplied = false;
  let movedReplayDeferred = false;
  let stubbedHistorical = false;

  const printSummary = () => {
    if (failedStep > 0) {
      console.log(
        renderResetSummary({
          mode,
          classified: classifiedLite,
          cutoffRaw: resolvedCutoffRaw,
          cutoff,
          outcome: {
            status: 'failure',
            step: failedStep,
            stepLabel,
            errorMessage: failureMessage,
            restoreOk,
            newApplied,
          },
        }),
      );
      throw new Error(`${modeDisplayName(mode)} failed at STEP ${failedStep} (${stepLabel}).`);
    }
    console.log(
      renderResetSummary({
        mode,
        classified: classifiedLite,
        cutoffRaw: resolvedCutoffRaw,
        cutoff,
        outcome: { status: 'success' },
      }),
    );
  };

  if (remoteTarget) {
    console.log(info(`Target: ${remoteTarget.label}`));
    if (remoteTarget.isDbUrl && !linkedTarget && resolvedCutoff.source === 'linked') {
      console.log(
        warn(
          'Cutoff was auto-detected from the linked project, which may differ from the --db-url target. Pass an explicit cutoff if they are not the same database.',
        ),
      );
    }
    console.log('');
  }

  console.log(info(`cutoff = ${resolvedCutoffRaw}${cutoffSourceSuffix}`));
  console.log('');

  // ---- 1) Announce the plan, then defer post-cutoff migrations and stub historical data migrations ----
  if (replayDeferredNames.length > 0) {
    console.log(info(`Deferring ${replayDeferredNames.length} migrations after ${resolvedCutoffRaw}:`));
    for (const fileName of replayDeferredNames) {
      console.log(info(`  ${fileName}`));
    }
  } else {
    console.log(info(`No migrations found after ${resolvedCutoffRaw}.`));
  }
  if (historicalDataMigrationNames.length > 0) {
    console.log(
      info(`Stubbing ${historicalDataMigrationNames.length} historical data migrations at/before ${resolvedCutoffRaw}:`),
    );
    for (const fileName of historicalDataMigrationNames) {
      console.log(info(`  ${fileName}`));
    }
  }
  console.log('');

  try {
    if (replayDeferredNames.length > 0) {
      await moveFiles(replayDeferredNames, migrationsDir, activeTempDir);
      movedReplayDeferred = true;
      console.log(ok(`Moved ${replayDeferredNames.length} migrations to ${activeTempDir}`));
      console.log('');
    }
    if (historicalDataMigrationNames.length > 0) {
      await stubHistoricalDataMigrations(historicalDataMigrationNames, migrationsDir, activeStubDir, resolvedCutoffRaw);
      stubbedHistorical = true;
      console.log(ok(`Stubbed ${historicalDataMigrationNames.length} historical data migrations in-place`));
      console.log('');
    }
  } catch (error) {
    failedStep = 1;
    stepLabel = 'prepare migrations';
    failureMessage = error instanceof Error ? error.message : String(error);
  }

  // ---- 2) Run the base command (reset/start) ----
  if (failedStep === 0) {
    try {
      // In resumable-seed mode, reset with --no-seed so the schema is rebuilt
      // cleanly and fast; the data is loaded afterwards by the direct-psql step.
      const resetArgs = ['db', 'reset', ...(remoteTarget?.args ?? [])];
      if (resumableSeed) resetArgs.push('--no-seed');
      console.log(info(`Running ${modeCommandLabel(mode)}${resumableSeed ? ' (--no-seed)' : ''}...`));
      await runCommand('supabase', mode === 'reset' ? resetArgs : ['start']);
      console.log(ok(`${modeCommandLabel(mode)} completed.`));
    } catch (error) {
      failedStep = 2;
      stepLabel = modeCommandLabel(mode);
      failureMessage = error instanceof Error ? error.message : String(error);
    }
  }

  // ---- 3) Restore migration files (always run when we changed files on disk) ----
  if (movedReplayDeferred || stubbedHistorical) {
    const restoreErrors: string[] = [];
    if (movedReplayDeferred) {
      try {
        await moveFiles(replayDeferredNames, activeTempDir, migrationsDir);
        console.log(ok(`Restored deferred migrations to ${migrationsDir}`));
      } catch (error) {
        restoreErrors.push(
          `Failed restoring deferred migrations: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (stubbedHistorical) {
      try {
        await restoreStubbedMigrations(historicalDataMigrationNames, activeStubDir, migrationsDir);
        console.log(ok(`Restored original SQL for ${historicalDataMigrationNames.length} historical data migrations`));
      } catch (error) {
        restoreErrors.push(
          `Failed restoring stubbed historical migrations: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    await removeIfEmpty(activeTempDir);
    await removeIfEmpty(activeStubDir);
    await removeIfEmpty(tempRootDir);

    if (restoreErrors.length > 0) {
      restoreOk = false;
      for (const message of restoreErrors) {
        console.log(fail(message));
      }
      if (failedStep === 0) {
        failedStep = 3;
        stepLabel = 'restore files';
        failureMessage = restoreErrors.join('\n');
      }
    }
  }

  // ---- 4) Seed remote via resumable direct-psql path (only in --resumable-seed mode) ----
  if (failedStep === 0 && resumableSeed) {
    try {
      console.log('');
      await runSeedRemoteCommand({ dbUrl: effectiveDbUrl, keepTriggers: options.keepTriggers });
    } catch (error) {
      failedStep = 4;
      stepLabel = 'seed remote (psql)';
      failureMessage = error instanceof Error ? error.message : String(error);
      // seed-remote already printed a `--from` resume command. After the data is
      // fully seeded, the deferred post-cutoff migrations still need applying.
      // Do not print the credential-bearing URL back to the terminal.
      const migrationTarget = linkedTarget ? '--linked --yes' : "--db-url '<direct-database-url>' --yes";
      console.log(
        warn(`Once seeding is complete, finish by applying the post-cutoff migrations: supabase migration up ${migrationTarget}`),
      );
    }
  }

  // ---- 5) Reapply deferred migrations ----
  if (failedStep === 0 && replayDeferredNames.length > 0) {
    try {
      if (usePsql) {
        console.log(info('Applying deferred migrations via psql...'));
        for (const fileName of replayDeferredNames) {
          const migrationPath = path.join(migrationsDir, fileName);
          console.log(info(`  ${fileName}`));
          await runCommand(
            'psql',
            ['-h', '127.0.0.1', '-p', '6543', '-U', 'postgres', '-d', 'postgres', '-f', migrationPath, '-v', 'ON_ERROR_STOP=1'],
            { env: { PGPASSWORD: 'postgres' } },
          );
        }
      } else {
        console.log(info('Applying deferred migrations via supabase migration up...'));
        await runCommand('supabase', ['migration', 'up', ...(remoteTarget?.args ?? [])]);
      }
      newApplied = true;
    } catch (error) {
      failedStep = 5;
      stepLabel = applyLabel;
      failureMessage = error instanceof Error ? error.message : String(error);
    }
  }

  console.log('');
  printSummary();
}

export async function runDbResetCommand(
  cutoffTimestampRaw: string | undefined,
  options: PostSeedCommandOptions = {},
) {
  await runPostSeedCommand('reset', cutoffTimestampRaw, options);
}

export async function runStartCommand(
  cutoffTimestampRaw: string | undefined,
  options: PostSeedCommandOptions = {},
) {
  await runPostSeedCommand('start', cutoffTimestampRaw, options);
}

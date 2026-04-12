import fs from 'node:fs';
import { resolveCommandConfig } from '../lib/config.js';
import { info, ok, sectionWithNote, title, warn } from '../lib/ui.js';
import { runSchemaCommand } from './schema.js';
import { runDataCommand } from './data.js';
import { runCommandCapture, runCommandToFile } from '../lib/subprocess.js';
import {
  compareMigrationVersions,
  isValidMigrationVersion,
  parseMigrationListOutput,
  type MigrationListRow,
} from '../lib/post-seed-cutoff.js';

export type SyncTarget = 'schema' | 'data';

export type SyncCommandOptions = {
  input?: string;
  output?: string;
  backup?: boolean;
  force?: boolean;
};

function buildWorkflowArgs(inputFile: string, options: SyncCommandOptions) {
  const args = ['--input', inputFile];
  if (options.output) args.push('--output', options.output);
  if (options.backup === false) {
    args.push('--no-backup');
  } else if (options.backup) {
    args.push('--backup');
  }
  return args;
}

async function assertDumpHasContent(filePath: string) {
  const stats = await fs.promises.stat(filePath);
  if (stats.size === 0) {
    throw new Error(
      `Supabase dump produced an empty file: ${filePath}\nAborting before split so existing output files are not cleared.`,
    );
  }
}

function latestVersionFromRows(rows: MigrationListRow[], key: 'local' | 'remote'): string | null {
  const versions = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (isValidMigrationVersion(value)) versions.add(value);
  }

  let latest: string | null = null;
  for (const version of versions) {
    if (!latest || compareMigrationVersions(version, latest) > 0) {
      latest = version;
    }
  }
  return latest;
}

async function assertLinkedMigrationAlignmentForSync(force: boolean) {
  try {
    const { stdout } = await runCommandCapture('supabase', ['migration', 'list', '--linked']);
    const rows = parseMigrationListOutput(stdout);
    if (rows.length === 0) {
      if (force) {
        console.log(warn('Linked migration alignment preflight returned no rows. Continuing due to --force.'));
        return;
      }
      throw new Error('Linked migration alignment preflight returned no rows.');
    }

    const latestLocal = latestVersionFromRows(rows, 'local');
    const latestRemote = latestVersionFromRows(rows, 'remote');
    if (latestLocal === latestRemote) return;

    const message = `Local/remote migrations are not aligned (latestLocal=${latestLocal ?? '(none)'} latestRemote=${latestRemote ?? '(none)'}).`;
    if (force) {
      console.log(warn(`${message} Continuing due to --force.`));
      return;
    }
    throw new Error(`${message} Re-run with --force to override.`);
  } catch (error) {
    if (force) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(warn(`Could not validate linked migration alignment. Continuing due to --force. Details: ${message}`));
      return;
    }
    throw error;
  }
}

export async function runSyncCommand(target: SyncTarget, options: SyncCommandOptions = {}) {
  await assertLinkedMigrationAlignmentForSync(options.force === true);

  const resolved =
    target === 'schema'
      ? resolveCommandConfig('schema', { input: options.input, output: options.output })
      : resolveCommandConfig('data', { input: options.input, output: options.output });

  const dumpArgs = target === 'schema' ? ['db', 'dump'] : ['db', 'dump', '--data-only'];
  const workflowLabel = target === 'schema' ? 'Sync schema' : 'Sync data';

  console.log(
    sectionWithNote(
      title(workflowLabel),
      target === 'schema'
        ? 'Dumping from linked Supabase project, then running split -> reconstruct -> validate.'
        : 'Dumping from linked Supabase project, then running split -> reconstruct -> validate.',
    ),
  );
  console.log(info(`Dump destination: ${resolved.inputFile}`));
  console.log(info(`Processing output: ${resolved.outputDir}`));
  console.log('');

  await runCommandToFile('supabase', dumpArgs, resolved.inputFile);
  console.log(ok(`Dump written to: ${resolved.inputFile}`));
  await assertDumpHasContent(resolved.inputFile);

  const workflowArgs = buildWorkflowArgs(resolved.inputFile, options);
  if (target === 'schema') {
    await runSchemaCommand(workflowArgs);
    return;
  }

  await runDataCommand(workflowArgs);
}

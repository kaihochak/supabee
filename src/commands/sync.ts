import { resolveCommandConfig } from '../lib/config.js';
import { info, ok, sectionWithNote, title } from '../lib/ui.js';
import { runSchemaCommand } from './schema.js';
import { runDataCommand } from './data.js';
import { runCommandToFile } from '../lib/subprocess.js';

export type SyncTarget = 'schema' | 'data';

export type SyncCommandOptions = {
  input?: string;
  output?: string;
  backup?: boolean;
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

export async function runSyncCommand(target: SyncTarget, options: SyncCommandOptions = {}) {
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

  const workflowArgs = buildWorkflowArgs(resolved.inputFile, options);
  if (target === 'schema') {
    await runSchemaCommand(workflowArgs);
    return;
  }

  await runDataCommand(workflowArgs);
}

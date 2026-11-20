import type { Command } from 'commander';
import { runSchemaCommand } from '../../commands/schema.js';
import { buildStepArgs, type StepCliOptions } from '../step-args.js';

export function registerSchemaCommand(program: Command): void {
  program
    .command('schema [step] [reconstructed]')
    .description('schema split/reconstruct/validate (process an existing local dump)')
    .option('--input <path>', 'Input SQL file or split folder (reconstruct)')
    .option('--output <path>', 'Split output folder (split) or reconstructed file')
    .option('--backup', 'Backup existing split output before replacing')
    .option('--no-backup', 'Do not backup dirty split output folder before split')
    .action((step?: string, reconstructed?: string, options: StepCliOptions = {}) =>
      runSchemaCommand(buildStepArgs(step, reconstructed, options)),
    );
}

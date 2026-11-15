import type { Command } from 'commander';
import { runDataCommand } from '../../commands/data.js';
import { buildStepArgs, type StepCliOptions } from '../step-args.js';

export function registerDataCommand(program: Command): void {
  program
    .command('data [step] [reconstructed]')
    .description('data split/reconstruct/validate (process an existing local dump)')
    .option('--input <path>', 'Input SQL file or split folder (reconstruct)')
    .option('--output <path>', 'Split output folder (split) or reconstructed file')
    .option('--backup', 'Backup existing split output before replacing')
    .option('--no-backup', 'Do not backup dirty split output folder before split')
    .action((step?: string, reconstructed?: string, options: StepCliOptions = {}) =>
      runDataCommand(buildStepArgs(step, reconstructed, options)),
    );
}

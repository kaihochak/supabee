import type { Command } from 'commander';
import { runCutoffDetectCommand, type CutoffDetectOptions } from '../../commands/cutoff.js';

export function registerCutoffCommand(program: Command): void {
  const cutoffCommand = program.command('cutoff').description('Cutoff detection helpers');

  cutoffCommand
    .command('detect [cutoffTimestamp]')
    .description('Resolve cutoff from argument, linked migration alignment, or configured fallback')
    .option('--env <name>', 'Environment key used for postSeedCutoffByEnv fallback lookup')
    .option('--json', 'Print machine-readable JSON output')
    .action((cutoffTimestamp: string | undefined, options: CutoffDetectOptions = {}) =>
      runCutoffDetectCommand(cutoffTimestamp, options),
    );
}

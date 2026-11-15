import type { Command } from 'commander';
import { runInitCommand } from '../../commands/init.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Create config (if missing) and update supabase/config.toml seed paths')
    .action(async () => {
      await runInitCommand([]);
    });
}

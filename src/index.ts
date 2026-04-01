#!/usr/bin/env node

import { Command } from 'commander';
import { runSchemaCommand } from './commands/schema.js';
import { runDataCommand } from './commands/data.js';
import { runInitCommand } from './commands/init.js';
import { error as errText } from './lib/ui.js';

type StepCliOptions = {
  input?: string;
  output?: string;
  backup?: boolean;
};

function buildStepArgs(step?: string, reconstructed?: string, options: StepCliOptions = {}): string[] {
  const args: string[] = [];
  if (step) args.push(step);
  if (options.input) args.push('--input', options.input);
  if (options.output) args.push('--output', options.output);
  if (options.backup) args.push('--backup');
  if (reconstructed) args.push(reconstructed);
  return args;
}

const program = new Command();
program
  .name('supabee')
  .description(
    'Split large Supabase schema/data dumps into organized, version-control-friendly SQL files.',
  )
  .showHelpAfterError('(run with --help for usage)')
  .addHelpText(
    'after',
    `
Getting started:
  1. supabee init                         # generate config, update config.toml
  2. supabase link                        # link to your Supabase project (if not already linked)
  3. supabase db dump > supabase/schemas/prod-schemas.sql
  4. supabase db dump --data-only > supabase/seeds/prod-data.sql
  5. supabee schema                       # split → reconstruct → validate
  6. supabee data                         # split → reconstruct → validate

Examples:
  supabee init
  supabee schema
  supabee data
  supabee data split --input supabase/seeds/prod-data.sql --output supabase/seeds/split --backup
`,
  );

program
  .command('init')
  .description('Generate config file (if missing) and update supabase/config.toml seed paths')
  .action(async () => {
    await runInitCommand([]);
  });

for (const commandName of ['schema', 'data']) {
  program
    .command(`${commandName} [step] [reconstructed]`)
    .description(
      `${commandName} split/reconstruct/validate, or run full chain when step is omitted`,
    )
    .option('--input <path>', 'Input SQL file or split folder (reconstruct)')
    .option('--output <path>', 'Split output folder (split) or reconstructed file')
    .option('--backup', 'Backup dirty split output folder before split')
    .action(async (step?: string, reconstructed?: string, options: StepCliOptions = {}) => {
      const forwarded = buildStepArgs(step, reconstructed, options);
      if (commandName === 'schema') {
        await runSchemaCommand(forwarded);
        return;
      }
      await runDataCommand(forwarded);
    });
}

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(errText(message));
  process.exit(1);
});

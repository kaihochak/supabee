#!/usr/bin/env node
// @ts-nocheck

import { Command } from 'commander';
import { runSchemaCommand } from './commands/schema.js';
import { runDataCommand } from './commands/data.js';
import { runInitCommand } from './commands/init.js';
import { error as errText } from './lib/ui.js';

function buildStepArgs(step, reconstructed, options) {
  const args = [];
  if (step) args.push(step);
  if (options.input) args.push('--input', options.input);
  if (options.output) args.push('--output', options.output);
  if (options.backup) args.push('--backup');
  if (reconstructed) args.push(reconstructed);
  return args;
}

const program = new Command();
program
  .name('supabase-splitter')
  .description('CLI tools for Supabase schema and data splitting workflows')
  .showHelpAfterError('(run with --help for usage)')
  .addHelpText(
    'after',
    `
Examples:
  supabase-splitter init
  supabase-splitter data
  supabase-splitter schema
  supabase-splitter data split --input supabase/seeds/prod-data.sql --output supabase/seeds/split --backup
`,
  );

program
  .command('init')
  .description('Update supabase/config.toml [db.seed].sql_paths from tool config')
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
    .action(async (step, reconstructed, options) => {
      const forwarded = buildStepArgs(step, reconstructed, options);
      if (commandName === 'schema') {
        await runSchemaCommand(forwarded);
        return;
      }
      await runDataCommand(forwarded);
    });
}

program.parseAsync(process.argv).catch((error) => {
  console.error(errText(error?.message || String(error)));
  process.exit(1);
});

#!/usr/bin/env node

import { createProgram } from './cli/program.js';
import { printGlobalInstallHintIfNeeded, forwardToSupabaseIfNeeded } from './cli/runtime.js';
import { error as errText } from './lib/ui.js';

const program = createProgram();

async function main() {
  const args = process.argv.slice(2);
  printGlobalInstallHintIfNeeded(args);
  const isForwarded = await forwardToSupabaseIfNeeded(args, program);
  if (isForwarded) return;
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(errText(message));
  process.exit(1);
});

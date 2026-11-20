import fs from 'node:fs';
import { Command } from 'commander';
import { registerInitCommand } from './registrations/init.js';
import { registerSchemaCommand } from './registrations/schema.js';
import { registerDataCommand } from './registrations/data.js';
import { registerSyncCommand } from './registrations/sync.js';
import { registerCutoffCommand } from './registrations/cutoff.js';
import { registerMigrationCommand } from './registrations/migration.js';
import { registerDbCommand } from './registrations/db.js';
import { registerSeedCommand } from './registrations/seed.js';
import { registerStartCommand } from './registrations/start.js';

function readCliVersion(): string {
  try {
    const packageJsonPath = new URL('../../package.json', import.meta.url);
    const raw = fs.readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    if (typeof parsed.version === 'string' && parsed.version.trim() !== '') {
      return parsed.version;
    }
  } catch {}
  return '0.0.0';
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('supabee')
    .version(readCliVersion(), '-V, --version', 'display version number')
    .description('Supabase sync and migration orchestration CLI.')
    .showHelpAfterError('(run with --help for usage)')
    .addHelpText(
      'after',
      `
Main Workflows
  supabee sync schema
  supabee sync data
  supabee db reset [cutoff_timestamp]
  supabee db reset --remote              Remote reset using Supabase login (resumable)
  supabee seed                          Seed the local project without resetting
  supabee seed --remote                 Seed the linked project using Supabase login
  supabee start [cutoff_timestamp]

Setup (once per project)
  supabee init
  supabase link

Examples
  supabee sync schema
  supabee sync data
  supabee db reset 20260309180959
  supabee db reset --remote
  supabee db reset --remote=<project-ref>
  supabee db reset --remote=<branch>
  supabee db reset --remote="postgresql://...:5432/postgres?sslmode=require"
  supabee db reset --linked
  supabee start 20260309180959

Manual Processing (existing dump files)
  supabee schema
  supabee data
`,
    );

  registerInitCommand(program);
  registerSchemaCommand(program);
  registerDataCommand(program);
  registerSyncCommand(program);
  registerCutoffCommand(program);
  registerMigrationCommand(program);
  registerDbCommand(program);
  registerSeedCommand(program);
  registerStartCommand(program);
  return program;
}

import type { Command } from 'commander';
import { runCommand } from '../lib/subprocess.js';
import { info, warn } from '../lib/ui.js';

function firstNonOptionToken(args: string[]): { token: string; index: number } | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--') break;
    if (token.startsWith('-')) continue;
    return { token, index };
  }
  return null;
}

function detectWrapperInvocation(): 'pnpm' | 'npx' | 'bunx' | null {
  const userAgent = (process.env.npm_config_user_agent ?? '').toLowerCase();
  const execPath = (process.env.npm_execpath ?? '').toLowerCase();
  const npmCommand = (process.env.npm_command ?? '').toLowerCase();
  const lifecycleScript = (process.env.npm_lifecycle_script ?? '').toLowerCase();
  const packageManager = (process.env.npm_config_user_agent ?? '').split(' ')[0] ?? '';

  if (userAgent.includes('pnpm') || execPath.includes('pnpm')) return 'pnpm';
  if (userAgent.includes('bun') || execPath.includes('bun')) return 'bunx';
  if (npmCommand === 'exec') return 'npx';
  if (packageManager.startsWith('pnpm/')) return 'pnpm';
  if (packageManager.startsWith('bun/')) return 'bunx';
  if (lifecycleScript.includes('pnpm ') || lifecycleScript.includes('pnpm\t')) return 'pnpm';
  if (lifecycleScript.includes('bunx ') || lifecycleScript.includes('bunx\t')) return 'bunx';
  if (lifecycleScript.includes('npx ') || lifecycleScript.includes('npx\t')) return 'npx';

  return null;
}

export function printGlobalInstallHintIfNeeded(args: string[]) {
  if (process.env.SUPABEE_NO_GLOBAL_HINT === '1') return;
  if (args.length === 0) return;

  const wrapper = detectWrapperInvocation();
  if (!wrapper) return;

  console.log(info(`Install globally for direct usage:`));
  console.log(warn('  npm i -g supabee  |  pnpm add -g supabee  |  bun add -g supabee'));
  console.log(info('One-off runners: npx supabee ... | pnpm dlx supabee ... | bunx supabee ...'));
  console.log('');
}

export async function forwardToSupabaseIfNeeded(args: string[], program: Command): Promise<boolean> {
  const topLevel = firstNonOptionToken(args);
  if (!topLevel) return false;

  if (topLevel.token === 'help') return false;
  const command = program.commands.find((command) => command.name() === topLevel.token);
  if (command) {
    if (topLevel.token !== 'db' && topLevel.token !== 'migration') return false;
    const subcommand = firstNonOptionToken(args.slice(topLevel.index + 1));
    if (!subcommand || subcommand.token === 'help' || command.commands.some((child) => child.name() === subcommand.token)) {
      return false;
    }
  }

  console.log(info(`Forwarding to Supabase CLI: supabase ${args.join(' ')}`));
  await runCommand('supabase', args);
  return true;
}

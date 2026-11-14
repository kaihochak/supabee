import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './subprocess.js';

export type LinkedProject = {
  projectRef: string;
  source: 'environment' | 'saved' | 'picker';
};

type LinkedProjectOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
  pickProject?: (cwd: string) => Promise<void>;
};

export function validateProjectRef(value: string): string {
  if (!/^[a-z]{20}$/.test(value)) {
    throw new Error('Invalid Supabase project reference: expected 20 lowercase letters.');
  }
  return value;
}

export async function resolveLinkedProject(options: LinkedProjectOptions = {}): Promise<LinkedProject> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const fromEnv = env.SUPABASE_PROJECT_ID?.trim();
  if (fromEnv) return { projectRef: validateProjectRef(fromEnv), source: 'environment' };

  const refPath = path.join(cwd, 'supabase', '.temp', 'project-ref');
  async function readSavedRef(): Promise<string> {
    try {
      return (await fs.readFile(refPath, 'utf8')).trim();
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw new Error(`Could not read linked project reference at ${refPath}. Check file access.`);
    }
  }

  const saved = await readSavedRef();
  if (saved) return { projectRef: validateProjectRef(saved), source: 'saved' };

  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    throw new Error('No remote project selected. Set SUPABASE_PROJECT_ID, run supabase link, or pass --remote=<project-ref>.');
  }

  const pick = options.pickProject ?? ((directory: string) => runCommand('supabase', ['link'], { cwd: directory, env }));
  await pick(cwd);
  const selected = await readSavedRef();
  if (!selected) throw new Error('Supabase link did not save a project reference. No remote project selected.');
  return { projectRef: validateProjectRef(selected), source: 'picker' };
}

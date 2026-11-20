import { runCommandCapture } from './subprocess.js';

export async function resolveLocalDbUrl(): Promise<string> {
  let stdout: string;
  try {
    try {
      ({ stdout } = await runCommandCapture('supabase', ['status', '--output', 'json']));
    } catch (error) {
      if (!(error instanceof Error) || !/(?:unknown|unexpected|unrecognized)[^\n]*--output/i.test(error.message)) throw error;
      ({ stdout } = await runCommandCapture('supabase', ['status', '--output-format', 'json']));
    }
  } catch {
    throw new Error('Could not read the local Supabase connection. Run `supabase start` in this project, then retry `supabee seed`.');
  }
  try {
    const status = JSON.parse(stdout);
    const value = status.DB_URL ?? status.env?.DB_URL;
    const url = new URL(value);
    if (typeof value !== 'string' || !['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error();
    return value;
  } catch {
    throw new Error('Supabase status did not return a valid local DB_URL. Check `supabase status` in this project.');
  }
}

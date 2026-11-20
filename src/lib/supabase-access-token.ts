import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type TokenOptions = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  readKeyring?: (account: string) => Promise<string | null>;
};

async function readKeyring(account: string): Promise<string | null> {
  try {
    const keyring = await import('@napi-rs/keyring');
    try {
      const value = new keyring.Entry('Supabase CLI', account).getPassword();
      if (value) return value;
    } catch {}
    if (process.platform === 'win32') {
      const entry = keyring.findCredentials('Supabase CLI', `Supabase CLI:${account}`)
        .find((item) => item.account === account);
      if (entry) return entry.password;
    }
  } catch {}
  return null;
}

function validate(value: string): string {
  const token = value.trim();
  if (!/^sbp_(oauth_|v0_)?[a-f0-9]{40}$/.test(token)) {
    throw new Error('Invalid Supabase access token. Run supabase login or set SUPABASE_ACCESS_TOKEN to a personal access token.');
  }
  return token;
}

function decodeStoredToken(value: string): string {
  const prefix = 'go-keyring-base64:';
  if (value.startsWith(prefix)) return Buffer.from(value.slice(prefix.length), 'base64').toString('utf8');
  if (value.startsWith('sbp_')) return value;
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    bytes.push(code & 255);
    if (code > 255) bytes.push(code >> 8);
  }
  const decoded = Buffer.from(bytes).toString('utf8');
  return decoded.startsWith(prefix) ? Buffer.from(decoded.slice(prefix.length), 'base64').toString('utf8') : decoded;
}

async function readOptional(file: string): Promise<string> {
  try { return (await fs.readFile(file, 'utf8')).trim(); }
  catch (error) {
    if (error.code === 'ENOENT') return '';
    throw new Error('Could not read saved Supabase authentication. Check SUPABASE_HOME and file access.');
  }
}

export async function resolveSupabaseAccessToken(options: TokenOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const home = env.SUPABASE_HOME || path.join(options.home ?? os.homedir(), '.supabase');
  const profile = env.SUPABASE_PROFILE?.trim() || await readOptional(path.join(home, 'profile')) || 'supabase';
  if (profile !== 'supabase') throw new Error('Automatic seed credentials currently support the default Supabase cloud profile only. Use an explicit database URL for other profiles.');
  if (env.SUPABASE_ACCESS_TOKEN?.trim()) return validate(env.SUPABASE_ACCESS_TOKEN);
  if (!['1', 'true', 'yes'].includes(env.SUPABASE_NO_KEYRING?.toLowerCase() ?? '')) {
    const read = options.readKeyring ?? readKeyring;
    for (const account of ['supabase', 'access-token']) {
      const stored = await read(account);
      if (stored) {
        return validate(decodeStoredToken(stored));
      }
    }
  }
  const saved = await readOptional(path.join(home, 'access-token'));
  if (saved) return validate(saved);
  throw new Error('Supabase authentication required. Run supabase login or set SUPABASE_ACCESS_TOKEN. No database connection string is needed.');
}

import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin as input, stdout as output } from 'node:process';
import { confirmDbUrlDefaults } from './db-url-defaults.js';
import { info } from './ui.js';

export function explicitDbUrl(options: { url?: string; dbUrl?: string }): string | undefined {
  if (options.url !== undefined && options.dbUrl !== undefined) {
    throw new Error('Use either --url or --db-url, not both.');
  }
  const value = options.url ?? options.dbUrl;
  if (value === undefined) return undefined;
  if (!value.trim()) throw new Error('--url / --db-url requires a non-empty Postgres connection string.');
  return validateRemoteDbUrl(value.trim());
}

export function validateRemoteDbUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid database URL. Expected postgresql://user:password@host:5432/postgres?sslmode=require.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('Invalid database URL. Expected a postgres:// or postgresql:// connection string.');
  }
  if (parsed.port && parsed.port !== '5432') {
    throw new Error('Use Direct connection or Session pooler on port 5432, not Transaction pooler on port 6543.');
  }
  return value;
}

async function promptForSecret(question: string): Promise<string> {
  let muted = false;
  const silentOutput = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) output.write(chunk);
      callback();
    },
  });
  const rl = readline.createInterface({ input, output: silentOutput, terminal: true });
  try {
    const answerPromise = rl.question(question);
    muted = true;
    const answer = await answerPromise;
    muted = false;
    output.write('\n');
    return answer;
  } finally {
    rl.close();
  }
}

export async function resolveRemoteDbUrl(command: string): Promise<string> {
  const fromEnv = process.env.SUPABASE_DB_URL?.trim() || process.env.PGURI?.trim();
  if (fromEnv) return validateRemoteDbUrl(fromEnv);
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      `\`${command}\` needs a port-5432 database URL.\n` +
      'Set SUPABASE_DB_URL or PGURI, or use --url with a Direct connection or Session pooler URI.',
    );
  }
  console.log(info('Database URL required. Find it in Supabase Dashboard -> your project -> Connect.'));
  console.log(info('  IPv6 available: use Direct connection (port 5432).'));
  console.log(info('  IPv4 only:      use Session pooler (port 5432).'));
  console.log(info('  Do not use Transaction pooler (port 6543).'));
  console.log(info('Copy the URI and replace [YOUR-PASSWORD] with your database password.'));
  console.log(info('Input is hidden.'));
  const value = (await promptForSecret('Database URL: ')).trim();
  if (!value) throw new Error('Database URL is required for a remote database.');
  validateRemoteDbUrl(value);
  const rl = readline.createInterface({ input, output });
  try {
    return await confirmDbUrlDefaults(value, (question) => rl.question(question));
  } finally {
    rl.close();
  }
}

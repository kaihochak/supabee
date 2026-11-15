import net from 'node:net';
import { resolveSupabaseAccessToken } from './supabase-access-token.js';
import { runCommandCapture } from './subprocess.js';
import { withPsqlConnection } from './psql-connection.js';
import { setTimeout as delay } from 'node:timers/promises';

export type ProjectSeedConnection = {
  dbUrl: string;
  expiresAt: number;
  sessionSetupSql: string;
};

type ResolverOptions = {
  accessToken?: string;
  fetch?: typeof globalThis.fetch;
  canConnect?: (host: string, port: number) => Promise<boolean>;
  now?: () => number;
};

const API = 'https://api.supabase.com/v1/projects';

async function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(3000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export async function resolveProjectSeedConnection(
  projectRef: string,
  options: ResolverOptions = {},
): Promise<ProjectSeedConnection> {
  if (!/^[a-z]{20}$/.test(projectRef)) throw new Error('Expected a Supabase project reference of 20 lowercase letters.');
  const token = options.accessToken === undefined ? await resolveSupabaseAccessToken() : options.accessToken.trim();
  if (!token) throw new Error('Project-based seeding requires a Supabase access token.');
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;

  async function api(endpoint: string, method = 'GET', body?: object): Promise<unknown> {
    let response: Response;
    try {
      response = await request(`${API}/${projectRef}/${endpoint}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // Fetch errors and API bodies may contain secrets; report only the operation.
      throw new Error(`Supabase ${endpoint} request failed. Check network access and retry.`);
    }
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403
        ? ' Check your access token and project permissions.' : '';
      throw new Error(`Supabase ${endpoint} returned HTTP ${response.status}.${hint}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`Supabase ${endpoint} returned invalid JSON.`);
    }
  }

  let host = `db.${projectRef}.supabase.co`;
  let pooled = false;
  if (!await (options.canConnect ?? canConnect)(host, 5432)) {
    const configs = await api('config/database/pooler');
    if (!Array.isArray(configs)) throw new Error('Supabase returned invalid pooler configuration.');
    const primary = configs.find((config) => config?.database_type === 'PRIMARY');
    try {
      const url = new URL(primary.connection_string.replaceAll('[YOUR-PASSWORD]', ''));
      if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
          !url.hostname.endsWith('.pooler.supabase.com') ||
          !decodeURIComponent(url.username).endsWith(`.${projectRef}`)) throw new Error();
      host = url.hostname;
      pooled = true;
    } catch {
      throw new Error('No valid primary Supabase pooler found for this project. Direct database connection is unreachable.');
    }
  }

  const requestedAt = now();
  const credentials = await api('cli/login-role', 'POST', { read_only: false }) as Record<string, unknown>;
  if (!credentials || typeof credentials.role !== 'string' || !/^cli_login_[a-zA-Z0-9_]+$/.test(credentials.role) ||
      typeof credentials.password !== 'string' || !credentials.password || credentials.password.includes('\0') ||
      typeof credentials.ttl_seconds !== 'number' || !Number.isSafeInteger(credentials.ttl_seconds) ||
      credentials.ttl_seconds < 1 || credentials.ttl_seconds > Number.MAX_SAFE_INTEGER / 1000) {
    throw new Error('Supabase returned invalid temporary login credentials.');
  }
  const expiresAt = requestedAt + credentials.ttl_seconds * 1000;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw new Error('Temporary Supabase credentials expired before they could be used. Retry seeding.');
  const url = new URL(`postgresql://${host}:5432/postgres`);
  url.username = credentials.role + (pooled ? `.${projectRef}` : '');
  url.password = encodeURIComponent(credentials.password);
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('connect_timeout', '10');
  return { dbUrl: url.toString(), expiresAt, sessionSetupSql: 'SET SESSION ROLE postgres;' };
}

export function createProjectSeedConnectionProvider(projectRef: string, options: ResolverOptions = {}) {
  let cached: ProjectSeedConnection | undefined;
  let refreshAt = 0;
  let pending: Promise<ProjectSeedConnection> | undefined;
  const now = options.now ?? Date.now;
  return async (): Promise<ProjectSeedConnection> => {
    if (cached && now() < refreshAt) return cached;
    if (!pending) {
      pending = resolveProjectSeedConnection(projectRef, options).then((connection) => {
        cached = connection;
        const remaining = connection.expiresAt - now();
        refreshAt = connection.expiresAt - Math.min(30_000, remaining / 10);
        return connection;
      }).finally(() => { pending = undefined; });
    }
    return pending;
  };
}

export async function checkProjectSeedConnection(connection: ProjectSeedConnection, keepTriggers = false): Promise<void> {
  const setup = connection.sessionSetupSql + ' SET statement_timeout = 0;' +
    (keepTriggers ? '' : ' SET session_replication_role = replica;');
  const attempts = new URL(connection.dbUrl).hostname.endsWith('.pooler.supabase.com') ? 4 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await withPsqlConnection(connection.dbUrl, async (env) => {
        await runCommandCapture('psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-c', setup], {
          env, sensitiveValues: [connection.dbUrl, decodeURIComponent(new URL(connection.dbUrl).password)],
        });
      });
      return;
    } catch {
      if (attempt + 1 === attempts) throw new Error('Seed connection check failed. Check psql installation, network access, and permission to assume postgres and configure triggers.');
      await delay(500 * (attempt + 1));
    }
  }
}

export async function verifyProjectSeedConnection(projectRef: string, keepTriggers = false): Promise<void> {
  await checkProjectSeedConnection(await resolveProjectSeedConnection(projectRef), keepTriggers);
}

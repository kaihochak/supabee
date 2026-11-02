import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function withPsqlConnection<T>(
  value: string,
  run: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  let url: URL;
  const parameters = new Map<string, string>();
  try {
    url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
    if (url.hostname) parameters.set('host', decodeURIComponent(url.hostname.replace(/^\[|\]$/g, '')));
    if (url.port) parameters.set('port', url.port);
    if (url.username) parameters.set('user', decodeURIComponent(url.username));
    if (url.password) parameters.set('password', decodeURIComponent(url.password));
    if (url.pathname && url.pathname !== '/') parameters.set('dbname', decodeURIComponent(url.pathname.slice(1)));
    for (const part of url.search.slice(1).split('&').filter(Boolean)) {
      const separator = part.indexOf('=');
      if (separator === -1) throw new Error();
      let key = decodeURIComponent(part.slice(0, separator));
      let setting = decodeURIComponent(part.slice(separator + 1));
      if (key === 'ssl' && setting === 'true') {
        key = 'sslmode';
        setting = 'require';
      }
      parameters.set(key, setting);
    }
  } catch {
    throw new Error('Invalid remote database URL. Expected a postgres:// or postgresql:// connection string.');
  }
  if (!parameters.get('host') && !parameters.get('hostaddr')) {
    throw new Error('A remote database URL must specify a host.');
  }

  const password = parameters.get('password');
  parameters.delete('password');
  if (password?.includes('\0')) throw new Error('Database passwords cannot contain a null byte.');
  for (const [key, setting] of parameters) {
    if (!/^[a-z_]+$/.test(key) || /[\r\n\0]/.test(setting) || setting !== setting.trim()) {
      throw new Error('Database URL parameters must fit on one line without surrounding whitespace.');
    }
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'supabee-psql-'));
  const serviceFile = path.join(directory, 'pg_service.conf');
  try {
    await writeFile(serviceFile, '[supabee_seed]\n' + [...parameters].map(([key, setting]) => `${key}=${setting}\n`).join(''), { mode: 0o600, flag: 'wx' });
    return await run({
      PGSERVICEFILE: serviceFile,
      PGSERVICE: 'supabee_seed',
      ...(password === undefined ? {} : { PGPASSWORD: password }),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

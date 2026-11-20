import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProjectSeedConnection, createProjectSeedConnectionProvider } from '../dist/lib/project-seed-connection.js';

const ref = 'aaaaaaaaaaaaaaaaaaaa';
const password = 'temp:@ /?#%password';

function fixture({ reachable = true, pooler, failure } = {}) {
  const calls = [];
  const options = {
    accessToken: 'fixture-access-token',
    now: () => 1000,
    canConnect: async () => reachable,
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      if (failure) return failure();
      return Response.json(url.endsWith('/cli/login-role')
        ? { role: 'cli_login_postgres', password, ttl_seconds: 60 }
        : pooler ?? [{ database_type: 'PRIMARY', connection_string: `postgresql://postgres.${ref}:[YOUR-PASSWORD]@aws-0-test.pooler.supabase.com:6543/postgres` }]);
    },
  };
  return { options, calls };
}

test('resolves direct and session-pooler credentials with encoded passwords and TLS', async () => {
  for (const reachable of [true, false]) {
    const f = fixture({ reachable });
    const connection = await resolveProjectSeedConnection(ref, f.options);
    const url = new URL(connection.dbUrl);
    assert.equal(url.hostname, reachable ? `db.${ref}.supabase.co` : 'aws-0-test.pooler.supabase.com');
    assert.equal(url.port, '5432');
    assert.equal(url.username, reachable ? 'cli_login_postgres' : `cli_login_postgres.${ref}`);
    assert.equal(decodeURIComponent(url.password), password);
    assert.equal(url.searchParams.get('sslmode'), 'require');
    assert.equal(connection.sessionSetupSql, 'SET SESSION ROLE postgres;');
    assert.equal(f.calls.at(-1).headers.Authorization, 'Bearer fixture-access-token');
    assert.equal(f.calls.at(-1).body, JSON.stringify({ read_only: false }));
    assert.equal(f.calls.at(-1).redirect, 'error');
  }
});

test('rejects a pooler for another project before requesting credentials', async () => {
  const f = fixture({ reachable: false, pooler: [{
    database_type: 'PRIMARY',
    connection_string: 'postgresql://postgres.wrong@aws-0-test.pooler.supabase.com/postgres',
  }] });
  await assert.rejects(resolveProjectSeedConnection(ref, f.options), /pooler/i);
  assert.deepEqual(f.calls.map((call) => call.method), ['GET']);
});

test('rejects invalid credentials and reports API failures without leaking secrets', async () => {
  for (const failure of [
    async () => new Response('fixture-access-token ' + password, { status: 403 }),
    async () => { throw new Error(password); },
    async () => Response.json({ role: 'cli_login_postgres', password, ttl_seconds: 0 }),
  ]) {
    const f = fixture({ failure });
    await assert.rejects(resolveProjectSeedConnection(ref, f.options), (error) => {
      assert.ok(!error.message.includes(password));
      assert.ok(!error.message.includes('fixture-access-token'));
      return true;
    });
  }
});

test('reuses credentials, coalesces requests, and refreshes before expiry', async () => {
  const f = fixture();
  let time = 1000;
  f.options.now = () => time;
  const getConnection = createProjectSeedConnectionProvider(ref, f.options);
  const [first, concurrent] = await Promise.all([getConnection(), getConnection()]);
  assert.equal(first, concurrent);
  time = 54000;
  assert.equal(await getConnection(), first);
  assert.equal(f.calls.length, 1);
  time = 56000;
  assert.equal((await getConnection()).expiresAt, 116000);
  assert.equal(f.calls.length, 2);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const cutoff = '20260101000000';
const dbUrl = 'postgresql://postgres:fixture-password@pooler.example.test:5432/postgres?sslmode=require';
const platformOptions = { skip: process.platform === 'win32' };

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabee-remote-reset-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const migrations = path.join(dir, 'supabase', 'migrations');
  const seeds = path.join(dir, 'supabase', 'seeds');
  const log = path.join(dir, 'calls.jsonl');
  for (const folder of [bin, migrations, seeds]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(dir, 'supabase', 'config.toml'), '[db.seed]\nenabled = true\nsql_paths = ["./seeds/*.sql"]\n');
  fs.writeFileSync(path.join(migrations, `${cutoff}_orders.sql`), 'CREATE TABLE public.orders (id bigint PRIMARY KEY);\n');
  fs.writeFileSync(path.join(migrations, '20260102000000_add_note.sql'), 'ALTER TABLE public.orders ADD COLUMN note text;\n');
  for (const name of ['001_orders.sql', '002_orders.sql']) {
    fs.writeFileSync(path.join(seeds, name), 'INSERT INTO public.orders VALUES (1);\n');
  }
  const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const file = args.includes('-f') ? path.basename(args[args.indexOf('-f') + 1]) : null;
const serviceFile = command === 'psql' ? process.env.PGSERVICEFILE : null;
const connection = serviceFile ? fs.readFileSync(serviceFile, 'utf8') : null;
fs.appendFileSync(process.env.RESET_TEST_LOG, JSON.stringify({ command, args, file, serviceFile, connection, password: command === 'psql' ? process.env.PGPASSWORD : null }) + '\\n');
if (command === 'supabase' && args[0] === 'branches' && args[1] === 'list') {
  console.log(JSON.stringify([{ id: 'branch-uuid', name: 'staging', project_ref: 'bbbbbbbbbbbbbbbbbbbb' }]));
}
if (command === 'supabase' && args[0] === 'migration' && args[1] === 'list') {
  console.log('20260101000000 | 20260101000000 | 2026-01-01');
}
if (command === 'psql' && !file && process.env.RESET_TEST_FAIL_PREFLIGHT) process.exit(1);
if (command === 'psql' && file === process.env.RESET_TEST_FAIL_FILE) {
  console.error('fixture seed failed');
  process.exit(1);
}
`;
  for (const command of ['supabase', 'psql']) fs.writeFileSync(path.join(bin, command), stub, { mode: 0o755 });
  const mock = path.join(dir, 'mock-project-connection.mjs');
  fs.writeFileSync(mock, `
import fs from 'node:fs';
import net from 'node:net';
import { EventEmitter } from 'node:events';
net.createConnection = () => {
  const socket = new EventEmitter();
  socket.setTimeout = () => socket;
  socket.destroy = () => socket;
  queueMicrotask(() => socket.emit('connect'));
  return socket;
};
globalThis.fetch = async (url, init) => {
  fs.appendFileSync(process.env.RESET_TEST_LOG, JSON.stringify({ command: 'api', args: [init.method, url] }) + '\\n');
  if (process.env.RESET_TEST_API_FAIL) return new Response('denied', { status: 403 });
  return Response.json({ role: 'cli_login_postgres', password: 'fixture-password', ttl_seconds: 60 });
};
`);
  const run = (args, extraEnv = {}) => spawnSync(process.execPath, [cli, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      SUPABEE_NO_GLOBAL_HINT: '1',
      SUPABASE_DB_URL: '',
      SUPABASE_PROJECT_ID: '',
      SUPABASE_ACCESS_TOKEN: 'sbp_' + 'a'.repeat(40),
      SUPABASE_NO_KEYRING: '1',
      SUPABASE_HOME: dir,
      SUPABASE_PROFILE: 'supabase',
      NODE_OPTIONS: `--import=${mock}`,
      RESET_TEST_API_FAIL: '',
      RESET_TEST_FAIL_PREFLIGHT: '',
      PGURI: '',
      RESET_TEST_LOG: log,
      RESET_TEST_FAIL_FILE: '',
      ...extraEnv,
    },
  });
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { dir, migrations, run, calls };
}

for (const variant of ['explicit URL', 'legacy flag']) {
  test(`remote reset seeds file-by-file by default: ${variant}`, platformOptions, (t) => {
    const f = fixture(t);
    const args = ['db', 'reset', cutoff, '--yes'];
    args.push('--db-url', dbUrl);
    if (variant === 'legacy flag') args.push('--resumable-seed', '--keep-triggers');
    const result = f.run(args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const calls = f.calls();
    assert.deepEqual(calls.map((call) => call.command), ['supabase', 'psql', 'psql', 'supabase']);
    assert.deepEqual(calls[0].args, ['db', 'reset', '--db-url', dbUrl, '--yes', '--no-seed']);
    assert.deepEqual(calls.slice(1, 3).map((call) => call.file), ['001_orders.sql', '002_orders.sql']);
    for (const call of calls.slice(1, 3)) {
      assert.ok(call.args.includes('--single-transaction'));
      assert.ok(call.args.includes('ON_ERROR_STOP=1'));
      const setup = call.args[call.args.indexOf('-c') + 1];
      assert.match(setup, /SET statement_timeout = 0/);
      assert.equal(setup.includes('session_replication_role'), variant !== 'legacy flag');
    }
    assert.deepEqual(calls[3].args, ['migration', 'up', '--db-url', dbUrl, '--yes']);
    assert.equal(fs.readdirSync(f.migrations).length, 2);
  });
}

test('remote URL validation and confirmation stop before database commands', platformOptions, (t) => {
  const f = fixture(t);
  for (const url of ['invalid-url', dbUrl.replace(':5432/', ':6543/')]) {
    const result = f.run(['db', 'reset', cutoff, '--db-url', url, '--yes']);
    assert.notEqual(result.status, 0);
    assert.deepEqual(f.calls(), []);
  }
  const result = f.run(['db', 'reset', cutoff, '--db-url', dbUrl]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without confirmation/);
  assert.deepEqual(f.calls(), []);
});

const projectRef = 'aaaaaaaaaaaaaaaaaaaa';
const projectUrl = `postgresql://postgres:fixture-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`;

for (const variant of ['env', 'explicit', 'url', 'branch name', 'branch uuid']) {
  test(`v3 remote target stays consistent across reset stages: ${variant}`, platformOptions, (t) => {
    const f = fixture(t);
    const env = { SUPABASE_DB_URL: '', PGURI: '' };
    let flag = '--remote';
    let expectedRef = projectRef;
    env.SUPABASE_PROJECT_ID = projectRef;
    if (variant === 'explicit') {
      flag = `--remote=${projectRef}`;
      env.SUPABASE_PROJECT_ID = 'cccccccccccccccccccc';
    }
    if (variant === 'url') flag = `--remote=${projectUrl}`;
    if (variant.startsWith('branch')) {
      flag = variant === 'branch name' ? '--remote=staging' : '--remote=branch-uuid';
      expectedRef = 'bbbbbbbbbbbbbbbbbbbb';
    }
    const result = f.run(['db', 'reset', '--yes', flag], env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const calls = f.calls();
    const history = calls.find((call) => call.args[0] === 'migration' && call.args[1] === 'list');
    assert.deepEqual(history.args, ['migration', 'list', `--remote=${variant === 'url' ? projectUrl : expectedRef}`]);
    const target = variant === 'url' ? projectUrl : expectedRef;
    assert.deepEqual(calls.find((call) => call.args[0] === 'db').args,
      ['db', 'reset', `--remote=${target}`, '--yes', '--no-seed']);
    assert.deepEqual(calls.at(-1).args, ['migration', 'up', `--remote=${target}`, '--yes']);
    const seeds = calls.filter((call) => call.command === 'psql' && call.file);
    assert.equal(seeds.length, 2);
    if (variant !== 'url') {
      assert.equal(calls.filter((call) => call.command === 'api').length, 2);
      for (const seed of seeds) {
        assert.match(seed.connection, new RegExp(`host=db\\.${expectedRef}\\.supabase\\.co`));
        assert.match(seed.connection, /user=cli_login_postgres/);
        assert.match(seed.args[seed.args.indexOf('-c') + 1], /^SET SESSION ROLE postgres;/);
        assert.equal(seed.password, 'fixture-password');
      }
      assert.ok(!result.stdout.includes('Database URL:'));
    }
    assert.ok(!result.stdout.includes('fixture-password'));
    assert.equal(fs.readdirSync(f.migrations).length, 2);
  });
}

test('remote selection rejects missing links and conflicting flags before reset', platformOptions, (t) => {
  const f = fixture(t);
  for (const [args, env] of [
    [['--remote'], {}],
    [['--remote', '--linked'], {}],
    [['--remote', '--db-url', dbUrl], {}],
    [['--remote', '--psql'], {}],
    [['--remote='], {}],
    [['--remote'], { SUPABASE_PROJECT_ID: 'invalid' }],
  ]) {
    const result = f.run(['db', 'reset', cutoff, '--yes', ...args], env);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(f.calls(), []);
    assert.equal(fs.readdirSync(f.migrations).length, 2);
  }
});

test('plain reset remains local even when remote environment settings exist', platformOptions, (t) => {
  const f = fixture(t);
  const result = f.run(['db', 'reset'], {
    SUPABASE_PROJECT_ID: 'aaaaaaaaaaaaaaaaaaaa',
    SUPABASE_DB_URL: dbUrl,
    PGURI: dbUrl,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Target: local database/);
  assert.deepEqual(f.calls().map((call) => call.args), [
    ['migration', 'list', '--linked'],
    ['db', 'reset'],
    ['migration', 'up'],
  ]);
});

test('project authentication failure stops reset before changing migrations', platformOptions, (t) => {
  for (const env of [{ SUPABASE_ACCESS_TOKEN: '' }, { RESET_TEST_API_FAIL: '1' }, { RESET_TEST_FAIL_PREFLIGHT: '1' }]) {
    const f = fixture(t);
    const result = f.run(['db', 'reset', cutoff, `--remote=${projectRef}`, '--yes'], env);
    assert.notEqual(result.status, 0);
    assert.ok(!f.calls().some((call) => call.args[0] === 'db'));
    assert.equal(fs.readdirSync(f.migrations).length, 2);
    assert.ok(!result.stdout.includes('Database URL:'));
  }
});

test('project seed failure prints a URL-free resume command that uses fresh credentials', platformOptions, (t) => {
  const f = fixture(t);
  const result = f.run(['db', 'reset', cutoff, `--remote=${projectRef}`, '--yes'], { RESET_TEST_FAIL_FILE: '002_orders.sql' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, new RegExp(`supabee seed --remote=${projectRef} --from 002_orders.sql`));
  assert.ok(!f.calls().some((call) => call.args[0] === 'migration' && call.args[1] === 'up'));
  const resumed = f.run(['seed', `--remote=${projectRef}`, '--from', '002_orders.sql']);
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  assert.equal(f.calls().at(-1).file, '002_orders.sql');
});

test('linked reset reuses saved login and ignores stale URL environment settings', platformOptions, (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.dir, 'supabase', '.temp'));
  fs.writeFileSync(path.join(f.dir, 'supabase', '.temp', 'project-ref'), projectRef);
  fs.writeFileSync(path.join(f.dir, 'access-token'), 'sbp_' + 'b'.repeat(40));
  const result = f.run(['db', 'reset', cutoff, '--remote', '--yes'], {
    SUPABASE_ACCESS_TOKEN: '', SUPABASE_DB_URL: dbUrl, PGURI: dbUrl,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.calls().find((call) => call.args[0] === 'db').args,
    ['db', 'reset', `--remote=${projectRef}`, '--yes', '--no-seed']);
  const seeds = f.calls().filter((call) => call.file);
  assert.equal(seeds.length, 2);
  assert.ok(seeds.every((call) => call.connection.includes(`host=db.${projectRef}.supabase.co`)));
});

test('unconfirmed project reset does not request credentials or run psql', platformOptions, (t) => {
  const f = fixture(t);
  const result = f.run(['db', 'reset', cutoff, `--remote=${projectRef}`]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without confirmation/);
  assert.deepEqual(f.calls(), []);
});

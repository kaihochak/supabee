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
if (command === 'psql' && file === process.env.RESET_TEST_FAIL_FILE) {
  console.error('fixture seed failed');
  process.exit(1);
}
`;
  for (const command of ['supabase', 'psql']) fs.writeFileSync(path.join(bin, command), stub, { mode: 0o755 });
  const run = (args, extraEnv = {}) => spawnSync(process.execPath, [cli, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      SUPABEE_NO_GLOBAL_HINT: '1',
      SUPABASE_DB_URL: '',
      PGURI: '',
      RESET_TEST_LOG: log,
      RESET_TEST_FAIL_FILE: '',
      ...extraEnv,
    },
  });
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { dir, migrations, run, calls };
}

for (const variant of ['explicit URL', 'legacy flag', 'linked']) {
  test(`remote reset seeds file-by-file by default: ${variant}`, platformOptions, (t) => {
    const f = fixture(t);
    const args = ['db', 'reset', cutoff, '--yes'];
    if (variant === 'linked') args.push('--linked');
    else args.push('--db-url', dbUrl);
    if (variant === 'legacy flag') args.push('--resumable-seed', '--keep-triggers');
    const result = f.run(args, variant === 'linked' ? { SUPABASE_DB_URL: dbUrl } : {});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const calls = f.calls();
    assert.deepEqual(calls.map((call) => call.command), ['supabase', 'psql', 'psql', 'supabase']);
    assert.deepEqual(calls[0].args, ['db', 'reset', '--db-url', dbUrl, '--yes', '--no-seed']);
    assert.deepEqual(calls.slice(1, 3).map((call) => call.file), ['001_orders.sql', '002_orders.sql']);
    for (const call of calls.slice(1, 3)) {
      assert.match(call.connection, /host=pooler.example.test\n/);
      assert.match(call.connection, /dbname=postgres\n/);
      assert.match(call.connection, /sslmode=require\n/);
      assert.equal(call.password, 'fixture-password');
      assert.ok(!call.args.join(' ').includes('fixture-password'));
      assert.ok(!fs.existsSync(call.serviceFile));
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

test('failed remote seed stops migrations and can resume from the failing file', platformOptions, (t) => {
  const f = fixture(t);
  const result = f.run(['db', 'reset', cutoff, '--db-url', dbUrl, '--yes'], { RESET_TEST_FAIL_FILE: '002_orders.sql' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /--from 002_orders.sql/);
  assert.ok(!result.stdout.includes('fixture-password'));
  assert.deepEqual(f.calls().map((call) => call.command), ['supabase', 'psql', 'psql']);
  assert.ok(!fs.existsSync(f.calls()[1].serviceFile));
  assert.equal(fs.readdirSync(f.migrations).length, 2);
  const resumed = f.run(['db', 'seed-remote', '--db-url', dbUrl, '--from', '002_orders.sql']);
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  const calls = f.calls();
  assert.equal(calls.length, 4);
  assert.equal(calls[3].file, '002_orders.sql');
});

test('local reset keeps the Supabase seed step', platformOptions, (t) => {
  const f = fixture(t);
  const result = f.run(['db', 'reset', cutoff]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.calls().map((call) => call.args), [['db', 'reset'], ['migration', 'up']]);
});

test('remote URL validation and confirmation stop before database commands', platformOptions, (t) => {
  const f = fixture(t);
  for (const url of ['', '  ', 'invalid-url', dbUrl.replace(':5432/', ':6543/')]) {
    const result = f.run(['db', 'reset', cutoff, '--db-url', url, '--yes']);
    assert.notEqual(result.status, 0);
    assert.deepEqual(f.calls(), []);
  }
  const result = f.run(['db', 'reset', cutoff, '--db-url', dbUrl]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without confirmation/);
  assert.deepEqual(f.calls(), []);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const remoteUrl = 'postgresql://postgres.project:secret@pooler.example.test:5432/postgres?sslmode=require';
const platformOptions = { skip: process.platform === 'win32' };

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabee-seed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const seeds = path.join(dir, 'supabase', 'seeds');
  const log = path.join(dir, 'calls.jsonl');
  for (const folder of [bin, seeds]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(dir, 'supabase', 'config.toml'), 'project_id = "seed-fixture"\n[db.seed]\nsql_paths = ["./seeds/*.sql"]\n');
  for (const name of ['001_orders.sql', '002_orders.sql']) fs.writeFileSync(path.join(seeds, name), 'SELECT 1;\n');
  const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const serviceFile = command === 'psql' ? process.env.PGSERVICEFILE : null;
fs.appendFileSync(process.env.SEED_TEST_LOG, JSON.stringify({command, args, cwd: process.cwd(), connection: serviceFile ? fs.readFileSync(serviceFile, 'utf8') : null}) + '\\n');
if (command === 'supabase') {
  if (process.env.SEED_TEST_STATUS === 'stopped') { console.error('supabase start is not running'); process.exit(1); }
  if (process.env.SEED_TEST_STATUS === 'nested' && args.includes('--output')) { console.error('unknown flag: --output'); process.exit(1); }
  if (process.env.SEED_TEST_STATUS === 'invalid') { console.log('{}'); process.exit(0); }
  const status = { DB_URL: 'postgresql://postgres:postgres@127.0.0.1:55322/postgres' };
  console.log(JSON.stringify(process.env.SEED_TEST_STATUS === 'nested' ? {env: status} : status));
}
if (command === 'psql' && process.env.SEED_TEST_FAIL && args.at(-1).endsWith('002_orders.sql')) process.exit(1);
`;
  for (const name of ['supabase', 'psql']) fs.writeFileSync(path.join(bin, name), stub, { mode: 0o755 });
  const run = (args, env = {}) => spawnSync(process.execPath, [cli, ...args], {
    cwd: dir, encoding: 'utf8', env: {
      ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      SUPABEE_NO_GLOBAL_HINT: '1', SUPABASE_DB_URL: '', PGURI: '',
      SEED_TEST_LOG: log, SEED_TEST_STATUS: '', SEED_TEST_FAIL: '', ...env,
    },
  });
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { dir, run, calls };
}

test('seeds the standard seed.sql when sql_paths is omitted', platformOptions, (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'supabase', 'config.toml'), 'project_id = "seed-fixture"\n');
  fs.writeFileSync(path.join(f.dir, 'supabase', 'seed.sql'), 'SELECT 1;\n');
  const result = f.run(['seed']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.calls().length, 2);
  assert.match(f.calls()[1].args.at(-1), /supabase\/seed.sql$/);
});

for (const status of ['', 'nested']) {
  test(`local seed discovers the current project's actual connection (${status || 'legacy status'}) and ignores remote env`, platformOptions, (t) => {
    const f = fixture(t);
    const result = f.run(['seed'], { SUPABASE_DB_URL: remoteUrl, SEED_TEST_STATUS: status });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const calls = f.calls();
    assert.deepEqual(calls[0].args, ['status', '--output', 'json']);
    if (status) assert.deepEqual(calls[1].args, ['status', '--output-format', 'json']);
    assert.ok(calls.every((call) => call.cwd === fs.realpathSync(f.dir)));
    const seeds = calls.filter((call) => call.command === 'psql');
    assert.equal(seeds.length, 2);
    for (const seed of seeds) {
      assert.match(seed.connection, /host=127\.0\.0\.1\n/);
      assert.match(seed.connection, /port=55322\n/);
      assert.ok(!seed.connection.includes('pooler.example.test'));
      assert.ok(seed.args.includes('--single-transaction'));
    }
  });
}

for (const variant of ['--url', 'linked PGURI']) {
  test(`remote seed uses ${variant} without inspecting or resetting the local database`, platformOptions, (t) => {
    const f = fixture(t);
    const linked = variant.startsWith('linked');
    const args = ['seed', ...(linked ? ['--linked'] : [variant, remoteUrl]), '--from', '002_orders.sql', '--keep-triggers'];
    const result = f.run(args, linked ? { [variant === 'linked env' ? 'SUPABASE_DB_URL' : 'PGURI']: remoteUrl } : {});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const calls = f.calls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'psql');
    assert.match(calls[0].connection, /host=pooler.example.test\n/);
    assert.match(calls[0].args.at(-1), /002_orders\.sql$/);
    assert.ok(!calls[0].args.join(' ').includes('secret'));
    assert.doesNotMatch(calls[0].args[calls[0].args.indexOf('-c') + 1], /session_replication_role/);
  });
}

test('dry-run lists the queue without a database, credentials, or URL prompt', platformOptions, (t) => {
  const f = fixture(t);
  for (const args of [['seed', '--dry-run'], ['seed', '--remote', '--dry-run']]) {
    const result = f.run(args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /001_orders\.sql/);
    assert.match(result.stdout, /002_orders\.sql/);
    assert.doesNotMatch(result.stdout, /Database URL:/);
  }
  assert.deepEqual(f.calls(), []);
});

test('unavailable local databases fail without guessing a connection or seeding', platformOptions, (t) => {
  for (const status of ['stopped', 'invalid']) {
    const f = fixture(t);
    const result = f.run(['seed'], { SEED_TEST_STATUS: status });
    assert.notEqual(result.status, 0);
    assert.ok(f.calls().every((call) => call.command === 'supabase'));
    assert.equal(f.calls().length, 1);
    assert.match(result.stderr, /supabase start|supabase status/);
  }
});

test('local seed failure prints a local resume command and skips completed files on resume', platformOptions, (t) => {
  const f = fixture(t);
  const result = f.run(['seed'], { SEED_TEST_FAIL: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /supabee seed --from 002_orders.sql/);
  assert.doesNotMatch(result.stdout, /--linked|YOUR_DATABASE_URL/);
  const result2 = f.run(['seed', '--from', '002_orders.sql']);
  assert.equal(result2.status, 0, result2.stdout + result2.stderr);
  const seeds = f.calls().filter((call) => call.command === 'psql');
  assert.equal(seeds.length, 3);
  assert.match(seeds.at(-1).args.at(-1), /002_orders.sql$/);
});

test('invalid remote options and missing noninteractive credentials fail before seeding', platformOptions, (t) => {
  const f = fixture(t);
  for (const args of [
    ['seed', '--linked'], ['seed', '--linked', '--url', remoteUrl],
    ['seed', '--url', remoteUrl, '--db-url', remoteUrl],
  ]) {
    const result = f.run(args);
    assert.notEqual(result.status, 0);
    assert.ok(!(result.stdout + result.stderr).includes('secret'));
  }
  assert.deepEqual(f.calls(), []);
});

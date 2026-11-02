import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { withPsqlConnection } from '../dist/lib/psql-connection.js';

test('supplies decoded remote connection settings privately and removes the service file', async () => {
  let file;
  await withPsqlConnection('postgresql://postgres.project:p%40ss%27%5C%20@pooler.example.test:5432/custom%20db?sslmode=verify-full&application_name=a+b&options=-c%20search_path%3Dpublic', async (env) => {
    file = env.PGSERVICEFILE;
    const settings = fs.readFileSync(file, 'utf8');
    assert.match(settings, /host=pooler.example.test\n/);
    assert.match(settings, /port=5432\n/);
    assert.match(settings, /user=postgres.project\n/);
    assert.match(settings, /dbname=custom db\n/);
    assert.match(settings, /sslmode=verify-full\n/);
    assert.match(settings, /application_name=a\+b\n/);
    assert.match(settings, /options=-c search_path=public\n/);
    assert.ok(!settings.includes('password='));
    assert.equal(env.PGPASSWORD, "p@ss'\\ ");
    assert.equal(env.PGSERVICE, 'supabee_seed');
    assert.equal(env.PGDATABASE, undefined);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });
  assert.ok(!fs.existsSync(path.dirname(file)));
});

test('cleans up the connection service file when seeding fails', async () => {
  let file;
  await assert.rejects(withPsqlConnection('postgres://user:secret@db.example.test/postgres', async (env) => {
    file = env.PGSERVICEFILE;
    throw new Error('fixture failure');
  }), /fixture failure/);
  assert.ok(!fs.existsSync(path.dirname(file)));
});

test('query connection settings override URI components and ssl=true remains supported', async () => {
  await withPsqlConnection('postgres://old:old@old.example.test/old?host=new.example.test&user=new&password=new%2Bpassword&dbname=new&ssl=true', async (env) => {
    const settings = fs.readFileSync(env.PGSERVICEFILE, 'utf8');
    assert.match(settings, /host=new.example.test\n/);
    assert.match(settings, /user=new\n/);
    assert.match(settings, /dbname=new\n/);
    assert.match(settings, /sslmode=require\n/);
    assert.equal(env.PGPASSWORD, 'new+password');
  });
});

test('IPv6 hosts are passed without URI brackets', async () => {
  await withPsqlConnection('postgresql://user@[::1]:5432/postgres', async (env) => {
    assert.match(fs.readFileSync(env.PGSERVICEFILE, 'utf8'), /host=::1\n/);
    assert.ok(!Object.hasOwn(env, 'PGPASSWORD'));
  });
});

test('rejects missing hosts, malformed URLs, and service-file injection before seeding', async () => {
  for (const value of ['invalid', 'https://db.example.test/postgres', 'postgresql:///postgres', 'postgresql://db.example.test/postgres?user=bad%0Ahost%3Dother', 'postgresql://db.example.test/postgres?password=bad%00password']) {
    await assert.rejects(withPsqlConnection(value, async () => assert.fail('Should not seed')));
  }
});

const psqlAvailable = spawnSync('psql', ['--version'], { encoding: 'utf8' }).status === 0;
test('real psql uses the specified TCP host and port instead of a local default socket', { skip: !psqlAvailable }, async () => {
  await withPsqlConnection('postgresql://fixture:secret@127.0.0.1:1/postgres?connect_timeout=1&sslmode=disable', async (env) => {
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
    const result = spawnSync('psql', ['-X', '-w', '-c', 'SELECT 1'], {
      encoding: 'utf8',
      timeout: 3000,
      env: { ...cleanEnv, PGHOST: '/nonexistent', PGPORT: '5432', PGDATABASE: 'wrong', ...env, LC_ALL: 'C' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /127\.0\.0\.1/);
    assert.match(result.stderr, /port 1\b/);
    assert.doesNotMatch(result.stderr, /socket|secret|service file/);
  });
});

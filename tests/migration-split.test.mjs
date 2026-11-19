import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabee-split-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const migrations = path.join(dir, 'supabase', 'migrations');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(migrations, { recursive: true });
  fs.mkdirSync(bin);
  for (const version of ['20260101000000', '20260102000000']) {
    fs.writeFileSync(path.join(migrations, `${version}_mixed.sql`),
      `CREATE TABLE public.items_${version} (id bigint);\nINSERT INTO public.items_${version} VALUES (1);\n`);
  }
  fs.writeFileSync(path.join(dir, 'supabee.config.json'), JSON.stringify({ postSeedCutoff: '20260101000000' }));
  fs.writeFileSync(path.join(bin, 'supabase'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (JSON.stringify(args) !== JSON.stringify(['migration', 'list', '--linked'])) { fs.writeFileSync('unexpected-command', JSON.stringify(args)); process.exit(1); }
fs.writeFileSync('history-called', 'yes');
if (process.env.SPLIT_TEST_APPLIED === 'unlinked') process.exit(1);
if (process.env.SPLIT_TEST_APPLIED) console.log('20260101000000 | 20260101000000 | 2026-01-01');
`, { mode: 0o755 });
  const contents = () => fs.readdirSync(migrations).sort().map((name) => [name, fs.readFileSync(path.join(migrations, name), 'utf8')]);
  const run = (args, input = '', applied = '1') => spawnSync(process.execPath, [cli, 'migration', 'split', ...args], {
    cwd: dir, input, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, SUPABEE_NO_GLOBAL_HINT: '1', SPLIT_TEST_APPLIED: applied },
  });
  return { dir, run, contents };
}

test('dry-run and cancellation preserve files; default splits newer migrations and --all includes older ones', { skip: process.platform === 'win32' }, (t) => {
  for (const all of [false, true]) {
    const f = fixture(t);
    const originals = f.contents();
    const config = fs.readFileSync(path.join(f.dir, 'supabee.config.json'), 'utf8');
    const args = all ? ['--all'] : [];
    const applied = all ? '' : '1';
    for (const [flags, input] of [[[...args, '--dry-run'], ''], [args, 'n\n']]) {
      const result = f.run(flags, input, applied);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(f.contents(), originals);
      assert.equal(fs.readFileSync(path.join(f.dir, 'supabee.config.json'), 'utf8'), config);
      assert.ok(!fs.existsSync(path.join(f.dir, 'supabase', '.tmp-migrations')));
    }
    if (all) assert.ok(!fs.existsSync(path.join(f.dir, 'history-called')));
    const result = f.run(args, 'y\n', applied);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(f.contents().length, all ? 4 : 3);
    const backups = path.join(f.dir, 'supabase', '.tmp-migrations');
    const backup = path.join(backups, fs.readdirSync(backups)[0]);
    const rewritten = all ? originals : originals.slice(1);
    for (const [name, sql] of rewritten) assert.equal(fs.readFileSync(path.join(backup, name), 'utf8'), sql);
    if (!all) assert.deepEqual(f.contents()[0], originals[0]);
  }
});

test('--all cannot bypass applied-history protection, and cutoff overrides are explicit', { skip: process.platform === 'win32' }, (t) => {
  const f = fixture(t);
  const originals = f.contents();
  const result = f.run(['--all'], 'y\n');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already applied/);
  assert.deepEqual(f.contents(), originals);
  assert.match(f.run(['--apply']).stderr, /unknown option.*--apply/);
  assert.notEqual(f.run(['20260101000000', '--all']).status, 0);
  const fallback = f.run(['--dry-run'], '', 'unlinked');
  assert.equal(fallback.status, 0, fallback.stdout + fallback.stderr);
  assert.ok(!fs.existsSync(path.join(f.dir, 'unexpected-command')));
  const preview = f.run(['20260102000000', '--dry-run']);
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.match(preview.stdout, /No mixed migrations found after cutoff/);
  assert.deepEqual(f.contents(), originals);
});

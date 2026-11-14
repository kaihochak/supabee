import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveLinkedProject } from '../dist/lib/linked-project.js';

const ref = 'aaaaaaaaaaaaaaaaaaaa';
const otherRef = 'bbbbbbbbbbbbbbbbbbbb';

async function fixture(t) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'supabee-linked-project-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const refPath = path.join(cwd, 'supabase', '.temp', 'project-ref');
  const save = async (value) => {
    await fs.mkdir(path.dirname(refPath), { recursive: true });
    await fs.writeFile(refPath, value);
  };
  const options = { cwd, env: {}, interactive: false, pickProject: async () => assert.fail('Must not open project picker') };
  return { cwd, refPath, save, options };
}

test('environment takes precedence without reading or rewriting the saved link', async (t) => {
  for (const saved of ['different project', 'unreadable link']) {
    const f = await fixture(t);
    if (saved === 'different project') await f.save(otherRef);
    else await fs.mkdir(f.refPath, { recursive: true });
    assert.deepEqual(await resolveLinkedProject({ ...f.options, env: { SUPABASE_PROJECT_ID: ` ${ref} ` } }),
      { projectRef: ref, source: 'environment' });
    if (saved === 'different project') assert.equal(await fs.readFile(f.refPath, 'utf8'), otherRef);
  }
});

test('unset or blank environment falls through to the saved link and trims line endings', async (t) => {
  const f = await fixture(t);
  await f.save(` ${ref}\r\n`);
  for (const env of [{}, { SUPABASE_PROJECT_ID: ' \n' }]) {
    assert.deepEqual(await resolveLinkedProject({ ...f.options, env }), { projectRef: ref, source: 'saved' });
  }
});

test('invalid references stop lookup rather than falling through to another project', async (t) => {
  for (const source of ['environment', 'saved']) {
    const f = await fixture(t);
    await f.save(source === 'environment' ? ref : '../invalid');
    const env = source === 'environment' ? { SUPABASE_PROJECT_ID: 'invalid' } : {};
    await assert.rejects(resolveLinkedProject({ ...f.options, env, interactive: true }), /Invalid Supabase project reference/);
  }
});

test('missing or empty link in noninteractive mode fails before opening picker', async (t) => {
  const f = await fixture(t);
  await assert.rejects(resolveLinkedProject(f.options), /No remote project selected/);
  await f.save(' \n');
  await assert.rejects(resolveLinkedProject(f.options), /No remote project selected/);
});

test('cancelled or failed picker stops lookup without guessing a project', async (t) => {
  const f = await fixture(t);
  await assert.rejects(resolveLinkedProject({ ...f.options, interactive: true, pickProject: async () => { throw new Error('picker cancelled'); } }), /picker cancelled/);
});

test('picker success requires a saved and valid project reference', async (t) => {
  const f = await fixture(t);
  await assert.rejects(resolveLinkedProject({ ...f.options, interactive: true, pickProject: async () => {} }), /did not save/);
  await assert.rejects(resolveLinkedProject({ ...f.options, interactive: true, pickProject: async () => f.save('invalid') }), /Invalid Supabase project reference/);
});

test('saved-link read errors fail rather than selecting a different project', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.refPath, { recursive: true });
  await assert.rejects(resolveLinkedProject({ ...f.options, interactive: true }), /Could not read linked project reference/);
});

test('default picker runs supabase link in the selected working directory', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const bin = path.join(f.cwd, 'bin');
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'supabase'), `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync('picker-call.json', JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));
fs.mkdirSync('supabase/.temp', { recursive: true });
fs.writeFileSync('supabase/.temp/project-ref', '${ref}');
`, { mode: 0o755 });
  const result = await resolveLinkedProject({
    cwd: f.cwd,
    env: { SUPABASE_PROJECT_ID: '', PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
    interactive: true,
  });
  assert.deepEqual(result, { projectRef: ref, source: 'picker' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.cwd, 'picker-call.json'), 'utf8')),
    { args: ['link'], cwd: await fs.realpath(f.cwd) });
});

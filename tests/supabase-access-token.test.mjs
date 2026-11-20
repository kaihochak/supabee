import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveSupabaseAccessToken } from '../dist/lib/supabase-access-token.js';

const token = 'sbp_' + 'a'.repeat(40);

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'supabee-token-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return { env: { SUPABASE_HOME: home }, readKeyring: async () => null };
}

test('environment token wins without accessing keyring or saved token', async (t) => {
  const options = await fixture(t);
  options.env.SUPABASE_ACCESS_TOKEN = ` ${token} `;
  options.readKeyring = async () => assert.fail('Should not read keyring');
  assert.equal(await resolveSupabaseAccessToken(options), token);
});

test('reuses saved login from current and legacy keyring accounts', async (t) => {
  for (const account of ['supabase', 'access-token', 'packed Windows token']) {
    const options = await fixture(t);
    let stored = 'go-keyring-base64:' + Buffer.from(token).toString('base64');
    if (account === 'packed Windows token') {
      const bytes = Buffer.from(stored);
      stored = '';
      for (let i = 0; i < bytes.length; i += 2) stored += String.fromCharCode(bytes[i] | ((bytes[i + 1] ?? 0) << 8));
    }
    options.readKeyring = async (name) => name === (account === 'packed Windows token' ? 'supabase' : account) ? stored : null;
    assert.equal(await resolveSupabaseAccessToken(options), token);
  }
});

test('missing and invalid authentication stops with instructions, without secrets', async (t) => {
  const options = await fixture(t);
  await assert.rejects(resolveSupabaseAccessToken(options), /supabase login/);
  options.env.SUPABASE_ACCESS_TOKEN = 'fixture-secret';
  await assert.rejects(resolveSupabaseAccessToken(options), (error) => {
    assert.match(error.message, /Invalid Supabase access token/);
    assert.ok(!error.message.includes('fixture-secret'));
    return true;
  });
  options.env.SUPABASE_ACCESS_TOKEN = '';
  await fs.writeFile(path.join(options.env.SUPABASE_HOME, 'profile'), 'custom-profile');
  await assert.rejects(resolveSupabaseAccessToken(options), /default Supabase cloud profile/);
});

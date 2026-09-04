import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));

for (const newline of ['\n', '\r\n']) {
  test(`split and reconstruct preserve JSON separators with ${JSON.stringify(newline)} line endings`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabee-unicode-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const values = [
      { text: 'collaborative\u2028and self-motivated' },
      { text: 'paragraph\u2029separator' },
      { text: "Unicode 😀, an apostrophe's value, and an escaped\nnewline" },
    ].map((value) => JSON.stringify(value));
    const sql = [
      'INSERT INTO "public"."scrape_metadata" ("raw_scraped_data") VALUES',
      values.map((value) => `('${value.replaceAll("'", "''")}')`).join(`,${newline}`) + ';',
    ].join(newline);
    fs.writeFileSync(path.join(dir, 'input.sql'), sql);
    fs.writeFileSync(path.join(dir, 'supabee.config.json'), JSON.stringify({
      data: { maxRowsPerInsert: 1, maxStatementsPerFile: 1 },
    }));
    execFileSync(process.execPath, [cli, 'data', 'split', '--input', 'input.sql', '--output', 'split'], { cwd: dir });
    execFileSync(process.execPath, [cli, 'data', 'reconstruct', '--input', 'split', '--output', 'reconstructed.sql'], { cwd: dir });
    const output = fs.readFileSync(path.join(dir, 'reconstructed.sql'), 'utf8');
    const actual = [...output.matchAll(/\('((?:''|[^'])*)'\)/g)].map((match) => match[1].replaceAll("''", "'"));
    assert.deepEqual(actual.map((value) => JSON.parse(value)), values.map((value) => JSON.parse(value)));
    assert.deepEqual(actual, values);
    assert.equal(fs.readdirSync(path.join(dir, 'split')).filter((file) => file.includes('scrape_metadata')).length, 3);
  });
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const header = 'INSERT INTO "pipeline"."sources" ("name", "description") VALUES';
const sequence = "SELECT pg_catalog.setval('pipeline.sources_id_seq', 2, true);";

const cases = [
  {
    name: 'multiline descriptions containing SQL-looking text',
    statement: [
      header,
      "\t('COSCH', 'Arts and Design;",
      '',
      "INSERT INTO public.fake VALUES (''still description'');",
      "SELECT pg_catalog.setval(''fake_sequence'', 99, true);",
      '-- SEQUENCE SET is also description text;',
      "Engineering and designers'' work'),",
      "\t('AIED', 'Education');",
    ].join('\n'),
  },
  {
    name: 'backslash-escaped quotes in escape strings',
    statement: [header, "\t('COSCH', E'Designer\\';", "Engineering'),", "\t('AIED', 'Education');"].join('\n'),
  },
  {
    name: 'backslashes before closing quotes in ordinary strings',
    statement: [header, "\t('COSCH', 'path\\'),", "\t('AIED', 'Design;", "Engineering');"].join('\n'),
  },
  {
    name: 'escaped backslashes before closing quotes in escape strings',
    statement: [header, "\t('COSCH', E'path\\\\'),", "\t('AIED', E'Design;", "Engineering');"].join('\n'),
  },
  {
    name: 'an apostrophe in a quoted identifier',
    statement: ['INSERT INTO "pipeline"."sources" ("owner\'s_description") VALUES', "\t('Design;", "Engineering');"].join('\n'),
  },
  ...['$$', '$description$'].map((tag) => ({
    name: `dollar-quoted descriptions using ${tag}`,
    statement: [header, `\t('COSCH', ${tag}Design;`, "A designer's description;", `Engineering${tag});`].join('\n'),
  })),
  {
    name: 'comments containing quotes and semicolons',
    statement: [
      header,
      "/* designer's comment;",
      '/* nested comment */ still in comment;',
      '*/',
      "\t('COSCH', 'Design'), -- designer's comment;",
      "\t('AIED', 'Education'); -- trailing comment's quote",
    ].join('\n'),
  },
  {
    name: 'a complete INSERT on its first line',
    statement: `${header} ('COSCH', 'Design; Engineering');`,
  },
];

for (const newline of ['\n', '\r\n']) {
  for (const { name, statement } of cases) {
    test(`data split preserves ${name} with ${JSON.stringify(newline)} line endings`, (t) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabee-statements-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const expected = statement.replaceAll('\n', newline);
      const other = ['INSERT INTO "public"."other" ("name") VALUES', "\t('x');"].join(newline);
      fs.writeFileSync(path.join(dir, 'input.sql'), [expected, sequence, other].join(newline));
      fs.writeFileSync(path.join(dir, 'supabee.config.json'), JSON.stringify({ data: {} }));

      execFileSync(process.execPath, [cli, 'data', 'split', '--input', 'input.sql', '--output', 'split'], { cwd: dir });
      const files = fs.readdirSync(path.join(dir, 'split'));
      const readTable = (table) => {
        const matches = files.filter((file) => file.includes(table));
        assert.equal(matches.length, 1, `expected one file for ${table}`);
        return fs.readFileSync(path.join(dir, 'split', matches[0]), 'utf8');
      };
      // readSqlLines preserves the CR on the statement's final line as well.
      assert.equal(readTable('pipeline_sources'), expected + (newline === '\r\n' ? '\r' : ''));
      assert.equal(readTable('public_other'), other);
      assert.equal(files.filter((file) => file.includes('fake')).length, 0);
      const sequences = readTable('sequences');
      assert.equal(sequences.trimEnd(), `-- Sequence values\n${sequence}`);

      execFileSync(process.execPath, [cli, 'data', 'reconstruct', '--input', 'split', '--output', 'reconstructed.sql'], { cwd: dir });
      const reconstructed = fs.readFileSync(path.join(dir, 'reconstructed.sql'), 'utf8').replace(/\r\n/g, '\n');
      assert.ok(reconstructed.includes(statement));
    });
  }
}

test('data split keeps multiline descriptions intact when chunking rows into separate seed files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabee-statement-chunks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rows = ["('COSCH', 'Arts and Design;\n\nEngineering and designers'' work')", "('AIED', 'Education')"];
  const sql = `${header}\n\t${rows.join(',\n\t')};`;
  fs.writeFileSync(path.join(dir, 'input.sql'), sql);
  fs.writeFileSync(path.join(dir, 'supabee.config.json'), JSON.stringify({
    data: { maxRowsPerInsert: 1, maxStatementsPerFile: 1 },
  }));

  execFileSync(process.execPath, [cli, 'data', 'split', '--input', 'input.sql', '--output', 'split'], { cwd: dir });
  const chunks = fs.readdirSync(path.join(dir, 'split')).filter((file) => file.includes('pipeline_sources')).sort();
  assert.equal(chunks.length, rows.length);
  for (const [i, file] of chunks.entries()) {
    assert.equal(fs.readFileSync(path.join(dir, 'split', file), 'utf8'), `${header}\n\t${rows[i]};`);
  }

  execFileSync(process.execPath, [cli, 'data', 'reconstruct', '--input', 'split', '--output', 'reconstructed.sql'], { cwd: dir });
  const result = execFileSync(process.execPath, [cli, 'data', 'validate', '--input', 'input.sql', '--output', 'reconstructed.sql'], { cwd: dir, encoding: 'utf8' });
  assert.match(result, /Validation successful/);
});

test('a value ending in a backslash does not escape its closing quote', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabee-backslash-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sql = [
    'INSERT INTO "pipeline"."sources" ("name", "description") VALUES',
    "\t('A', 'archives \\'),",
    "\t('B', 'History,",
    "\tMedia Studies;",
    "\tSociology'),",
    "\t('C', 'plain');",
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'input.sql'), sql);
  fs.writeFileSync(path.join(dir, 'supabee.config.json'), JSON.stringify({ data: { maxRowsPerInsert: 1 } }));
  execFileSync(process.execPath, [cli, 'data', 'split', '--input', 'input.sql', '--output', 'split'], { cwd: dir });
  for (const file of fs.readdirSync(path.join(dir, 'split'))) {
    const content = fs.readFileSync(path.join(dir, 'split', file), 'utf8');
    assert.equal(content.split("'").length % 2, 1, `${file} has unbalanced quotes`);
  }
});

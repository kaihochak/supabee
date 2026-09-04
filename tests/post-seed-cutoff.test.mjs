import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMigrationListOutput, summarizeMigrationAlignment } from '../dist/lib/post-seed-cutoff.js';

test('detects the latest common migration in backtick-wrapped output', () => {
  const rows = parseMigrationListOutput([
    '`20260814120000` | `20260814120000` | `2026-08-14 12:00:00`',
    '`20260824120000` | `20260824120000` | `2026-08-24 12:00:00`',
    '`20260825120000` | `20260825120000` | `2026-08-25 12:00:00`',
    '`20260826120000` | ` `              | `2026-08-26 12:00:00`',
  ].join('\n'));

  assert.deepEqual(rows.at(-1), {
    local: '20260826120000', remote: '', timeUtc: '2026-08-26 12:00:00',
  });
  assert.deepEqual(summarizeMigrationAlignment(rows), {
    latestLocal: '20260826120000',
    latestRemote: '20260825120000',
    latestAligned: '20260825120000',
  });
});

for (const separator of ['|', '│']) {
  test(`preserves unwrapped migration output with ${separator} separators and history gaps`, () => {
    const rows = parseMigrationListOutput([
      `Local ${separator} Remote ${separator} Time (UTC)`,
      `20260814120000 ${separator} 20260814120000 ${separator} 2026-08-14 12:00:00`,
      `20260824120000 ${separator}                ${separator} 2026-08-24 12:00:00`,
      `20260825120000 ${separator} 20260825120000 ${separator} 2026-08-25 12:00:00`,
      `               ${separator} 20260826120000 ${separator} 2026-08-26 12:00:00`,
    ].join('\n'));

    assert.deepEqual(summarizeMigrationAlignment(rows), {
      latestLocal: '20260825120000',
      latestRemote: '20260826120000',
      latestAligned: '20260825120000',
    });
  });
}

test('does not accept malformed or nonnumeric versions as a cutoff', () => {
  const rows = parseMigrationListOutput([
    '` ` | ` ` | ` `',
    '`not-a-version` | `not-a-version` | `2026-08-25 12:00:00`',
    '`20260826120000 | `20260826120000 | 2026-08-26 12:00:00',
  ].join('\n'));

  assert.equal(rows.length, 2);
  assert.deepEqual(summarizeMigrationAlignment(rows), {
    latestLocal: null, latestRemote: null, latestAligned: null,
  });
});

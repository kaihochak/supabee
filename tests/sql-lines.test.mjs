import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { readSqlLines } from '../dist/lib/sql-lines.js';

async function collect(chunks) {
  const lines = [];
  for await (const line of readSqlLines(Readable.from(chunks))) lines.push(line);
  return lines;
}

test('preserves Unicode separators and CR across stream chunk boundaries', async () => {
  assert.deepEqual(await collect(['one\u2028', 'two\u2029three\r', '\n\n', 'last\rvalue']), [
    'one\u2028two\u2029three\r', '', 'last\rvalue',
  ]);
});

test('handles empty streams, terminal LF, and unterminated lines', async () => {
  assert.deepEqual(await collect([]), []);
  assert.deepEqual(await collect(['\n']), ['']);
  assert.deepEqual(await collect(['first\nsecond\n']), ['first', 'second']);
  assert.deepEqual(await collect(['no', ' newline']), ['no newline']);
});

test('propagates read failures', async () => {
  async function* broken() {
    yield 'partial';
    throw new Error('read failed');
  }
  await assert.rejects(collect(broken()), /read failed/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommand, runCommandCapture } from '../dist/lib/subprocess.js';

const secret = 'postgresql://postgres:do-not-print-me@example.test:5432/postgres';

test('runCommand redacts sensitive argv values from failures', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'process.exit(7)', secret], {
      sensitiveValues: [secret],
    }),
    (error) => {
      assert.doesNotMatch(error.message, /do-not-print-me/);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    },
  );
});

test('runCommandCapture redacts sensitive stderr values from failures', async () => {
  await assert.rejects(
    runCommandCapture(process.execPath, ['-e', 'process.stderr.write(process.argv[1]); process.exit(8)', secret], {
      sensitiveValues: [secret],
    }),
    (error) => {
      assert.doesNotMatch(error.message, /do-not-print-me/);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    },
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmDbUrlDefaults } from '../dist/lib/db-url-defaults.js';

const base = 'postgresql://postgres:fixture%40password@pooler.example.test:5432';

for (const answer of ['', 'y', 'YES', ' Y ']) {
  test(`accepting URL suggestions with ${JSON.stringify(answer)} fills missing settings`, async () => {
    const questions = [];
    const result = await confirmDbUrlDefaults(base, async (question) => {
      questions.push(question);
      return answer;
    });
    assert.equal(result, `${base}/postgres?sslmode=require`);
    assert.deepEqual(questions, ['Add database /postgres and sslmode=require? [Y/n] ']);
    assert.ok(!questions[0].includes('fixture'));
  });
}

test('declining preserves the original URL exactly', async () => {
  for (const answer of ['n', 'NO', ' n ']) {
    assert.equal(await confirmDbUrlDefaults(`${base}/?application_name=a%20b`, async () => answer), `${base}/?application_name=a%20b`);
  }
});

test('only suggests missing SSL and preserves the supplied database and query settings', async () => {
  const result = await confirmDbUrlDefaults(`${base}/custom?application_name=reset`, async (question) => {
    assert.equal(question, 'Add sslmode=require? [Y/n] ');
    return 'y';
  });
  assert.equal(result, `${base}/custom?application_name=reset&sslmode=require`);
});

test('only suggests a missing database and preserves explicit SSL settings', async () => {
  const result = await confirmDbUrlDefaults(`${base}/?sslmode=verify-full`, async (question) => {
    assert.equal(question, 'Add database /postgres? [Y/n] ');
    return 'y';
  });
  assert.equal(result, `${base}/postgres?sslmode=verify-full`);
});

test('a complete URL is unchanged and needs no confirmation', async () => {
  const value = `${base}/custom?sslmode=disable&application_name=a%20b`;
  assert.equal(await confirmDbUrlDefaults(value, async () => assert.fail('Unexpected prompt')), value);
});

test('an invalid confirmation answer asks again without accepting the changes', async () => {
  const answers = ['maybe', 'n'];
  assert.equal(await confirmDbUrlDefaults(base, async () => answers.shift()), base);
  assert.equal(answers.length, 0);
});

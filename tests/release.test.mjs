import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateReleaseMetadata } from '../scripts/check-release.mjs';

function release() {
  return {
    tag: 'v0.6.3',
    repository: 'kaihochak/supabee',
    pkg: { name: 'supabee', version: '0.6.3', repository: { url: 'https://github.com/kaihochak/supabee.git' } },
    lock: { version: '0.6.3', packages: { '': { version: '0.6.3' } } },
    changelog: '# Changelog\n\n## [0.6.3] - 2026-10-29\n\n### Fixed\n- Multiline SQL values.\n',
  };
}

test('accepts a stable release with matching package, lockfile, repository, and changelog', () => {
  assert.equal(validateReleaseMetadata(release()), '0.6.3');
});

for (const heading of [
  '## [0.6.3](https://github.com/kaihochak/supabee/compare/v0.6.2...v0.6.3) (2026-11-01)',
  '### [0.6.3](https://github.com/kaihochak/supabee/compare/v0.6.2...v0.6.3) (2026-11-01)',
  '## 0.6.3 (2026-11-01)',
  '## [0.6.3] (2026-11-01)\r',
]) {
  test(`accepts Release Please changelog heading: ${heading.trim()}`, () => {
    assert.equal(validateReleaseMetadata({ ...release(), changelog: `# Changelog\n\n${heading}\n` }), '0.6.3');
  });
}

for (const heading of [
  '## [0.6.30](https://github.com/kaihochak/supabee/compare/v0.6.2...v0.6.30) (2026-11-01)',
  '## [0.6.3](https://example.test/2026-11-01)',
  '## 0.6.3',
  '## [0.6.3] - not-a-date',
]) {
  test(`rejects an undated or different-version changelog heading: ${heading}`, () => {
    assert.throws(() => validateReleaseMetadata({ ...release(), changelog: heading }), /dated release entry/);
  });
}

for (const tag of [undefined, '0.6.3', 'v01.6.3', 'v0.6.3-rc.1', 'v0.6.3+build', 'v0.6.3/other']) {
  test(`rejects unsupported release tag ${tag}`, () => {
    assert.throws(() => validateReleaseMetadata({ ...release(), tag }), /stable versions/);
  });
}

for (const [name, modify, message] of [
  ['tag/version mismatch', (r) => { r.pkg.version = '0.6.2'; }, /does not match/],
  ['stale lockfile version', (r) => { r.lock.version = '0.6.2'; }, /package-lock/],
  ['stale lockfile root package', (r) => { r.lock.packages[''].version = '0.6.2'; }, /package-lock/],
  ['wrong repository', (r) => { r.repository = 'someone/fork'; }, /repository.url/],
  ['wrong package', (r) => { r.pkg.name = 'supabee-docs'; }, /public supabee/],
  ['private package', (r) => { r.pkg.private = true; }, /public supabee/],
  ['missing release notes', (r) => { r.changelog = '## [0.6.2] - 2026-09-04'; }, /dated release entry/],
]) {
  test(`rejects ${name}`, () => {
    const metadata = release();
    modify(metadata);
    assert.throws(() => validateReleaseMetadata(metadata), message);
  });
}

function releaseRepository(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabee-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const metadata = release();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(metadata.pkg));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(metadata.lock));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), metadata.changelog);
  const git = (...args) => execFileSync('git', [
    '-c', 'user.name=Release Test', '-c', 'user.email=release@example.test',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
  ], { cwd: dir, stdio: 'pipe' });
  git('-c', 'init.templateDir=', 'init', '--initial-branch=prod');
  git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md');
  git('commit', '-m', 'Release metadata');
  git('tag', metadata.tag);
  git('update-ref', 'refs/remotes/origin/prod', 'HEAD');
  const outputFile = path.join(dir, 'github-output');
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-release.mjs', import.meta.url))], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, RELEASE_TAG: metadata.tag, GITHUB_REPOSITORY: metadata.repository, GITHUB_OUTPUT: outputFile },
  });
  return { git, run, outputFile };
}

test('release CLI validates prod ancestry and writes the version for GitHub Actions', (t) => {
  const { run, outputFile } = releaseRepository(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(outputFile, 'utf8'), /^version=0\.6\.3\nsha=[0-9a-f]{40}\n$/);
});

test('release CLI rejects a commit that has not reached prod', (t) => {
  const { git, run, outputFile } = releaseRepository(t);
  git('checkout', '-b', 'feature');
  git('commit', '--allow-empty', '-m', 'Unmerged work');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must already be on origin\/prod/);
  assert.equal(fs.existsSync(outputFile), false);
});

test('release CLI rejects a checkout without a fetched prod ref', (t) => {
  const { git, run } = releaseRepository(t);
  git('update-ref', '-d', 'refs/remotes/origin/prod');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must already be on origin\/prod/);
});

test('release CLI rejects a different commit from the release tag even when both are on prod', (t) => {
  const { git, run, outputFile } = releaseRepository(t);
  git('commit', '--allow-empty', '-m', 'Later prod commit');
  git('update-ref', 'refs/remotes/origin/prod', 'HEAD');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must match the release tag/);
  assert.equal(fs.existsSync(outputFile), false);
});

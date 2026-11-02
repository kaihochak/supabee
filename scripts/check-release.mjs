import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function validateReleaseMetadata({ tag, repository, pkg, lock, changelog }) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '')) {
    throw new Error('Release tags must be stable versions such as v0.6.3.');
  }
  const version = tag.slice(1);
  if (pkg.name !== 'supabee' || pkg.private === true) {
    throw new Error('The release must be the public supabee package.');
  }
  if (pkg.version !== version) {
    throw new Error(`Tag ${tag} does not match package.json version ${pkg.version}.`);
  }
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Error('package-lock.json must match the release version in package.json.');
  }
  const repoUrl = pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '');
  if (!repository || repoUrl !== `https://github.com/${repository}`) {
    throw new Error('package.json repository.url must match the publishing GitHub repository.');
  }
  const escapedVersion = version.replaceAll('.', '\\.');
  const heading = new RegExp(
    `^(?:## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}|` +
    `#{2,3} (?:${escapedVersion}|\\[${escapedVersion}\\](?:\\(https://[^\\s)]+\\))?) \\(\\d{4}-\\d{2}-\\d{2}\\))\\r?$`,
    'm',
  );
  if (!heading.test(changelog)) {
    throw new Error(`CHANGELOG.md must contain a dated release entry for ${version}.`);
  }
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = validateReleaseMetadata({
      tag: process.env.RELEASE_TAG,
      repository: process.env.GITHUB_REPOSITORY,
      pkg: JSON.parse(fs.readFileSync('package.json', 'utf8')),
      lock: JSON.parse(fs.readFileSync('package-lock.json', 'utf8')),
      changelog: fs.readFileSync('CHANGELOG.md', 'utf8'),
    });
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/prod'], { stdio: 'pipe' });
    } catch {
      throw new Error('Release commit must already be on origin/prod. Merge the release PR before publishing.');
    }
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const taggedSha = execFileSync('git', ['rev-parse', `refs/tags/${process.env.RELEASE_TAG}^{commit}`], { encoding: 'utf8' }).trim();
    if (sha !== taggedSha) throw new Error('The checked-out commit must match the release tag.');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nsha=${sha}\n`);
    console.log(`Validated supabee ${version} for publishing from ${process.env.GITHUB_REPOSITORY}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

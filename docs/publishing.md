# Publishing

**Merging the Release Please release PR approves npm publication.** Contributor and maintainer steps are manual; bot, CI, and publishing steps run automatically in GitHub Actions. Vercel deploys the website separately.

## Maintainer setup

- **GitHub:** add the repository Actions secret `RELEASE_PLEASE_TOKEN`. Its value is a fine-grained GitHub personal access token restricted to `kaihochak/supabee`, with **Contents** and **Pull requests** read/write permissions. It lets Release Please create PRs, tags, and GitHub releases. Replace it when it expires. A separate token enables CI on bot-created PRs; see [Release Please token guidance](https://github.com/googleapis/release-please-action#other-actions-on-release-please-prs).
- **npm:** in the `supabee` package settings, add a GitHub Actions trusted publisher: owner `kaihochak`, repository `supabee`, workflow `publish.yml`, environment blank, direct `npm publish` allowed. Existing matching settings can be retained. Publishing uses OIDC; no npm token is needed. See [npm setup requirements](https://docs.npmjs.com/trusted-publishers/).

## Full release sequence

| Step | Owner | What happens / where to check |
| --- | --- | --- |
| 1. Prepare | **Contributor** | Implement the change, update docs, and perform relevant [database integration checks](manual-test-plan-data-mutation-migrations.md) against a disposable database. |
| 2. Stage and commit | **Contributor** | Review and save the intended files using the commands below. |
| 3. Push / merge | **Maintainer** | Merge the reviewed contribution into `prod`, or push an approved change directly. |
| 4. Check changes | **CI** | [ci.yml](../.github/workflows/ci.yml): install, typecheck, build, tests, and packaging dry run on Node 20/22/24. [docs.yml](../.github/workflows/docs.yml): site install, typography check, and Astro build when its path filters match. |
| 5. Prepare release PR | **Bot** | Release Please updates the root package version, lockfile, manifest, and changelog in a PR. More changes can accumulate before release. |
| 6. Approve release | **Maintainer** | Review version, release notes, migration guidance, and passing checks; then merge the release PR. Preserve detailed handwritten changelog notes. |
| 7. Tag release | **Bot** | [publish.yml](../.github/workflows/publish.yml) → `release`: creates `vX.Y.Z` and the GitHub release. |
| 8. Validate and test | **CI** | `validate`: checks stable tag, public package, matching versions, repository URL, dated changelog, and exact tagged commit on `prod`. `checks`: reruns package CI on that exact SHA. |
| 9. Pack | **CI** | `publish` → **Build and pack release**: Node 24/npm 11, dependency install, then `npm pack`; `prepack` builds TypeScript. |
| 10. Test installation | **CI** | `publish` → **Smoke test the packed CLI in a clean directory**: installs the tarball outside the repo and checks help, exact version, and the legacy alias. |
| 11. Publish | **Publish job** | **Publish the tested tarball to npm**: publishes that same archive with provenance after all release checks pass. |
| 12. Verify | **Maintainer** | Confirm workflow success, npm version, and applicable [post-publish checks](manual-test-plan-data-mutation-migrations.md#phase-7-post-publish-validation-with-latest). |

Steps 4 and 5 start independently after a normal `prod` push. CI also runs on the release PR. Steps 7–11 run after the release PR is merged, within the same workflow. A GitHub tag/release can exist before npm publication succeeds.

### Choose the version through the commit message

| Commit prefix | Effect |
| --- | --- |
| `fix:` | Patch: 0.7.0 → 0.7.1 |
| `feat:` | Minor: 0.7.0 → 0.8.0 |
| `feat!:` / `fix!:` | Breaking: minor below 1.0; major from 1.0 onward |
| `docs:` / `chore:` | No release on their own |

Include migration requirements in a `BREAKING CHANGE:` commit-body paragraph. For squash merges, use the appropriate PR title/body. Commits affecting only `site/` or `docs/` are excluded from CLI version calculation; the private site package is not released to npm.

### Manual commands: stage, commit, push

From the repository root:

```sh
git status --short
git diff
git add -p
```

Stage intended new files explicitly with `git add` or an editor's staging controls. Review the staged changes, then commit with a message describing the change. Example for a breaking remote-reset change:

```sh
git diff --staged
git commit -m "feat!: make remote resets resumable by default" -m "BREAKING CHANGE: Remote resets with --db-url now require psql and a Direct connection or Session pooler on port 5432."
```

Press `q` to exit the diff viewer. Stop if committing fails. For an approved direct change on `prod`, push:

```sh
git branch --show-current
git push origin prod
```

For a feature branch, push that branch and have a maintainer merge the reviewed PR. Continue with Steps 4–12 above. Version updates, tag creation, and npm publication are automated.

### Automatic command reference

GitHub Actions runs these commands; repeating them locally is optional:

| Location | Commands / checks |
| --- | --- |
| `ci.yml` → `checks` | `npm ci`, `npm run typecheck`, `npm run build`, `npm run test`, `npm run pack:check` |
| `docs.yml` → `build` | `npm --prefix site ci`, `node scripts/check-typography.mjs`, `npm --prefix site run build` |
| `publish.yml` → `validate` | `node scripts/check-release.mjs` with the release tag and fetched Git history |
| `publish.yml` → `publish` | `npm ci`, `npm pack --pack-destination "$RUNNER_TEMP"`, clean installation check, then `npm publish "$TARBALL" --access public --provenance` |

`pack:check` is a dry run. The publish job creates and tests the actual tarball. Its installation check is shown below for reference; the workflow supplies `TARBALL` and `EXPECTED_VERSION`:

```sh
smoke_dir="$(mktemp -d)"
npm install --prefix "$smoke_dir" --ignore-scripts --no-audit --no-fund "$TARBALL"
"$smoke_dir/node_modules/.bin/supabee" --help
test "$("$smoke_dir/node_modules/.bin/supabee" --version)" = "$EXPECTED_VERSION"
"$smoke_dir/node_modules/.bin/supabase-splitter" --help
```

Local checks remain useful for development or debugging. CI's installation check does not exercise a full database reset; applicable database integration tests remain manual.

### Verify npm publication

After **Release and publish npm package** succeeds in [GitHub Actions](https://github.com/kaihochak/supabee/actions), check:

```sh
npm view supabee@0.7.0 version
npm view supabee dist-tags.latest
```

Both should report `0.7.0` for the first release. Substitute the released version thereafter.

## First rollout: 0.7.0

The manifest starts at published `0.6.2`; the bot should propose `0.7.0`. Package metadata stays at `0.6.2` until its release PR applies the bump. During that PR's review, move **all** [Unreleased changelog notes](../CHANGELOG.md#unreleased) into the generated 0.7.0 entry, retaining every fix and migration requirement; remove the empty Unreleased section. CI builds its own archive, so the earlier local tarball is not used.

Include the automation edits and new configuration files when adopting this workflow:

```sh
git add .github/workflows/ci.yml .github/workflows/publish.yml \
  release-please-config.json .release-please-manifest.json \
  scripts/check-release.mjs tests/release.test.mjs \
  package.json package-lock.json CHANGELOG.md README.md \
  docs/publishing.md docs/prd/remote-seed-resume-prd.md
git diff --staged
```

## Website deployment

**Maintainer:** review site changes and Vercel previews. **Docs CI:** validates matching changes. **Vercel:** independently builds previews and deploys `prod` to [supabee.jacobchak.com](https://supabee.jacobchak.com). **Maintainer:** verify the deployment and expected content.

Vercel project `supabee` in `kaichaks-projects` uses repository `kaihochak/supabee`, production branch `prod`, root `site`, and Node `24.x`. [site/vercel.json](../site/vercel.json) sets Astro, `npm ci`, `npm run build`, and output `dist`.

Vercel does not wait for Docs CI or npm publication and may redeploy on CLI-only commits. Website changes need no npm release. Coordinate docs requiring a new CLI version with that version's availability.

## If something fails

- **Bot:** check `RELEASE_PLEASE_TOKEN` permissions/expiry and rerun the failed job.
- **Checks or code:** npm publication stops. Fix the code and prepare another release PR; do not move a published tag.
- **Publishing authentication/infrastructure:** check whether the version exists on npm first. If absent, fix configuration and choose **Re-run failed jobs** on the original run. Alternatively, select **Release and publish npm package → Run workflow**, branch `prod`, and enter the existing tag, such as `v0.7.0`. This rechecks and publishes that tagged commit. Leave the tag blank only to update the release PR.
- **Already published:** npm versions cannot be overwritten. Verify the existing publication or release a new version for changed contents.

# Publishing

The CLI package and the docs website have independent release paths.

| Output | Trigger | Validation | Delivery |
| --- | --- | --- | --- |
| npm package | Push a stable version tag such as `v0.6.3` | Release metadata, package CI on Node 20/22/24, clean tarball install | GitHub Actions publishes the tested tarball to npm |
| Docs website | Merge site changes into `prod` | Docs workflow builds the site and checks typography | Vercel Git integration for `supabee.jacobchak.com` |

Website changes do not require a CLI version bump. The site is a private package and is never published to npm. GitHub Actions validates the docs build; Vercel handles website deployments through its Git integration.

## One-time npm setup

After merging `.github/workflows/publish.yml`, open the `supabee` package's settings on npm and add a GitHub Actions trusted publisher:

| Setting | Value |
| --- | --- |
| Organization or user | `kaihochak` |
| Repository | `supabee` |
| Workflow filename | `publish.yml` |
| Environment | Leave blank; the workflow does not use a GitHub environment |
| Allowed action | Enable direct publishing with `npm publish` |

This workflow uses OIDC and does not require an `NPM_TOKEN` repository secret. Its publishing job grants `id-token: write` and runs Node 24 with npm 11. The `repository.url` in `package.json` must match the GitHub repository. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for current setup requirements.

Configure the publisher when ready to release: npm currently requires a new configuration's first successful publication within two days. Recreate an expired configuration before retrying.

## Release the CLI

1. Finish the [RC checklist](rc-checklist.md), including testing with a real Supabase dump and the integration workflow when relevant. Automated CI does not replace those manual checks.
2. Update the package version and lockfile without creating a tag yet:

   ```sh
   npm version patch --no-git-tag-version
   ```

3. Add a dated entry to `CHANGELOG.md`, for example `## [0.6.3] - 2026-10-29`. Use the actual version and release date. Review and commit the release files, then merge them into `prod` through the usual review process.
4. Wait for package CI on `prod` to pass. Tag the release commit and push that exact tag. For version `0.6.3`:

   ```sh
   git tag -a v0.6.3 RELEASE_COMMIT_SHA -m "Release 0.6.3"
   git push origin v0.6.3
   ```

   Replace `RELEASE_COMMIT_SHA` with the reviewed commit already on `prod`. Use a specific tag push rather than pushing every local tag.

5. Watch **Publish npm package** in GitHub Actions. The workflow:
   - verifies a stable `vX.Y.Z` tag matches both package files and a dated changelog entry;
   - verifies the release commit is already on `prod`;
   - runs the same package checks as normal CI on Node 20, 22, and 24;
   - builds a tarball, installs it in a clean directory, and checks both CLI entry points and the version;
   - publishes that exact tarball publicly to npm with provenance.
6. Confirm the registry version, then complete the [post-publish integration checks](manual-test-plan-data-mutation-migrations.md#phase-7-post-publish-validation-with-latest):

   ```sh
   npm view supabee@0.6.3 version
   npm view supabee dist-tags.latest
   ```

Only stable releases are supported by this workflow. Prerelease tags are rejected so an RC cannot replace npm's `latest` version.

## Docs website on Vercel

The `Docs` workflow runs for `site/` changes, the typography checker, root package files, and its own workflow file. It installs dependencies using `site/package-lock.json` and builds `site/dist/` with Node 24. The package workflow skips changes confined to the site and internal docs.

The website is hosted on Vercel as project `supabee`, under `kaichaks-projects`, at `https://supabee.jacobchak.com`. Its root directory is already `site` and its Node.js setting is `24.x`.

`site/vercel.json` specifies the Astro framework, `npm ci` installation, `npm run build`, and the `dist` output directory. Paths in this file are relative to the Vercel project root (`site/`), so the deployed output corresponds to `site/dist/` in the repository.

In the existing Vercel project's settings, confirm:

| Setting | Value |
| --- | --- |
| Git repository | `kaihochak/supabee` |
| Production branch | `prod` |
| Root Directory | `site` |
| Node.js Version | `24.x` |
| Production domain | `supabee.jacobchak.com` |

Keep Vercel's Git integration for automatic production deployments and branch previews. No Vercel deployment token or second deployment job is needed in GitHub Actions. Vercel builds its own deployment; the GitHub docs check alone does not gate it. Review the docs check and Vercel preview before merging site changes into `prod`.

The CLI and website use separate package manifests and lockfiles rather than npm workspaces. Vercel may therefore rebuild the website for CLI-only commits; its automatic workspace-based skipping is not assumed here. If reducing those builds becomes necessary, configure a Vercel Ignored Build Step after verifying the project's Git history and deployment comparison behavior. See [Vercel monorepo deployment settings](https://vercel.com/docs/monorepos).

Publish CLI behavior before merging docs that require that new version. Documentation corrections can ship independently. The site package's version is not tied to the CLI's version.

## Failed releases

- A failed check prevents the publishing job from running. Correct the release commit/version metadata and use a new tag for the corrected release; do not move a published release tag.
- If authentication fails, check the trusted publisher's repository, workflow filename, allowed action, and expiry. Do not add a local npm token to the workflow.
- Before retrying a run, check whether npm already contains the version. Published versions cannot be overwritten; release another version if its contents need to change.

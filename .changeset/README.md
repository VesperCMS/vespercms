# Changesets

Every change to a published package (`vespercms`, `@vespercms/core` or `@vespercms/admin`) needs a changeset. Run `npm run changeset`, pick the packages and the bump, and write one plain sentence for the changelog.

The published packages share one version (`fixed` in `config.json`), the way Taproot keeps its packages in step. Private packages (`@vespercms/ui`, which the studio's bundle includes, and the two apps) are neither versioned nor tagged.

## Prereleases

Until Phase 9's first release, the packages are prereleases under npm's `next` tag (`pre.json`, entered 2026-10-28), so a site installs them with `npx astro add vespercms@next`. To release:

1. `npm run changeset -- version` turns the waiting changesets into the next version (`0.1.0-next.1`, and so on) and the changelogs. Commit that.
2. Run the Release workflow on `main` (Actions → Release → Run workflow). It builds, imports every published entry point with `check:dist`, and publishes whatever version npm doesn't have yet.

Leave prerelease mode with `npm run changeset -- pre exit` before the first release that isn't one.

## Publishing to npm

The Release workflow publishes with npm's trusted publishing (OIDC): npm trusts this repository's `release.yml`, and no npm token is kept anywhere. A package npm doesn't have yet can't be trusted that way, so the first publish of each takes a token: an npm granular access token with read and write on all packages (a package that doesn't exist yet can't be chosen), as the repository secret `NPM_TOKEN`. Once every package is on npm, set up its trusted publisher on npmjs.com (this repository, `release.yml`) and delete the secret.

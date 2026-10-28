# Changesets

Every change to a published package (`vespercms`, `@vespercms/core` or `@vespercms/admin`) needs a changeset. Run `npm run changeset`, pick the packages and the bump, and write one plain sentence for the changelog.

The published packages share one version (`fixed` in `config.json`), the way Taproot keeps its packages in step. Private packages (`@vespercms/ui`, which the studio's bundle includes, and the two apps) are neither versioned nor tagged.

## Prereleases

Until Phase 9's first release, the packages are prereleases under npm's `next` tag (`pre.json`, entered 2026-10-28), so a site installs them with `npx astro add vespercms@next`. To release:

1. `npm run changeset -- version` turns the waiting changesets into the next version (`0.1.0-next.1`, and so on) and the changelogs. Commit that.
2. Run the Release workflow on `main` (Actions → Release → Run workflow). It builds, imports every published entry point with `check:dist`, and publishes whatever version npm doesn't have yet.

Leave prerelease mode with `npm run changeset -- pre exit` before the first release that isn't one.

## Publishing to npm

The Release workflow publishes with npm's trusted publishing (OIDC): npm trusts this repository's `release.yml`, and no npm token is kept anywhere. A package npm doesn't have yet can't be trusted that way, so the first publish of each takes a token, as the repository secret `NPM_TOKEN`. Checked against npm's docs on 2026-10-28.

### The first publish: a token

On npmjs.com, as the account that owns the `vespercms` org: profile picture → Access Tokens → Generate New Token.

- **Bypass two-factor authentication:** checked. Without it, a publish from Actions stops at a 2FA prompt nobody can answer.
- **Allowed IP ranges:** empty. GitHub's runners have no fixed addresses.
- **Packages and scopes:** "Read and write (publish and stage)", on "All Packages". "Stage only" would only stage versions for someone to promote by hand, and a package that doesn't exist yet (the unscoped `vespercms`) can't be chosen from the list.
- **Organizations:** "No access". That permission manages the org's settings and members; it doesn't publish its packages.
- **Expiration:** short, such as 7 days. It's needed once.

Then `gh secret set NPM_TOKEN -R vespercms/vespercms`, pasting the token at its prompt (never into a file or a chat), and run the Release workflow once `main`'s CI is green: `gh workflow run release.yml -R vespercms/vespercms --ref main`.

### After it: trusted publishing

Set this up just before the next release, not straight after the first: npm says a new trusted publisher must make its first successful publish within 2 days. For each of `vespercms`, `@vespercms/core` and `@vespercms/admin`, on npmjs.com: the package's Settings → Trusted publishing → GitHub Actions.

- **Organization or user:** `VesperCMS`. **Repository:** `vespercms`. **Workflow filename:** `release.yml`. **Environment name:** empty.
- **Allowed actions:** include `npm publish`, and `npm dist-tag` too. Without them the workflow may only stage versions, which `changeset publish` doesn't do.

Then delete the secret (`gh secret delete NPM_TOKEN -R vespercms/vespercms`) and revoke the token on npmjs.com. The workflow's `NODE_AUTH_TOKEN` is then empty, and npm uses the workflow's OIDC token instead. That needs npm 11.5.1 or later, which recent Node 24 releases ship.

npm makes no provenance attestations while this repository is private, even with trusted publishing.

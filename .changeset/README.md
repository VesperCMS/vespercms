# Changesets

Every change to a published Vesper's packages (`vespercms` and `@vespercms/*`) needs a changeset. Run `npm run changeset`, pick the packages and the bump, and write one plain sentence for the changelog.

All Vesper's packages (`vespercms` and `@vespercms/*`) share one version (`fixed` in `config.json`), the way Taproot keeps its packages in step. Private packages (`@vespercms/ui` until Phase 2, and the playground) are neither versioned nor tagged.

Nothing is published yet. A tag-triggered release workflow using npm trusted publishing (OIDC, no `NPM_TOKEN`) is added with the first release.

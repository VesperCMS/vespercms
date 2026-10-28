// @ts-check
import markdoc from '@astrojs/markdoc';
import vesper from 'vespercms';
import { defineConfig } from 'astro/config';
import { sourceConditions } from '../../scripts/vite-source-conditions.mjs';

// vespercms.com: Vesper's own site, edited with Vesper. Plain static output
// with no adapter, like every Vesper site (spec D4, D16).
export default defineConfig({
  site: 'https://vespercms.com',
  output: 'static',
  // Edited through the cloud at vespercms.com/admin; `astro dev` stays local
  // mode. The project ID is an identifier from the dashboard, not a secret.
  integrations: [
    markdoc(),
    vesper({ siteName: 'Vesper', cloud: { project: 'site_3hfhzj0qma9p27ygk422' } }),
  ],
  // Resolve workspace Vesper packages to source, like the playground.
  vite: sourceConditions(),
});

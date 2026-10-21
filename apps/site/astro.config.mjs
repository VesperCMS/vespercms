// @ts-check
import markdoc from '@astrojs/markdoc';
import vesper from '@vesper/astro';
import { defineConfig } from 'astro/config';
import { sourceConditions } from '../../scripts/vite-source-conditions.mjs';

// vespercms.com: Vesper's own site, edited with Vesper. Plain static output
// with no adapter, like every Vesper site (spec D4, D16).
export default defineConfig({
  site: 'https://vespercms.com',
  output: 'static',
  // The studio is local only (`npm run dev -w @vesper/site`, then /admin)
  // until the site is connected to the cloud; then /admin deploys with it.
  integrations: [markdoc(), vesper({ siteName: 'Vesper', studio: { deploy: false } })],
  // Resolve workspace @vesper/* packages to source, like the playground.
  vite: sourceConditions(),
});

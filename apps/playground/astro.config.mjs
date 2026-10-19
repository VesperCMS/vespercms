// @ts-check
import markdoc from '@astrojs/markdoc';
import mdx from '@astrojs/mdx';
import vesper from '@vesper/astro';
import { defineConfig } from 'astro/config';
import { sourceConditions } from '../../scripts/vite-source-conditions.mjs';

// Site search (spec §6.19): blog posts filter by tag (addendum §7); posts and
// events sort by date once their section is chosen.
const search = {
  filters: { blog: ['tags'] },
  sort: { blog: ['publishedAt'], events: ['startsAt'] },
};

// Plain static output with no adapter: the playground must keep working when
// dist/ is copied to the dumbest static host there is (spec D4, D16).
export default defineConfig({
  output: 'static',
  // allowHTML: real Markdoc sites mix in HTML (the jazzy corpus does), so the
  // studio has to handle it, and the accessibility fixtures need it.
  integrations: [mdx(), markdoc({ allowHTML: true }), vesper({ search })],
  // Resolve workspace @vesper/* packages to source, like the rest of the repo.
  vite: sourceConditions(),
});

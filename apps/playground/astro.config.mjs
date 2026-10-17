// @ts-check
import markdoc from '@astrojs/markdoc';
import mdx from '@astrojs/mdx';
import vesper from '@vesper/astro';
import { defineConfig } from 'astro/config';
import { sourceConditions } from '../../scripts/vite-source-conditions.mjs';

// Plain static output with no adapter: the playground must keep working when
// dist/ is copied to the dumbest static host there is (spec D4, D16).
export default defineConfig({
  output: 'static',
  // allowHTML: real Markdoc sites mix in HTML (the jazzy corpus does), so the
  // studio has to handle it, and the accessibility fixtures need it.
  integrations: [mdx(), markdoc({ allowHTML: true }), vesper()],
  // Resolve workspace @vesper/* packages to source, like the rest of the repo.
  vite: sourceConditions(),
});

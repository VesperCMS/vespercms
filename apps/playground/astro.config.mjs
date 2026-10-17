// @ts-check
import markdoc from '@astrojs/markdoc';
import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';
import { sourceConditions } from '../../scripts/vite-source-conditions.mjs';

// Plain static output with no adapter: the playground must keep working when
// dist/ is copied to the dumbest static host there is (spec D4, D16).
export default defineConfig({
  output: 'static',
  integrations: [mdx(), markdoc()],
  // Resolve workspace @vesper/* packages to source, like the rest of the repo.
  vite: sourceConditions(),
});

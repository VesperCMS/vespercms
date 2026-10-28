// @ts-check
import vesper from 'vespercms';
import { defineConfig } from 'astro/config';
import { sourceConditions } from '../../scripts/vite-source-conditions.mjs';

// The zero-config install `astro add vespercms` writes, on Astro 6.
export default defineConfig({
  output: 'static',
  integrations: [vesper()],
  // Resolve workspace Vesper packages to source, like the playground.
  vite: sourceConditions(),
});

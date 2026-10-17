// @ts-check
import vesper from '@vesper/astro';
import { defineConfig } from 'astro/config';
import { sourceConditions } from '../../scripts/vite-source-conditions.mjs';

// The zero-config install `astro add @vesper/astro` writes, on Astro 6.
export default defineConfig({
  output: 'static',
  integrations: [vesper()],
  // Resolve workspace @vesper/* packages to source, like the playground.
  vite: sourceConditions(),
});

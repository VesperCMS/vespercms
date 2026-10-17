import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { sourceConditionsPlugin } from '../../scripts/vite-source-conditions.mjs';
import manifest from './package.json' with { type: 'json' };

// The published studio: ESM with every real dependency left external, so the
// site's Vite bundles one copy of React for the studio and the site's custom
// widgets. Private workspace code (@vesper/ui) is bundled in. Tailwind runs
// here, at publish time, so sites never need it.
const external = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.peerDependencies)];

export default defineConfig({
  plugins: [sourceConditionsPlugin(), react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: { studio: 'src/build.ts' },
      formats: ['es'],
      cssFileName: 'studio',
    },
    rollupOptions: {
      external: (id) => external.some((dep) => id === dep || id.startsWith(`${dep}/`)),
    },
  },
});

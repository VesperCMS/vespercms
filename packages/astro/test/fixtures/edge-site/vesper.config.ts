import { defineConfig } from '@vesper/astro/config';

export default defineConfig({
  collections: {
    notes: { label: 'Notes', listFields: ['title'], scehdule: true } as never,
    ghosts: {},
  },
  widgets: {
    'store-hours': {
      component: () => Promise.resolve({}),
      accepts: (field) => field.kind === 'array',
      match: (field) => field.path.at(-1) === 'hours',
    },
  },
});

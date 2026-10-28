// @ts-check
import markdoc from '@astrojs/markdoc';
import mdx from '@astrojs/mdx';
import vesper from 'vespercms';
import { defineConfig } from 'astro/config';
import { sourceConditions } from '../../scripts/vite-source-conditions.mjs';

// The events are test fixtures with fixed dates, so every build of the
// playground is as of one instant (spec §6.17): which events are live, which
// redirect, and schedule.json's next change stay the same whenever it's
// built. Set VESPER_BUILD_TIME yourself to build it as of another time.
process.env.VESPER_BUILD_TIME ??= '2026-10-26T12:00:00-04:00';

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
  // Resolve workspace Vesper packages to source, like the rest of the repo.
  vite: sourceConditions(),
});

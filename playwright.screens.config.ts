import { defineConfig, devices } from '@playwright/test';

/*
 * Screenshots of the studio for vespercms.com's home page, not tests:
 * `npm run screens` writes them into apps/site/src/assets/home/.
 *
 * A config of its own, so `npm run e2e` never runs them. Its server is the
 * studio tests' kind (astro dev over a throwaway copy of the playground),
 * with its own copy (e2e/.screens-site) and port, so it can run beside the
 * e2e tests and the previews: 4400–4409 are theirs. Nothing here saves.
 */
const PORT = 4410;

export default defineConfig({
  testDir: 'e2e/screens',
  testMatch: '*.screens.ts',
  // Kept apart from the e2e tests' results, which a run of either clears.
  outputDir: 'test-results/screens',
  // One at a time: astro dev compiles the studio on the first visit.
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  // The first visit waits for astro dev to compile the studio.
  timeout: 90_000,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${String(PORT)}` },
  webServer: {
    command: `node scripts/studio-site.mjs --serve ${String(PORT)} --site .screens-site`,
    url: `http://localhost:${String(PORT)}/admin/`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Local mode's user menu shows git's user.name; the pictures show a
    // neutral name, not whoever runs this. GIT_CONFIG_* outranks every
    // config file for the git the dev API runs.
    env: {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'user.name',
      GIT_CONFIG_VALUE_0: 'Robin Park',
    },
  },
});

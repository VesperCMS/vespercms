import { defineConfig, devices } from '@playwright/test';

/*
 * Two kinds of end-to-end test, each against its own server:
 * - `static`: the built playground served by scripts/static-server.mjs, with
 *   no rewrites, no headers and no functions: the spec §6.16 test matrix's
 *   "plain static host". Build first: `npm run build -w @vespercms/playground`.
 * - `studio`: the studio at /admin in local mode, on `astro dev` over a fresh
 *   copy of the playground (scripts/studio-site.mjs), because these tests
 *   save, upload and delete files.
 *
 * Ports 4400 and 4401 are for tests only; preview servers use 4402
 * (.claude/launch.json), so a running preview can never stand in for them.
 */
const STATIC_PORT = 4400;
const STUDIO_PORT = 4401;
/** GitHub mode's site; 4403 and 4404 are its fake GitHub and relay (scripts/github-site.mjs). */
const GITHUB_SITE_PORT = 4405;
/** The cloud's site; 4406 is the fake cloud (scripts/cloud-site.mjs). */
const CLOUD_SITE_PORT = 4407;
/** vespercms.com, built (apps/site). 4408 is its preview, so a preview never stands in. */
const SITE_PORT = 4409;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'static',
      testMatch: ['static-site.spec.ts', 'static-images.spec.ts', 'static-search.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${String(STATIC_PORT)}` },
    },
    {
      name: 'studio',
      testMatch: 'studio/*.spec.ts',
      // The tests share one site on disk, so they run one at a time, in one
      // worker. `fullyParallel: false` alone only orders a file's own tests:
      // the two spec files, and each --repeat-each copy, would still run side
      // by side and overwrite each other's files.
      fullyParallel: false,
      workers: 1,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${String(STUDIO_PORT)}` },
    },
    {
      // GitHub mode (spec §6.8): a built site, the real relay and a fake
      // GitHub over one repository, so these run one at a time too. No
      // retries: a serial file reruns from its first test, against a
      // repository the first attempt already published to, so a retry can
      // only fail on what the first attempt changed and hide the real error.
      name: 'github',
      testMatch: 'github/*.spec.ts',
      fullyParallel: false,
      workers: 1,
      retries: 0,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${String(GITHUB_SITE_PORT)}`,
      },
    },
    {
      // The cloud (spec §6.9): a built site and a fake cloud publishing to a
      // fake GitHub over one repository: one at a time, and no retries, for
      // the same reasons as GitHub mode.
      name: 'cloud',
      testMatch: 'cloud/*.spec.ts',
      fullyParallel: false,
      workers: 1,
      retries: 0,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${String(CLOUD_SITE_PORT)}`,
      },
    },
    {
      // vespercms.com, built: build first with `npm run build -w @vespercms/site`.
      name: 'site',
      testMatch: 'site/*.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${String(SITE_PORT)}` },
    },
  ],
  webServer: [
    {
      command: `node scripts/static-server.mjs apps/playground/dist --port ${String(STATIC_PORT)}`,
      url: `http://127.0.0.1:${String(STATIC_PORT)}/`,
      reuseExistingServer: false,
    },
    {
      command: `node scripts/studio-site.mjs --serve ${String(STUDIO_PORT)}`,
      url: `http://localhost:${String(STUDIO_PORT)}/admin/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'node scripts/github-site.mjs --serve',
      url: `http://127.0.0.1:${String(GITHUB_SITE_PORT)}/admin/`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'node scripts/cloud-site.mjs --serve',
      url: `http://127.0.0.1:${String(CLOUD_SITE_PORT)}/admin/`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `node scripts/static-server.mjs apps/site/dist --port ${String(SITE_PORT)}`,
      url: `http://127.0.0.1:${String(SITE_PORT)}/`,
      reuseExistingServer: false,
    },
  ],
});

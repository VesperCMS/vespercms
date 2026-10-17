import { defineConfig, devices } from '@playwright/test';

const PORT = 4400;

// End-to-end tests run against the built playground served by
// scripts/static-server.mjs: no rewrites, no headers, no functions. That is the
// spec §6.16 test matrix's "plain static host". Build first:
// `npm run build -w @vesper/playground`.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node scripts/static-server.mjs apps/playground/dist --port ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: !process.env.CI,
  },
});

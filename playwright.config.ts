import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. Points at BASE_URL (default: the local dev server) rather than
 * spinning up its own server, since the app in this repo needs a running
 * Postgres + backend + frontend stack (docker compose) that isn't something
 * `webServer` can bootstrap on its own.
 *
 * Realistic boundary (see docs/NAMING_CONVENTIONS.md and the project plan):
 * specs here can't drive an actual physical disc rip — anything hardware-bound
 * stops at the API layer, covered by backend pytest instead. Specs in
 * e2e/smoke/ are read-only and safe to run against any environment including
 * production. Specs in e2e/write/ create and clean up their own data — do not
 * point BASE_URL at a shared/production instance when running those.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3010',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

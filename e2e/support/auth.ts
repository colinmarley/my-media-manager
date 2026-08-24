import { Page, expect } from '@playwright/test';

/**
 * Logs in via the passphrase form. Defaults to the docker-compose dev
 * default (APP_DEFAULT_PASSWORD in docker-compose.yml) — that default is
 * only what seeds a *fresh* install, though, so an already-running instance
 * (like a long-lived homelab deployment) may have a different password set.
 * Set E2E_PASSWORD to override for any environment where that's the case.
 */
export async function login(page: Page) {
  const password = process.env.E2E_PASSWORD ?? 'C0d!ngC@rdsC0ff33';
  await page.goto('/login');
  await page.getByLabel('Passphrase').fill(password);
  // Scoped to the form: the app shell also renders a "Sign In" nav link on
  // every page (including /login itself), which getByRole('button', ...)
  // alone matches ambiguously.
  await page.locator('form').getByRole('button', { name: /sign in/i }).click();
  await expect(
    page,
    'Login did not redirect to /dashboard — if targeting an existing (non-fresh) ' +
    'instance, set E2E_PASSWORD to its actual passphrase rather than the docker-compose default.'
  ).toHaveURL(/\/dashboard/);
}

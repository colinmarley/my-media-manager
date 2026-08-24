import { test, expect } from '@playwright/test';
import { login } from '../support/auth';

// Read-only: safe to run against any environment, including production.

test('logs in with the configured passphrase and reaches the dashboard', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Choose a workspace below.')).toBeVisible();
});

test('rejects an incorrect passphrase', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Passphrase').fill('definitely-not-the-password');
  await page.locator('form').getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

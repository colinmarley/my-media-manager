import { test, expect } from '@playwright/test';
import { login } from '../support/auth';

/**
 * Creates a real disc catalog record and verifies it shows up in the
 * /dashboard/physical-media UI, then deletes it. Self-cleaning, but still
 * writes to whatever database BASE_URL points at — do NOT run this against
 * a shared/production instance without knowing that. Setup/teardown go
 * through the API directly (not the multi-field AddDiscForm) since the goal
 * here is verifying the catalog->UI read path, not the admin form itself.
 */

test('a created disc appears in the physical media list, and is gone after delete', async ({ page, baseURL }) => {
  await login(page);

  // Uses page.request (not the standalone `request` fixture) so the DELETE
  // call below carries the session cookie login() just established —
  // DELETE /api/catalog/discs/{id} requires an authenticated session.
  const uniqueTitle = `E2E Test Disc ${Date.now()}`;
  const createResponse = await page.request.post(`${baseURL}/api/backend/api/catalog/discs`, {
    data: { title: uniqueTitle },
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = await createResponse.json();
  expect(created.id).toBeTruthy();

  try {
    await page.goto('/dashboard/physical-media');
    await page.getByRole('tab', { name: /Discs/ }).click();
    await expect(page.getByRole('link', { name: uniqueTitle })).toBeVisible();

    await page.getByRole('link', { name: uniqueTitle }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/physical-media/discs/${created.id}`));
    await expect(page.getByRole('heading', { name: uniqueTitle })).toBeVisible();
  } finally {
    const deleteResponse = await page.request.delete(`${baseURL}/api/backend/api/catalog/discs/${created.id}`);
    expect(deleteResponse.ok()).toBeTruthy();
  }

  await page.goto('/dashboard/physical-media');
  await page.getByRole('tab', { name: /Discs/ }).click();
  await expect(page.getByRole('link', { name: uniqueTitle })).not.toBeVisible();
});

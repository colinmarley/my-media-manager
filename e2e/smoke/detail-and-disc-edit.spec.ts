import { test, expect } from '@playwright/test';
import { login } from '../support/auth';

/**
 * Issue #19 AC1 walkthrough: login -> open my library -> open one detail page
 * -> open physical media -> open the disc edit dialog -> cancel it.
 *
 * Read-only by construction: nothing is saved, and the last step asserts the
 * browser issued no write request (POST/PUT/PATCH/DELETE) while the dialog was
 * open — so a future change that makes "Cancel" persist something fails here.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('my library opens the detail page of one title', async ({ page }) => {
  await page.goto('/dashboard/my-library');
  await expect(page.getByRole('heading', { level: 3, name: 'My Library' })).toBeVisible();

  // Library cards are MUI CardActionAreas rendered as <a> pointing straight at
  // /dashboard/my-library/<mediaType>/<mediaId>. The shell's own "My Library"
  // nav link has no trailing slash, so it is not matched here.
  const card = page.locator('a[href^="/dashboard/my-library/"]').first();
  await expect(
    card,
    'No library cards to open: BASE_URL points at an instance with an empty library.',
  ).toBeVisible();

  const title = (await card.getByRole('heading', { level: 6 }).innerText()).trim();
  await card.click();

  await expect(page).toHaveURL(/\/dashboard\/my-library\/[^/]+\/[^/]+/);
  await expect(
    page.getByRole('heading', { level: 4 }).first(),
    `Detail page for "${title}" never rendered a title — its details request probably failed.`,
  ).toContainText(title);
  await expect(page.getByRole('link', { name: 'Back to My Library' })).toBeVisible();
  await expect(page.getByText('This title was not found.')).toBeHidden();
});

test('disc edit dialog opens pre-filled, and cancelling changes nothing', async ({ page }) => {
  // Registered after login() on purpose: the login POST is not part of what
  // this test claims is write-free.
  const writes: string[] = [];
  page.on('request', (request) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto('/dashboard/physical-media');
  await expect(page.getByRole('heading', { name: 'Physical Media' })).toBeVisible();
  await page.getByRole('tab', { name: /Discs/ }).click();

  const row = page.locator('tbody tr').first();
  await expect(
    row,
    'No discs in the catalog: the disc edit step needs an instance with at least one disc.',
  ).toBeVisible();
  const title = (await row.locator('a').first().innerText()).trim();

  // The row action is an IconButton wrapped in <Tooltip title="Edit">: MUI
  // copies a string tooltip title onto the child as aria-label, so its
  // accessible name is "Edit" (and not the row's "Delete").
  await row.getByRole('button', { name: 'Edit' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Edit Disc' })).toBeVisible();
  await expect(dialog.getByLabel('Title')).toHaveValue(title);

  await dialog.getByRole('button', { name: /Cancel/i }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: title }).first()).toBeVisible();

  expect(writes, `cancelling the disc edit dialog wrote: ${writes.join(', ')}`).toEqual([]);
});

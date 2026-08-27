import { test, expect } from '@playwright/test';
import { login } from '../support/auth';

/**
 * Drives the full disc CRUD + file connect/disconnect flow through the real
 * UI (dialogs, not direct API calls) — create -> edit -> connect a file ->
 * disconnect -> delete. Self-cleaning for the disc row itself; the seeded
 * MediaFile row used for the connect/disconnect step is left behind since
 * the backend has no media-file delete endpoint (only ever created by the
 * real ingest pipeline otherwise) — same "don't run against shared/production"
 * boundary already documented for e2e/write/disc-catalog.spec.ts applies here.
 */

test('create, edit, connect a file, disconnect, and delete a disc via the UI', async ({ page, baseURL }) => {
  await login(page);

  const uniqueSuffix = Date.now();
  const createdTitle = `E2E CRUD Disc ${uniqueSuffix}`;
  const editedTitle = `E2E CRUD Disc ${uniqueSuffix} (Edited)`;
  const fileName = `e2e-crud-file-${uniqueSuffix}.mkv`;

  // --- Create (via the "New Disc" dialog) ---
  await page.goto('/dashboard/physical-media');
  await page.getByRole('tab', { name: /Discs/ }).click();
  await page.getByRole('button', { name: /New Disc/i }).click();
  await page.getByLabel('Title', { exact: false }).fill(createdTitle);
  await page.getByRole('button', { name: /Create Disc/i }).click();

  await expect(page.getByRole('link', { name: createdTitle })).toBeVisible();
  await page.getByRole('link', { name: createdTitle }).click();
  await expect(page.getByRole('heading', { name: createdTitle })).toBeVisible();

  const discId = page.url().split('/').pop()!;

  try {
    // --- Edit ---
    await page.getByRole('button', { name: /^Edit$/ }).click();
    const titleField = page.getByLabel('Title', { exact: false });
    await titleField.fill('');
    await titleField.fill(editedTitle);
    await page.getByRole('button', { name: /Save Changes/i }).click();
    await expect(page.getByRole('heading', { name: editedTitle })).toBeVisible();

    // --- Seed an unlinked MediaFile to connect (setup via API; the point
    // under test is the connect/disconnect UI, not file ingestion) ---
    const linkResponse = await page.request.post(`${baseURL}/api/backend/api/catalog/link-source`, {
      data: { filePaths: [`/test/e2e/${fileName}`], discId },
    });
    expect(linkResponse.ok()).toBeTruthy();
    const searchResponse = await page.request.get(
      `${baseURL}/api/backend/api/catalog/media-files/search?q=${encodeURIComponent(fileName)}`
    );
    expect(searchResponse.ok()).toBeTruthy();
    const [seededFile] = await searchResponse.json();
    expect(seededFile?.id).toBeTruthy();
    const unlinkResponse = await page.request.patch(
      `${baseURL}/api/backend/api/catalog/media-files/${seededFile.id}/link`,
      { data: { discId: null } }
    );
    expect(unlinkResponse.ok()).toBeTruthy();

    // --- Connect (via the "Connect a file" dialog) ---
    await expect(page.getByText('Connected Files (0)')).toBeVisible();
    await page.getByRole('button', { name: /Connect a file/i }).click();
    await page.getByLabel('Search by filename').fill(fileName);
    await expect(page.getByText(fileName)).toBeVisible();
    await page.getByText(fileName).click();
    await expect(page.getByText('Connected Files (1)')).toBeVisible();
    await expect(page.getByText(fileName)).toBeVisible();

    // --- Disconnect ---
    await page.getByRole('button', { name: /Disconnect from this item/i }).click();
    await expect(page.getByText('Connected Files (0)')).toBeVisible();
  } finally {
    // --- Delete (via the detail page, whichever title is current) ---
    await page.getByRole('button', { name: /^Delete$/ }).click();
    await page.getByRole('button', { name: /^Delete$/ }).last().click();
    await expect(page).toHaveURL(/\/dashboard\/physical-media$/);

    const cleanupResponse = await page.request.delete(`${baseURL}/api/backend/api/catalog/discs/${discId}`);
    // Already deleted by the UI step above in the success path; tolerate 404 here.
    expect([200, 404]).toContain(cleanupResponse.status());
  }

  await page.goto('/dashboard/physical-media');
  await page.getByRole('tab', { name: /Discs/ }).click();
  await expect(page.getByRole('link', { name: editedTitle })).not.toBeVisible();
});

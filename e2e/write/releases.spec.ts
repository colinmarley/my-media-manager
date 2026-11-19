import { test, expect, APIRequestContext } from '@playwright/test';
import { login } from '../support/auth';

/**
 * Releases (the thing that was bought: one barcode, N discs) end to end:
 * the API through the Next proxy, and the physical-media pages that show the
 * discs. The web UI has no release screens yet, so releases are created and
 * read through the API; what is checked in the UI is that discs belonging to
 * a release, and loose discs with their automatic release, still list, open
 * and edit as before.
 *
 * Self-cleaning. Writes to whatever database BASE_URL points at, so the same
 * "not against a shared/production instance" rule as the other write specs
 * applies.
 */

const api = (baseURL: string | undefined, path: string) => `${baseURL}/api/backend/api/catalog${path}`;

async function deleteDisc(request: APIRequestContext, baseURL: string | undefined, id: string) {
  const response = await request.delete(api(baseURL, `/discs/${id}`));
  expect([200, 404]).toContain(response.status());
}

test('a combo-pack release: one request, two discs, both usable in the UI', async ({ page, baseURL }) => {
  await login(page);

  const suffix = Date.now();
  const title = `E2E Release ${suffix}`;
  const barcode = `9${suffix}`.slice(0, 13);

  const createResponse = await page.request.post(api(baseURL, '/releases?check_duplicates=true'), {
    data: {
      title,
      barcode,
      edition: 'Blu-ray + DVD',
      packaging: 'combo_pack',
      discs: [
        { format: 'Blu-ray', contentRole: 'feature' },
        { format: 'DVD', contentRole: 'duplicate_format', ripIntent: 'skip', ripSkipReason: 'DVD copy' },
      ],
    },
  });
  expect(createResponse.ok(), await createResponse.text()).toBeTruthy();
  const release = await createResponse.json();
  const [bluRay, dvd] = release.discs;

  try {
    expect(release.expectedDiscCount).toBe(2);
    expect(release.discs.map((d: { title: string }) => d.title)).toEqual([`${title} - Disc 1`, `${title} - Disc 2`]);
    expect(bluRay.setId).toBe(release.id);
    expect(dvd.ripIntent).toBe('skip');

    // The same barcode again is refused until the client says it is a second copy.
    const duplicate = await page.request.post(api(baseURL, '/releases?check_duplicates=true'), {
      data: { title, barcode },
    });
    expect(duplicate.status()).toBe(409);
    expect((await duplicate.json()).detail.existingId).toBe(release.id);

    // Scanning the set's barcode (disc ripper link panel, phone locate) finds both discs.
    const byBarcode = await (await page.request.get(api(baseURL, `/discs/search?barcode=${barcode}`))).json();
    expect(byBarcode.map((d: { id: string }) => d.id).sort()).toEqual([bluRay.id, dvd.id].sort());

    // Both discs are in the physical media list and open normally.
    await page.goto('/dashboard/physical-media');
    await page.getByRole('tab', { name: /Discs/ }).click();
    await expect(page.getByRole('link', { name: `${title} - Disc 1`, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: `${title} - Disc 2`, exact: true })).toBeVisible();

    await page.getByRole('link', { name: `${title} - Disc 1`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/physical-media/discs/${bluRay.id}`));
    await expect(page.getByRole('heading', { name: `${title} - Disc 1` })).toBeVisible();
    await expect(page.getByText('Part of a set', { exact: true })).toBeVisible();

    // Editing the disc in the dialog (a PUT that never mentions the set) keeps it in its release.
    const editedTitle = `${title} - Disc 1 (Edited)`;
    await page.getByRole('button', { name: /^Edit$/ }).click();
    // Scoped to the dialog: the detail page behind it has a "Titles" section that also matches the label.
    const titleField = page.getByRole('dialog').getByRole('textbox', { name: 'Title' });
    await titleField.fill('');
    await titleField.fill(editedTitle);
    await page.getByRole('button', { name: /Save Changes/i }).click();
    await expect(page.getByRole('heading', { name: editedTitle })).toBeVisible();

    const after = await (await page.request.get(api(baseURL, `/releases/${release.id}`))).json();
    expect(after.discs.map((d: { id: string }) => d.id)).toEqual([bluRay.id, dvd.id]);
    expect(after.discs[0].title).toBe(editedTitle);
    expect(after.title).toBe(title);

    // A release with discs cannot be deleted from under them.
    const refused = await page.request.delete(api(baseURL, `/releases/${release.id}`));
    expect(refused.status()).toBe(409);
  } finally {
    await deleteDisc(page.request, baseURL, bluRay.id);
    await deleteDisc(page.request, baseURL, dvd.id);
    const deleted = await page.request.delete(api(baseURL, `/releases/${release.id}`));
    expect([200, 404]).toContain(deleted.status());
  }

  expect((await page.request.get(api(baseURL, `/releases/${release.id}`))).status()).toBe(404);
});

test('a loose disc made in the UI gets an automatic release and is not shown as a set', async ({ page, baseURL }) => {
  await login(page);

  const title = `E2E Loose Disc ${Date.now()}`;

  await page.goto('/dashboard/physical-media');
  await page.getByRole('tab', { name: /Discs/ }).click();
  await page.getByRole('button', { name: /New Disc/i }).click();
  await page.getByLabel('Title', { exact: false }).fill(title);
  await page.getByRole('button', { name: /Create Disc/i }).click();

  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  await page.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const discId = page.url().split('/').pop()!;

  let releaseId: string | undefined;
  try {
    await expect(page.getByText('Part of a set', { exact: true })).toHaveCount(0);

    const disc = await (await page.request.get(api(baseURL, `/discs/${discId}`))).json();
    releaseId = disc.releaseId;
    expect(releaseId).toBeTruthy();
    // To clients that predate releases the disc is "not in a set".
    expect(disc.setId ?? null).toBeNull();

    const release = await (await page.request.get(api(baseURL, `/releases/${releaseId}`))).json();
    expect(release.packaging).toBe('loose');
    expect(release.title).toBe(title);
    expect(release.discs.map((d: { id: string }) => d.id)).toEqual([discId]);

    // Not offered as a boxed set to join.
    const sets = await (await page.request.get(api(baseURL, `/disc-sets?title=${encodeURIComponent(title)}`))).json();
    expect(sets).toEqual([]);

    // Saving the disc again from the edit dialog keeps the same release.
    await page.getByRole('button', { name: /^Edit$/ }).click();
    await page.getByRole('button', { name: /Save Changes/i }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect
      .poll(async () => (await (await page.request.get(api(baseURL, `/discs/${discId}`))).json()).releaseId)
      .toBe(releaseId);
  } finally {
    await deleteDisc(page.request, baseURL, discId);
  }

  // The automatic release goes with its disc.
  if (releaseId) {
    expect((await page.request.get(api(baseURL, `/releases/${releaseId}`))).status()).toBe(404);
  }
});

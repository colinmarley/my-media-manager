import { test, expect } from '@playwright/test';
import { login } from '../support/auth';

// Read-only: navigates to each major page and asserts it renders without
// erroring, without creating or mutating any data. Safe to run against any
// environment, including production.

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('physical media page loads with Discs/Tapes tabs', async ({ page }) => {
  await page.goto('/dashboard/physical-media');
  await expect(page.getByRole('heading', { name: 'Physical Media' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Discs/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Tapes/ })).toBeVisible();
});

test('my library page loads', async ({ page }) => {
  await page.goto('/dashboard/my-library');
  await expect(page).toHaveURL(/my-library/);
});

test('admin page loads with Extras Review tab available', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('tab', { name: 'Extras Review' })).toBeVisible();
});

test('disc ripper page loads through the Scan Disc step', async ({ page }) => {
  await page.goto('/admin/disc-ripper');
  await expect(page.getByRole('heading', { name: 'Disc Ripper' })).toBeVisible();
  await expect(page.getByRole('button', { name: /scan disc/i })).toBeVisible();
});

test('tape ingest page loads', async ({ page }) => {
  await page.goto('/admin/tape-ingest');
  await expect(page).toHaveURL(/tape-ingest/);
});

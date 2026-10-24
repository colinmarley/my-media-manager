/**
 * QA probes for src/service/catalog/CatalogStatsService.ts (issue #16).
 *
 * tests/components/CatalogStatsPage.test.tsx mocks this module wholesale, so
 * nothing there pins the URL the page actually asks for — a typo in the path
 * or a lost `recent_days` param would keep every page test green while the
 * live page 404s. These probes pin the request the page depends on, plus the
 * "errors are not swallowed" contract the page's retry panel relies on.
 *
 * Issue #16 acceptance criteria -> the tests here:
 *
 *   AC1 "A backend endpoint `GET /api/catalog/stats` ..." — the web half: what
 *       the page actually asks that endpoint for.
 *     -> tests/utils/CatalogStatsService.test.ts::CatalogStatsService (QA probes) > hits GET /api/catalog/stats through the backend proxy with the 30-day window
 *     -> ::passes a custom window through as recent_days
 *     -> ::rejects instead of returning zeroes when the endpoint fails
 *        (figures, not zeros, come from the endpoint itself —
 *         backend/tests/test_catalog_stats.py::test_ac1_endpoint_returns_every_breakdown_the_criterion_names)
 *
 *   AC2 "A `/dashboard/stats` page ..." — the request the page is built on.
 *     -> the first test above; the page itself is rendered in
 *        tests/components/CatalogStatsPage.test.tsx
 *
 *   AC3 — these probes are the mocked-fetch (no backend) counterpart of the
 *        mocked-DB endpoint unit test AC3 asks for.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCatalogStats } from '@/service/catalog/CatalogStatsService';

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const STATS = {
  generatedAt: '2026-03-01T00:00:00+00:00',
  recentDays: 30,
  totalItems: 2,
  byType: { movie: 1, series: 0, disc: 1, tape: 0 },
  byDiscFormat: [{ label: 'Blu-ray', count: 1 }],
  byDecade: [{ label: '1970s', startYear: 1970, count: 2 }],
  undated: 0,
  recentlyAdded: { days: 30, count: 1, items: [] },
  storage: { total: 1, withLocation: 1, withoutLocation: 0, byType: [{ label: 'Box', count: 1 }] },
  lentOut: { count: 0, items: [] },
};

describe('CatalogStatsService (QA probes)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hits GET /api/catalog/stats through the backend proxy with the 30-day window', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(STATS));

    const stats = await getCatalogStats();

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe('/api/backend/api/catalog/stats?recent_days=30');
    expect((init as RequestInit).method ?? 'GET').toBe('GET');
    expect(stats.totalItems).toBe(2);
    expect(stats.lentOut.count).toBe(0);
  });

  it('passes a custom window through as recent_days', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ ...STATS, recentDays: 7 }));

    await getCatalogStats(7);

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/api/catalog/stats?recent_days=7');
  });

  it('rejects instead of returning zeroes when the endpoint fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ detail: 'nope' }, 500));

    await expect(getCatalogStats()).rejects.toThrow('API error 500');
  });
});

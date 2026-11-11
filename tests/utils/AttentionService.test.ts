import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AttentionService, { buildItemsPath, isAttentionUnsupported } from '@/service/attention/AttentionService';
import { ApiError } from '@/service/api/apiClient';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
  return { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
};

describe('AttentionService', () => {
  beforeEach(() => {
    fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reads the summary and fills in missing counts', async () => {
    fetchMock.mockResolvedValueOnce(json({ counts: { needs_rename: 2, unprobed: 9 }, total: 2, generatedAt: '2026-11-11T00:00:00Z' }));
    const summary = await AttentionService.getSummary();
    expect(lastCall().url).toBe('/api/backend/api/attention/summary');
    expect(summary.total).toBe(2);
    expect(summary.counts.needs_rename).toBe(2);
    expect(summary.counts.needs_assignment).toBe(0);
    expect(summary.counts.unprobed).toBe(9);
  });

  it('builds the items query: kinds comma-separated, title filter only as a pair', () => {
    expect(buildItemsPath()).toBe('/api/attention/items');
    expect(buildItemsPath({ kind: ['needs_rename', 'needs_review'], limit: 50, offset: 100 }))
      .toBe('/api/attention/items?kind=needs_rename%2Cneeds_review&limit=50&offset=100');
    expect(buildItemsPath({ kind: 'missing_file', mediaType: 'movie' })).toBe('/api/attention/items?kind=missing_file');
    expect(buildItemsPath({ mediaType: 'series', mediaId: 's1' })).toBe('/api/attention/items?mediaType=series&mediaId=s1');
  });

  it('normalizes items and tolerates an empty body', async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [{ id: 'needs_review:media_file:f1', kind: 'needs_review', subjectType: 'media_file', subjectId: 'f1', dismissible: false }], total: 7 }));
    const page = await AttentionService.getItems({ kind: 'needs_review' });
    expect(page.total).toBe(7);
    expect(page.items[0]).toMatchObject({ kind: 'needs_review', dismissible: false, reasons: [], file: null, mediaId: null });

    fetchMock.mockResolvedValueOnce(json(null));
    expect(await AttentionService.getItems()).toEqual({ items: [], total: 0 });
  });

  it('dismisses (null days = until it changes), undoes and lists dismissals', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'd1' }));
    await AttentionService.dismiss({ kind: 'needs_rename', subjectType: 'media_file', subjectId: 'f1', note: '  keep  ' });
    expect(lastCall()).toMatchObject({
      url: '/api/backend/api/attention/dismiss',
      method: 'POST',
      body: { kind: 'needs_rename', subjectType: 'media_file', subjectId: 'f1', days: null, note: 'keep' },
    });

    await AttentionService.dismiss({ kind: 'needs_rename', subjectType: 'media_file', subjectId: 'f1', days: 30, note: '' });
    expect(lastCall().body).toEqual({ kind: 'needs_rename', subjectType: 'media_file', subjectId: 'f1', days: 30 });

    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await AttentionService.undoDismissal('d/1');
    expect(lastCall()).toMatchObject({ url: '/api/backend/api/attention/dismiss/d%2F1', method: 'DELETE' });

    fetchMock.mockResolvedValueOnce(json({ dismissals: [{ id: 'd1' }] }));
    expect(await AttentionService.getDismissals()).toEqual([{ id: 'd1' }]);
  });

  it('clears a review flag through the review endpoint', async () => {
    await AttentionService.clearReviewFlag('f1');
    expect(lastCall()).toMatchObject({ url: '/api/backend/api/catalog/media-files/f1/review', method: 'PATCH', body: { needsReview: false } });
  });

  it('treats 404 / 405 as "not supported" and keeps other errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    const error = await AttentionService.getSummary().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(isAttentionUnsupported(error)).toBe(true);
    expect(isAttentionUnsupported(new ApiError(405, ''))).toBe(true);
    expect(isAttentionUnsupported(new ApiError(500, ''))).toBe(false);
  });
});

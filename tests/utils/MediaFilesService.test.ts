import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  flattenFileGroups,
  forEachFile,
  getInventoryStatus,
  getMediaDetail,
  getSourceTitles,
  isEndpointUnavailable,
  linkFile,
  renameToCanonical,
  setFileReview,
  triggerInventoryScan,
  unlinkFile,
} from '@/service/library/MediaFilesService';
import { ApiError } from '@/service/api/apiClient';
import type { MediaFile } from '@/types/library/MediaFile.type';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
  return { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
};

const file = (id: string): MediaFile => ({
  id,
  fileName: `${id}.mkv`,
  filePath: `/lib/${id}.mkv`,
  fileSize: 1,
  detectedMediaType: null,
  assignmentStatus: null,
  targetPath: null,
  organizationStatus: null,
  createdAt: null,
});

describe('MediaFilesService', () => {
  beforeEach(() => {
    fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads a title with one /detail request, encoding the id', async () => {
    fetchMock.mockResolvedValueOnce(json({ record: { id: 'm1' } }));

    await getMediaDetail('movie', 'tt 1/2');

    expect(lastCall().url).toBe('/api/backend/api/catalog/media/movie/tt%201%2F2/detail');
  });

  it('links and unlinks through PATCH /media-files/{id}/link with the documented bodies', async () => {
    await linkFile('f1', { kind: 'disc', id: 'd1' });
    expect(lastCall()).toMatchObject({ url: '/api/backend/api/catalog/media-files/f1/link', method: 'PATCH', body: { discId: 'd1' } });

    await linkFile('f1', { kind: 'tape', id: 't1' });
    expect(lastCall().body).toEqual({ tapeId: 't1' });

    await unlinkFile('f1', 'disc');
    expect(lastCall().body).toEqual({ discId: null });

    await unlinkFile('f1', 'tape');
    expect(lastCall().body).toEqual({ tapeId: null });
  });

  it('flags a file for review, sending the note only when there is one', async () => {
    await setFileReview('f1', true, 'audio out of sync');
    expect(lastCall()).toMatchObject({ url: '/api/backend/api/catalog/media-files/f1/review', method: 'PATCH', body: { needsReview: true, note: 'audio out of sync' } });

    await setFileReview('f1', false);
    expect(lastCall().body).toEqual({ needsReview: false });
  });

  it('previews and applies the canonical rename with the dryRun flag', async () => {
    await renameToCanonical('f1', true);
    expect(lastCall()).toMatchObject({ url: '/api/backend/api/catalog/media-files/f1/rename-canonical?dryRun=true', method: 'POST' });

    await renameToCanonical('f1', false);
    expect(lastCall().url).toContain('dryRun=false');
  });

  it('treats a 409 from the scan trigger as an already-running scan', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await expect(triggerInventoryScan()).resolves.toBe('started');

    fetchMock.mockResolvedValueOnce(json({ detail: 'running' }, 409));
    await expect(triggerInventoryScan()).resolves.toBe('already-running');

    fetchMock.mockResolvedValueOnce(json({ detail: 'boom' }, 500));
    await expect(triggerInventoryScan()).rejects.toThrow('API error 500');
  });

  it('unwraps the inventory status envelope', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, data: { running: true, phase: 'probing', counts: { probed: 3 } } }));

    await expect(getInventoryStatus()).resolves.toEqual({ running: true, phase: 'probing', counts: { probed: 3 } });

    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await expect(getInventoryStatus()).resolves.toEqual({ running: false, phase: null, counts: {} });
  });

  it('reads the titles of a disc or a tape', async () => {
    fetchMock.mockResolvedValueOnce(json([{ mediaType: 'movie', mediaId: 'm1', title: 'Big Movie' }]));
    await expect(getSourceTitles('disc', 'd1')).resolves.toHaveLength(1);
    expect(lastCall().url).toBe('/api/backend/api/catalog/discs/d1/links');

    fetchMock.mockResolvedValueOnce(json(null));
    await expect(getSourceTitles('tape', 't1')).resolves.toEqual([]);
    expect(lastCall().url).toBe('/api/backend/api/catalog/tapes/t1/links');
  });

  it('feature-detects missing routes from 404 / 405 only', () => {
    expect(isEndpointUnavailable(new ApiError(404, 'Not Found'))).toBe(true);
    expect(isEndpointUnavailable(new ApiError(405, 'Method Not Allowed'))).toBe(true);
    expect(isEndpointUnavailable(new Error('API error 404: {}'))).toBe(true);
    expect(isEndpointUnavailable(new ApiError(500, ''))).toBe(false);
    expect(isEndpointUnavailable(new Error('Request timed out.'))).toBe(false);
    expect(isEndpointUnavailable(null)).toBe(false);
  });

  it('runs a bulk action per file and reports the failures', async () => {
    const action = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('nope');
    });

    const result = await forEachFile(['a', 'b', 'c'], action);

    expect(result.succeeded).toEqual(['a', 'c']);
    expect(result.failed.map((f) => f.id)).toEqual(['b']);
  });

  it('flattens the grouped files in display order', () => {
    const groups = {
      main: [file('main')],
      versions: [file('version')],
      extras: [file('extra')],
      other: [file('other')],
      seasons: [{ seasonNumber: 1, episodes: [file('s1e1')], extras: [file('s1x')], other: [] }],
    };

    expect(flattenFileGroups(groups).map((f) => f.id)).toEqual(['main', 'version', 'extra', 'other', 's1e1', 's1x']);
    expect(flattenFileGroups(null)).toEqual([]);
  });
});

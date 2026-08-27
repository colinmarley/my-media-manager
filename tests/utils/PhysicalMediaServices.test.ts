import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { searchDiscs, createDisc, updateDisc, deleteDisc } from '@/service/catalog/DiscCatalogService';
import { searchTapes, createTape, updateTape, deleteTape } from '@/service/catalog/TapeCatalogService';
import { searchMediaFiles, connectFileToDisc, connectFileToTape, disconnectFile } from '@/service/catalog/MediaFileLinkService';

function mockFetchOnce(body: unknown, ok = true) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

describe('DiscCatalogService', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('searchDiscs returns [] when no params given, without calling fetch', async () => {
    const fetchMock = vi.spyOn(global, 'fetch');
    const result = await searchDiscs({});
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searchDiscs builds a query string from title and barcode', async () => {
    const fetchMock = mockFetchOnce([{ id: 'd1', title: 'Matrix' }]);
    await searchDiscs({ title: 'Matrix', barcode: '123' });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/backend/api/catalog/discs/search');
    expect(url).toContain('title=Matrix');
    expect(url).toContain('barcode=123');
  });

  it('createDisc POSTs to /api/catalog/discs', async () => {
    const fetchMock = mockFetchOnce({ id: 'new-id', title: 'New Disc' });
    await createDisc({ title: 'New Disc' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/backend/api/catalog/discs');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify({ title: 'New Disc' }));
  });

  it('updateDisc PUTs to /api/catalog/discs/{id} with id included in the body', async () => {
    const fetchMock = mockFetchOnce({ id: 'disc-1', title: 'Updated' });
    await updateDisc('disc-1', { title: 'Updated' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/backend/api/catalog/discs/disc-1');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ title: 'Updated', id: 'disc-1' });
  });

  it('deleteDisc DELETEs to /api/catalog/discs/{id}', async () => {
    const fetchMock = mockFetchOnce({ deleted: 'disc-1' });
    await deleteDisc('disc-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/backend/api/catalog/discs/disc-1');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});

describe('TapeCatalogService', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('searchTapes returns [] when no params given, without calling fetch', async () => {
    const fetchMock = vi.spyOn(global, 'fetch');
    const result = await searchTapes({});
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searchTapes uses tape_label (snake_case) as the query param', async () => {
    const fetchMock = mockFetchOnce([]);
    await searchTapes({ tapeLabel: 'VHS_0001' });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('tape_label=VHS_0001');
  });

  it('createTape POSTs to /api/catalog/tapes', async () => {
    const fetchMock = mockFetchOnce({ id: 'tape-1', title: 'New Tape' });
    await createTape({ title: 'New Tape' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/backend/api/catalog/tapes');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('updateTape PUTs to /api/catalog/tapes/{id} with id included in the body', async () => {
    const fetchMock = mockFetchOnce({ id: 'tape-1', title: 'Updated' });
    await updateTape('tape-1', { title: 'Updated' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/backend/api/catalog/tapes/tape-1');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ title: 'Updated', id: 'tape-1' });
  });

  it('deleteTape DELETEs to /api/catalog/tapes/{id}', async () => {
    const fetchMock = mockFetchOnce({ deleted: 'tape-1' });
    await deleteTape('tape-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/backend/api/catalog/tapes/tape-1');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});

describe('MediaFileLinkService', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('searchMediaFiles with no params hits the search endpoint with no query string', async () => {
    const fetchMock = mockFetchOnce([]);
    await searchMediaFiles({});
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('/api/backend/api/catalog/media-files/search');
  });

  it('searchMediaFiles passes q and unlinked as query params', async () => {
    const fetchMock = mockFetchOnce([]);
    await searchMediaFiles({ q: 'vacation', unlinked: true });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('q=vacation');
    expect(url).toContain('unlinked=true');
  });

  it('connectFileToDisc PATCHes with { discId }', async () => {
    const fetchMock = mockFetchOnce({ id: 'file-1', disc_id: 'disc-1' });
    await connectFileToDisc('file-1', 'disc-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/backend/api/catalog/media-files/file-1/link');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ discId: 'disc-1' });
  });

  it('connectFileToTape PATCHes with { tapeId }', async () => {
    const fetchMock = mockFetchOnce({ id: 'file-1', tape_id: 'tape-1' });
    await connectFileToTape('file-1', 'tape-1');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ tapeId: 'tape-1' });
  });

  it('disconnectFile(disc) PATCHes with { discId: null }', async () => {
    const fetchMock = mockFetchOnce({ id: 'file-1', disc_id: null });
    await disconnectFile('file-1', 'disc');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ discId: null });
  });

  it('disconnectFile(tape) PATCHes with { tapeId: null }', async () => {
    const fetchMock = mockFetchOnce({ id: 'file-1', tape_id: null });
    await disconnectFile('file-1', 'tape');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ tapeId: null });
  });
});

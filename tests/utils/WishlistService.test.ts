import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  listWishlist, addWishlistItem, deleteWishlistItem, validateWishlistItem,
} from '@/service/catalog/WishlistService';

function mockFetchOnce(body: unknown, ok = true) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

describe('WishlistService calls', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('listWishlist GETs /api/wishlist and returns the items in server order', async () => {
    const items = [{ id: 'a', title: 'Old' }, { id: 'b', title: 'New' }];
    const fetchMock = mockFetchOnce(items);
    await expect(listWishlist()).resolves.toEqual(items);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/backend/api/wishlist');
    expect((init as RequestInit).method).toBeUndefined();
  });

  it('addWishlistItem POSTs the item to /api/wishlist', async () => {
    const fetchMock = mockFetchOnce({ id: 'new', title: 'Heat' });
    await addWishlistItem({ title: 'Heat', barcode: '012345678905' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/backend/api/wishlist');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ title: 'Heat', barcode: '012345678905' });
  });

  it('deleteWishlistItem DELETEs /api/wishlist/{id}', async () => {
    const fetchMock = mockFetchOnce({ deleted: 'abc' });
    await deleteWishlistItem('abc');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/backend/api/wishlist/abc');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('propagates backend errors', async () => {
    mockFetchOnce({ detail: 'nope' }, false);
    await expect(deleteWishlistItem('abc')).rejects.toThrow(/API error 500/);
  });
});

describe('validateWishlistItem', () => {
  it('accepts a title-only item', () => {
    expect(validateWishlistItem({ title: 'Heat' })).toEqual({});
  });

  it('accepts every optional field when valid', () => {
    expect(validateWishlistItem({
      title: 'Heat', format: 'Blu-ray', year: '1995', barcode: '12345678', imdbId: 'tt0113277', notes: 'Criterion',
    })).toEqual({});
  });

  it('requires a non-blank title', () => {
    expect(validateWishlistItem({ title: '' }).title).toBe('Title is required');
    expect(validateWishlistItem({ title: '   ' }).title).toBe('Title is required');
  });

  it('caps the title at 300 characters', () => {
    expect(validateWishlistItem({ title: 'a'.repeat(300) }).title).toBeUndefined();
    expect(validateWishlistItem({ title: 'a'.repeat(301) }).title).toMatch(/300/);
  });

  it('requires the barcode to be 8–14 digits', () => {
    expect(validateWishlistItem({ title: 'x', barcode: '1234567' }).barcode).toBeDefined();
    expect(validateWishlistItem({ title: 'x', barcode: '12345678' }).barcode).toBeUndefined();
    expect(validateWishlistItem({ title: 'x', barcode: '12345678901234' }).barcode).toBeUndefined();
    expect(validateWishlistItem({ title: 'x', barcode: '123456789012345' }).barcode).toBeDefined();
    expect(validateWishlistItem({ title: 'x', barcode: '1234abcd' }).barcode).toBeDefined();
  });

  it('requires imdbId to be "tt" followed by digits', () => {
    expect(validateWishlistItem({ title: 'x', imdbId: 'tt0113277' }).imdbId).toBeUndefined();
    expect(validateWishlistItem({ title: 'x', imdbId: '0113277' }).imdbId).toBeDefined();
    expect(validateWishlistItem({ title: 'x', imdbId: 'tt' }).imdbId).toBeDefined();
    expect(validateWishlistItem({ title: 'x', imdbId: 'tt12a' }).imdbId).toBeDefined();
  });

  it('enforces the backend length caps on format, year and notes', () => {
    const errors = validateWishlistItem({
      title: 'x', format: 'f'.repeat(41), year: 'y'.repeat(11), notes: 'n'.repeat(1001),
    });
    expect(errors.format).toBeDefined();
    expect(errors.year).toBeDefined();
    expect(errors.notes).toBeDefined();
  });
});

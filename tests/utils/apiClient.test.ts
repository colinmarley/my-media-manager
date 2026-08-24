/**
 * Tests for src/service/api/apiClient.ts
 *
 * We mock the global `fetch` so no real network call is made.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { api } from '@/service/api/apiClient';

// Minimal mock response factory
function mockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = { 'Content-Type': 'application/json' }
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('apiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('api.get', () => {
    it('calls fetch with GET and the correct URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ ok: true }));

      await api.get('/auth/me');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/me'),
        expect.objectContaining({ credentials: 'include' })
      );
      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect((options as RequestInit).method).toBeUndefined(); // defaults to GET
    });

    it('returns parsed JSON on success', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ authenticated: true }));

      const result = await api.get<{ authenticated: boolean }>('/auth/me');
      expect(result).toEqual({ authenticated: true });
    });

    it('throws an Error when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ detail: 'Not authenticated' }, 401));

      await expect(api.get('/auth/me')).rejects.toThrow('API error 401');
    });
  });

  describe('api.post', () => {
    it('calls fetch with POST and serialised body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ authenticated: true }));

      await api.post('/auth/login', { password: 'secret' });

      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect((options as RequestInit).method).toBe('POST');
      expect((options as RequestInit).body).toBe(JSON.stringify({ password: 'secret' }));
    });

    it('includes Content-Type application/json header', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

      await api.post('/auth/logout', {});

      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect((options as RequestInit & { headers: Record<string, string> }).headers['Content-Type']).toBe('application/json');
    });

    it('throws on non-2xx response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ detail: 'Incorrect password' }, 401));

      await expect(api.post('/auth/login', { password: 'wrong' })).rejects.toThrow('API error 401');
    });
  });

  describe('api.delete', () => {
    it('calls fetch with DELETE', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

      await api.delete('/some/resource');

      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect((options as RequestInit).method).toBe('DELETE');
    });
  });

  describe('api.put', () => {
    it('calls fetch with PUT and serialised body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

      await api.put('/some/resource', { field: 'value' });

      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect((options as RequestInit).method).toBe('PUT');
      expect((options as RequestInit).body).toBe(JSON.stringify({ field: 'value' }));
    });
  });
});

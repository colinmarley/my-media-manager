/**
 * Tests for src/store/useAuthenticationStore.ts
 *
 * We mock api calls with vi.mock so no network is involved.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the api client BEFORE importing the store
vi.mock('@/service/api/apiClient', () => ({
  api: {
    get:  vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '@/service/api/apiClient';
import useAuthenticationStore from '@/store/useAuthenticationStore';

function resetStore() {
  useAuthenticationStore.setState({ authenticated: false, loading: false, error: null });
}

describe('useAuthenticationStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('initial state', () => {
    it('starts unauthenticated', () => {
      const { authenticated } = useAuthenticationStore.getState();
      expect(authenticated).toBe(false);
    });

    it('starts with no error', () => {
      const { error } = useAuthenticationStore.getState();
      expect(error).toBeNull();
    });

    it('starts with loading false', () => {
      const { loading } = useAuthenticationStore.getState();
      expect(loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // checkSession
  // ---------------------------------------------------------------------------

  describe('checkSession', () => {
    it('sets authenticated=true when GET /auth/me succeeds', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ authenticated: true });

      await useAuthenticationStore.getState().checkSession();

      expect(useAuthenticationStore.getState().authenticated).toBe(true);
    });

    it('sets authenticated=false when GET /auth/me throws', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('API error 401'));

      // Pre-set to true to confirm it is reset
      useAuthenticationStore.setState({ authenticated: true });

      await useAuthenticationStore.getState().checkSession();

      expect(useAuthenticationStore.getState().authenticated).toBe(false);
    });

    it('calls GET /auth/me', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({});

      await useAuthenticationStore.getState().checkSession();

      expect(api.get).toHaveBeenCalledWith('/auth/me');
    });
  });

  // ---------------------------------------------------------------------------
  // login
  // ---------------------------------------------------------------------------

  describe('login', () => {
    it('sets authenticated=true on success', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ authenticated: true });

      await useAuthenticationStore.getState().login('correct-passphrase');

      expect(useAuthenticationStore.getState().authenticated).toBe(true);
    });

    it('sets loading=false after success', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({});

      await useAuthenticationStore.getState().login('pass');

      expect(useAuthenticationStore.getState().loading).toBe(false);
    });

    it('stores error message and re-throws on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('API error 401: Incorrect password'));

      await expect(
        useAuthenticationStore.getState().login('wrong')
      ).rejects.toThrow('API error 401');

      expect(useAuthenticationStore.getState().error).toMatch('API error 401');
      expect(useAuthenticationStore.getState().loading).toBe(false);
    });

    it('calls POST /auth/login with the password', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({});

      await useAuthenticationStore.getState().login('my-pass');

      expect(api.post).toHaveBeenCalledWith('/auth/login', { password: 'my-pass' });
    });
  });

  // ---------------------------------------------------------------------------
  // logout
  // ---------------------------------------------------------------------------

  describe('logout', () => {
    it('sets authenticated=false after logout', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({});
      useAuthenticationStore.setState({ authenticated: true });

      await useAuthenticationStore.getState().logout();

      expect(useAuthenticationStore.getState().authenticated).toBe(false);
    });

    it('still sets authenticated=false if POST /auth/logout throws', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Network error'));
      useAuthenticationStore.setState({ authenticated: true });

      // logout uses try/finally — the error propagates but state is always reset
      try {
        await useAuthenticationStore.getState().logout();
      } catch {
        // expected: the thrown error is intentionally swallowed here; we only
        // care that the state was still reset.
      }

      expect(useAuthenticationStore.getState().authenticated).toBe(false);
    });

    it('calls POST /auth/logout', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({});

      await useAuthenticationStore.getState().logout();

      expect(api.post).toHaveBeenCalledWith('/auth/logout', {});
    });
  });
});

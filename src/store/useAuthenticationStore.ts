import { create } from 'zustand';
import { api } from '@/service/api/apiClient';

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  checkSession: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const useAuthenticationStore = create<AuthState>((set) => ({
  authenticated: false,
  loading: false,
  error: null,

  checkSession: async () => {
    try {
      await api.get('/auth/me');
      set({ authenticated: true });
    } catch {
      set({ authenticated: false });
    }
  },

  login: async (password: string) => {
    set({ loading: true, error: null });
    try {
      await api.post('/auth/login', { password });
      set({ authenticated: true });
    } catch (err: any) {
      const message = String(err?.message || 'Sign in failed');
      if (message.includes('API error 401')) {
        set({ error: 'Incorrect passphrase. Please try again.' });
      } else if (message.toLowerCase().includes('timed out')) {
        set({ error: 'Login timed out. Backend may be starting up; try again in a few seconds.' });
      } else if (message.toLowerCase().includes('could not reach backend')) {
        set({ error: 'Backend is unreachable. Check Docker containers and network, then retry.' });
      } else {
        set({ error: message });
      }
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    set({ loading: true });
    try {
      await api.post('/auth/logout', {});
    } finally {
      set({ authenticated: false, loading: false });
    }
  },
}));

export default useAuthenticationStore;
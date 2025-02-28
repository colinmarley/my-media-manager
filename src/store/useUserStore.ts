import { create } from 'zustand';

interface UserState {
  user: string | null;
  loading: boolean;
  error: string | null;
  setUser: (user: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const useUserStore = create<UserState>((set) => ({
  user: null,
  loading: false,
  error: null,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));

export default useUserStore;
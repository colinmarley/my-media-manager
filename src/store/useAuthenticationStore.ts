import { create } from 'zustand';
import { auth } from '../../firebaseConfig';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, User } from 'firebase/auth';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const useAuthenticationStore = create<AuthState>((set: (arg0: { user?: any; loading?: any; error?: any; }) => void) => ({
  user: null,
  loading: false,
  error: null,
  setUser: (user: User | null) => set({ user }),
  setLoading: (loading: boolean) => set({ loading }),
  setError: (error: string | null) => set({ error }),
  login: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
      console.log(auth.currentUser);
      console.log(auth);
      set({ user: auth.currentUser });
    } catch (error: any) {
      set({ error: error.message });
      throw new Error(error.message, error.code);
    } finally {
      set({ loading: false });
    }
  },
  register: async (email, password) => {
    set({ loading: true, error: null });
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      set({ user: auth.currentUser });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ loading: false });
    }
  },
  logout: async () => {
    set({ loading: true, error: null });
    try {
      await signOut(auth);
      set({ user: null });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ loading: false });
    }
  },
}));

// Initialize auth state listener
onAuthStateChanged(auth, (user) => {
  useAuthenticationStore.getState().setUser(user);
});

export default useAuthenticationStore;
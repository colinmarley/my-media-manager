import { useState, useEffect } from 'react';
import { auth } from '../../firebaseConfig';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile, User } from 'firebase/auth';

interface FirebaseLoginError {
    code: string;
    message: string;
}

interface UseAuthenticationReturn {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserProfile: (profile: { displayName?: string; photoURL?: string }) => Promise<void>;
}

const useAuthentication = (): UseAuthenticationReturn => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: FirebaseLoginError | any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    setError(null);
    try {
      await signOut(auth);
    } catch (err: FirebaseLoginError | any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err: FirebaseLoginError | any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    setLoading(true);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err: FirebaseLoginError | any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateUserProfile = async (profile: { displayName?: string; photoURL?: string }) => {
    if (user) {
      setLoading(true);
      setError(null);
      try {
        await updateProfile(user, profile);
        setUser({ ...user, ...profile });
      } catch (err: FirebaseLoginError | any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  return {
    user,
    loading,
    error,
    login,
    logout,
    register,
    resetPassword,
    updateUserProfile,
  };
};

export default useAuthentication;
import { useRouter } from 'next/navigation';
import useAuthenticationStore from '../store/useAuthenticationStore';
import { AuthResponse } from '@toolpad/core/SignInPage';
import { resolve } from 'path';

const useAuth = () => {
  const router = useRouter();
  const { login, register, logout, setUser, setLoading, setError } = useAuthenticationStore();

  const handleLogin = async (
    email: string,
    password: string,
    callbackUrl?: string
  ): Promise<AuthResponse> => {
    setLoading(true);
    try {
      const response = await login(email, password); // Assume login returns AuthResponse
      if (callbackUrl && router) {
        router.push(callbackUrl);
      }
      return { success: response } as AuthResponse;
    } catch (err: any) {
      setError(err.message);
      return { error: err.message, type: err?.code } as AuthResponse;
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (email: string, password: string, callbackUrl?: string) => {
    setLoading(true);
    try {
      await register(email, password);
      if (callbackUrl && router) {
        router.push(callbackUrl);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await logout();
      setUser(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return {
    handleLogin,
    handleSignup,
    handleLogout,
  };
};

export default useAuth;
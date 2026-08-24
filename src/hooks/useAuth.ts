import { useRouter } from 'next/navigation';
import useAuthenticationStore from '../store/useAuthenticationStore';

const useAuth = () => {
  const router = useRouter();
  const { logout } = useAuthenticationStore();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return {
    handleLogout,
  };
};

export default useAuth;
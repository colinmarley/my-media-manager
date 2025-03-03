'use client';

import { useState } from 'react';
import { AuthProvider, SignInPage } from '@toolpad/core/SignInPage';
import useAuth from '../../hooks/useAuth';
import useAuthenticationStore from '../../store/useAuthenticationStore';

const Login = () => {
  const { handleLogin } = useAuth();
  const { loading, error } = useAuthenticationStore();
  const providers = [{ id: 'credentials', name: 'Email and Password' }];

  const handleSignIn = async (provider: AuthProvider, formData: FormData, callbackUrl?: string) => {
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const response = await handleLogin(email, password, callbackUrl);
    return response;
  };

  return (
    <div>
      <SignInPage
        signIn={handleSignIn}
        providers={providers}
        slotProps={{ emailField: { autoFocus: false } }}
      />
      {loading && <p>Loading...</p>}
      {error && <p>{error}</p>}
    </div>
  );
};

export default Login;
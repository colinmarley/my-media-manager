"use client";

import React, { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useAuthentication from '../../hooks/useAuthentication';
import useUserStore from '../../store/useUserStore';

const Login = () => {
  const router = useRouter();
  const { login } = useAuthentication();
  const { user, loading, error, setUser, setLoading, setError } = useUserStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      setUser(email);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={onLogin}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
        {error && <p>{error}</p>}
      </form>
      <Link href="/signup">Sign Up</Link>
    </div>
  );
};

export default Login;
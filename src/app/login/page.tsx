"use client";

import React, { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useAuthentication from '../../hooks/useAuthentication';

const Login = () => {
  const router = useRouter();
  const { login, user, loading, error } = useAuthentication();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    await login(email, password);
    if (user) {
      router.push('/dashboard');
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
      <Link href="/register">Register</Link>
    </div>
  );
};

export default Login;
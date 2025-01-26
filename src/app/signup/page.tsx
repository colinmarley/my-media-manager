"use client";

import React, { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useAuthentication from '../../hooks/useAuthentication';

const Signup = () => {
  const router = useRouter();
  const { register, user, loading, error } = useAuthentication();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await register(email, password);
    if (user) {
      router.push('/login');
    }
  };

  return (
    <div>
      <form onSubmit={onSubmit}>
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
          {loading ? 'Signing up...' : 'Sign Up'}
        </button>
        {error && <p>{error}</p>}
      </form>
      <Link href="/login">Already have an account? Login</Link>
    </div>
  );
};

export default Signup;
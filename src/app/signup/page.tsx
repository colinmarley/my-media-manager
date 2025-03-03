"use client";

import React, { FormEvent, useState } from 'react';
import Link from 'next/link';
import useAuth from '../../hooks/useAuth';
import useAuthenticationStore from '../../store/useAuthenticationStore';

const Signup = () => {
  const { handleSignup } = useAuth();
  const { loading, error } = useAuthenticationStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await handleSignup(email, password, '/login');
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
'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Button, TextField, Typography, Alert, CircularProgress } from '@mui/material';
import useAuthenticationStore from '@/store/useAuthenticationStore';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [backendReady, setBackendReady] = useState<boolean | null>(null);
  const [checkingBackend, setCheckingBackend] = useState(false);
  const { login, loading, error, authenticated } = useAuthenticationStore();
  const router = useRouter();

  // If the session is already valid (e.g. user navigated back to /login), go straight to the dashboard.
  useEffect(() => {
    if (authenticated) {
      router.replace('/dashboard');
    }
  }, [authenticated, router]);

  const checkBackend = async () => {
    setCheckingBackend(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('/api/backend/auth/me', { signal: controller.signal });
      clearTimeout(timeout);
      setBackendReady(res.status < 500);
    } catch {
      setBackendReady(false);
    } finally {
      setCheckingBackend(false);
    }
  };

  useEffect(() => {
    void checkBackend();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    try {
      await login(password);
      // Hard navigation, not router.push: the nav sidebar renders (and
      // prefetches) /dashboard and friends even while unauthenticated, so
      // Next's client router cache holds a stale "redirect to /login" entry
      // for them from before this login. router.push would reuse that stale
      // entry and never leave /login despite a valid session cookie.
      window.location.assign('/dashboard');
    } catch {
      // error is already in store
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
      }}
    >
      <Box
        component="form"
        onSubmit={onSubmit}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          width: '100%',
          maxWidth: 360,
          p: 4,
          borderRadius: 2,
          backgroundColor: '#3a3a3a',
        }}
      >
        <Typography variant="h5" textAlign="center">
          Media Manager
        </Typography>

        {backendReady === false && (
          <Alert
            severity="warning"
            action={
              <Button color="inherit" size="small" onClick={() => void checkBackend()} disabled={checkingBackend}>
                Retry
              </Button>
            }
          >
            Backend is not reachable right now. Make sure Docker services are running.
          </Alert>
        )}

        {backendReady === null && (
          <Alert severity="info">Checking backend availability...</Alert>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        <TextField
          type="password"
          label="Passphrase"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          fullWidth
          disabled={loading}
        />

        <Button
          type="submit"
          variant="contained"
          fullWidth
          disabled={loading || checkingBackend || backendReady === false || !password.trim()}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </Button>
      </Box>
    </Box>
  );
}
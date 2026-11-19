'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Button, Stack, TextField, Typography, Alert, CircularProgress } from '@mui/material';
import { VideoLibraryOutlined } from '@mui/icons-material';
import { accent, borders, radii, shadows, surfaces } from '@/theme/tokens';
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
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        px: 2,
        py: 6,
        // One soft light from above, so the card sits on something rather than floating in flat black.
        backgroundImage: `radial-gradient(ellipse 70% 50% at 50% 0%, ${accent.tint}, transparent 70%)`,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 380 }}>
        <Stack alignItems="center" spacing={1.5} sx={{ mb: 3, textAlign: 'center' }}>
          <Box
            aria-hidden
            sx={{
              width: 44, height: 44, borderRadius: '12px', display: 'grid', placeItems: 'center',
              bgcolor: accent.main, color: accent.contrastText, boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.22)',
            }}
          >
            <VideoLibraryOutlined sx={{ fontSize: 24 }} />
          </Box>
          <Box>
            <Typography variant="h3" component="h1">Media Manager</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Enter the passphrase to open your library.
            </Typography>
          </Box>
        </Stack>

        <Box
          component="form"
          onSubmit={onSubmit}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            p: 3,
            borderRadius: `${radii.lg}px`,
            bgcolor: surfaces.paper,
            border: `1px solid ${borders.default}`,
            boxShadow: shadows.dialog,
          }}
        >
          {backendReady === false && (
            <Alert
              severity="warning"
              action={
                <Button color="inherit" size="small" onClick={() => void checkBackend()} disabled={checkingBackend}>
                  Retry
                </Button>
              }
            >
              The server is not responding. Check that its Docker services are running.
            </Alert>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            type="password"
            label="Passphrase"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            fullWidth
            size="medium"
            autoComplete="current-password"
            disabled={loading}
          />

          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={loading || checkingBackend || backendReady === false || !password.trim()}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>
        </Box>

        <Typography
          variant="caption"
          color="text.disabled"
          role="status"
          sx={{ display: 'block', mt: 2, textAlign: 'center', minHeight: 16 }}
        >
          {backendReady === null ? 'Checking the server…' : ''}
        </Typography>
      </Box>
    </Box>
  );
}

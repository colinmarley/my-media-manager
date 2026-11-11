'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncResource<T> {
  data: T | null;
  error: string | null;
  /** True only until the first response (success or failure). */
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads one endpoint independently of the others on a page, so a failure
 * stays local to its section. Polls when `pollMs` is set and the tab is
 * visible; a failed poll keeps showing the last good data alongside the error.
 */
export default function useAsyncResource<T>(fetcher: () => Promise<T>, pollMs?: number): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await fetcherRef.current();
      if (!mounted.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error && err.message ? err.message : 'Request failed');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    if (!pollMs) return () => { mounted.current = false; };
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void reload();
    }, pollMs);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [reload, pollMs]);

  return { data, error, loading, reload };
}

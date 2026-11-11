'use client';

import { useEffect } from 'react';
import { create } from 'zustand';

import AttentionService, { isAttentionUnsupported } from '@/service/attention/AttentionService';
import type { AttentionSummary } from '@/types/attention/Attention.type';

export const ATTENTION_POLL_MS = 60_000;

export type AttentionSummaryStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';

interface AttentionSummaryState {
  summary: AttentionSummary | null;
  status: AttentionSummaryStatus;
  error: string | null;
  /** When the last successful response arrived (ms since epoch). */
  lastCheckedAt: number | null;
}

/**
 * One summary for the whole app: the sidebar badge, the Home tiles and the To-Do page all read
 * this store, so they share a single request and a single 60 s poll. The poll runs while at
 * least one component uses the hook and pauses while the tab is hidden.
 */
export const useAttentionSummaryStore = create<AttentionSummaryState>(() => ({
  summary: null,
  status: 'idle',
  error: null,
  lastCheckedAt: null,
}));

let inflight: Promise<void> | null = null;
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** Fetches the summary now; concurrent callers share the request in flight. */
export function refreshAttentionSummary(): Promise<void> {
  if (inflight) return inflight;
  const set = useAttentionSummaryStore.setState;
  if (useAttentionSummaryStore.getState().status === 'idle') set({ status: 'loading' });
  inflight = (async () => {
    try {
      const summary = await AttentionService.getSummary();
      set({ summary, status: 'ready', error: null, lastCheckedAt: Date.now() });
    } catch (error) {
      if (isAttentionUnsupported(error)) {
        set({ summary: null, status: 'unsupported', error: null });
      } else {
        // Keep showing the last good summary next to the error.
        set((state) => ({
          status: state.summary ? 'ready' : 'error',
          error: error instanceof Error && error.message ? error.message : 'Request failed',
        }));
      }
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const isStale = () => {
  const { lastCheckedAt, status } = useAttentionSummaryStore.getState();
  if (status === 'unsupported') return false;
  return lastCheckedAt === null || Date.now() - lastCheckedAt >= ATTENTION_POLL_MS;
};

const tick = () => {
  if (isHidden() || useAttentionSummaryStore.getState().status === 'unsupported') return;
  void refreshAttentionSummary();
};

const onVisibility = () => {
  if (!isHidden() && isStale()) void refreshAttentionSummary();
};

function subscribe(): () => void {
  subscribers += 1;
  if (subscribers === 1) {
    if (isStale() && !isHidden()) void refreshAttentionSummary();
    timer = setInterval(tick, ATTENTION_POLL_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  }
  return () => {
    subscribers -= 1;
    if (subscribers === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}

/** Test helper: forget the cached summary and stop polling. */
export function resetAttentionSummaryStore(): void {
  if (timer) clearInterval(timer);
  timer = null;
  subscribers = 0;
  inflight = null;
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  useAttentionSummaryStore.setState({ summary: null, status: 'idle', error: null, lastCheckedAt: null });
}

export interface UseAttentionSummary extends AttentionSummaryState {
  /** The badge count; 0 while loading or unsupported. */
  total: number;
  unsupported: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

export default function useAttentionSummary(): UseAttentionSummary {
  const state = useAttentionSummaryStore();
  useEffect(() => subscribe(), []);
  return {
    ...state,
    total: state.status === 'ready' ? state.summary?.total ?? 0 : 0,
    unsupported: state.status === 'unsupported',
    loading: state.status === 'idle' || state.status === 'loading',
    refresh: refreshAttentionSummary,
  };
}

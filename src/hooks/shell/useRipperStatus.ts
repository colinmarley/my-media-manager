'use client';

import { useEffect, useState } from 'react';
import { DiscRipperService, type RipJob } from '@/service/disc-ripper/DiscRipperService';
import type { StatusTone } from '@/theme/tokens';

export const RIPPER_POLL_MS = 10_000;

export interface RipperStatus {
  tone: StatusTone;
  label: string;
}

/** Failed beats busy beats idle. Unknown when the ripper can't be reached. */
export function ripperStatusFromJobs(jobs: RipJob[] | null): RipperStatus {
  if (jobs === null) return { tone: 'neutral', label: 'Ripper status unavailable' };
  if (jobs.some((j) => j.status === 'failed')) return { tone: 'error', label: 'A rip job failed' };
  if (jobs.some((j) => ['queued', 'ripping', 'delivering'].includes(j.status))) return { tone: 'warning', label: 'Ripping' };
  return { tone: 'success', label: 'Ripper idle' };
}

/** Polls the disc ripper's job list every 10 s while the tab is visible. */
export default function useRipperStatus(enabled = true): RipperStatus {
  const [jobs, setJobs] = useState<RipJob[] | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      Promise.resolve()
        .then(() => DiscRipperService.listJobs())
        .then((next) => { if (!cancelled) setJobs(next); })
        .catch(() => { if (!cancelled) setJobs(null); });
    };
    load();
    const interval = setInterval(load, RIPPER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return ripperStatusFromJobs(jobs);
}

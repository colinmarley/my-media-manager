'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Stack } from '@mui/material';
import { DiscRipperService } from '@/service/disc-ripper/DiscRipperService';
import type { RipJob, RipTitleRecord } from '@/types/disc-ripper/DiscRipper.type';
import { ripTitleProblems, syncStatus } from './discRipperUtils';

/**
 * What went less than perfectly on a finished rip: titles that failed or had
 * disc read errors, and whether the rip record reached the library.
 * Renders nothing for a clean, synced job (or a ripper build without these).
 */
export default function RipJobHealth({ job }: { job: RipJob }) {
  const [titles, setTitles] = useState<RipTitleRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    setTitles([]);
    DiscRipperService.getJobTitles(job.id).then((rows) => { if (!cancelled) setTitles(rows); });
    return () => { cancelled = true; };
  }, [job.id, job.status]);

  const problems = ripTitleProblems(titles);
  const sync = syncStatus(job);
  if (!problems.length && (!sync || sync.severity === 'success')) return null;

  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      {problems.length > 0 && (
        <Alert severity="warning">
          <strong>Check these titles before filing them:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </Alert>
      )}
      {sync && sync.severity !== 'success' && (
        <Alert severity={sync.severity}>
          {sync.label}
          {sync.detail ? `: ${sync.detail}` : ''}
        </Alert>
      )}
    </Stack>
  );
}

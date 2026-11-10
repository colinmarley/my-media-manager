'use client';

import React from 'react';
import { Alert } from '@mui/material';
import { HealthAndSafety } from '@mui/icons-material';
import type {
  IngressQueueStatus,
  IngressWatcherStatus,
} from '@/service/ingress/IngressAutomationService';
import { getIngressBacklog, getIngressHealthFlags } from '@/service/ingress/ingressQueueModel';

type Props = {
  error: string | null;
  statusMessage: string | null;
  watcher: IngressWatcherStatus | null;
  queueStatus: IngressQueueStatus | null;
  health: Record<string, any> | null;
};

const IngressStatusAlerts: React.FC<Props> = ({ error, statusMessage, watcher, queueStatus, health }) => {
  const { ingressPathsHealthy, destHealthy } = getIngressHealthFlags(health);
  const { pending, needsReview, backlog } = getIngressBacklog(queueStatus);

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {statusMessage && (
        <Alert severity={watcher?.initial_queue?.last_error ? 'warning' : 'info'} sx={{ mb: 2 }}>
          {statusMessage}
        </Alert>
      )}

      {(!ingressPathsHealthy || !destHealthy) && (
        <Alert severity="warning" icon={<HealthAndSafety />} sx={{ mb: 2 }}>
          {!ingressPathsHealthy && 'One or more ingress paths are not accessible. '}
          {!destHealthy && 'Destination mount is not accessible — file organization will fail.'}
        </Alert>
      )}

      {(() => {
        if (backlog > 0 && !watcher?.is_running) {
          return (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>{backlog} file{backlog !== 1 ? 's' : ''} waiting</strong>
              {needsReview > 0 && ` (${needsReview} need manual review)`} — watcher is stopped.
              Start the watcher below to resume processing.
            </Alert>
          );
        }
        if (backlog > 0 && watcher?.is_running) {
          return (
            <Alert severity="info" sx={{ mb: 2 }}>
              {pending > 0 && <><strong>{pending}</strong> file{pending !== 1 ? 's' : ''} pending processing. </>}
              {needsReview > 0 && <><strong>{needsReview}</strong> file{needsReview !== 1 ? 's' : ''} need manual review.</>}
            </Alert>
          );
        }
        return null;
      })()}

      <Alert severity="info" sx={{ mb: 3 }}>
        High-confidence matches are auto-assigned and organized. Items below threshold appear as
        &ldquo;needs_review&rdquo; for manual action here.
      </Alert>
    </>
  );
};

export default IngressStatusAlerts;

'use client';

import React from 'react';
import { Box, Card, CardContent, Chip, Grid, Typography } from '@mui/material';
import type {
  IngressQueueStatus,
  IngressWatcherStatus,
} from '@/service/ingress/IngressAutomationService';
import { STATUS_COLORS } from '@/service/ingress/ingressQueueModel';
import StatusChip, { resolveStatus } from '@/components/ui/StatusChip';

type Props = {
  watcher: IngressWatcherStatus | null;
  queueStatus: IngressQueueStatus | null;
  health: Record<string, any> | null;
};

const IngressStatusSummary: React.FC<Props> = ({ watcher, queueStatus, health }) => (
  <Grid container spacing={2} sx={{ mb: 3 }}>
    <Grid size={{ xs: 12, md: 4 }}>
      <Card>
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary">Watcher</Typography>
          <StatusChip status={watcher?.is_running ? 'running' : 'stopped'} sx={{ mt: 1 }} />
          <Typography sx={{ mt: 1 }} variant="body2">
            Watching {watcher?.watched_paths?.length || 0} folder{(watcher?.watched_paths?.length || 0) === 1 ? '' : 's'}
          </Typography>
        </CardContent>
      </Card>
    </Grid>
    <Grid size={{ xs: 12, md: 4 }}>
      <Card>
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary">Queue</Typography>
          <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {Object.entries(queueStatus?.counts || {})
              .filter(([, count]) => (count as number) > 0)
              .map(([status, count]) => (
                <StatusChip key={status} status={status} label={`${resolveStatus(status).label}: ${count}`} />
              ))}
            {!queueStatus?.total && (
              <Typography variant="body2" color="text.secondary">Empty</Typography>
            )}
          </Box>
        </CardContent>
      </Card>
    </Grid>
    <Grid size={{ xs: 12, md: 4 }}>
      <Card>
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary">Paths</Typography>
          {health?.ingress_paths?.map((p: any) => (
            <Box key={p.path} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
              <StatusChip status={p.exists ? 'success' : 'error'} label={p.exists ? 'OK' : 'Missing'} />
              <Typography variant="caption" noWrap title={p.path}>{p.path}</Typography>
            </Box>
          )) || (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Health not loaded
            </Typography>
          )}
        </CardContent>
      </Card>
    </Grid>
  </Grid>
);

export default IngressStatusSummary;

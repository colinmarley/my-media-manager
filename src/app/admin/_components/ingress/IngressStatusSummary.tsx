'use client';

import React from 'react';
import { Box, Card, CardContent, Chip, Grid, Typography } from '@mui/material';
import type {
  IngressQueueStatus,
  IngressWatcherStatus,
} from '@/service/ingress/IngressAutomationService';
import { STATUS_COLORS } from '@/service/ingress/ingressQueueModel';

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
          <Chip
            label={watcher?.is_running ? 'Running' : 'Stopped'}
            color={watcher?.is_running ? 'success' : 'default'}
            size="small"
            sx={{ mt: 1 }}
          />
          <Typography sx={{ mt: 1 }} variant="body2">
            Watching {watcher?.watched_paths?.length || 0} path(s)
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
                <Chip
                  key={status}
                  label={`${status}: ${count}`}
                  size="small"
                  color={STATUS_COLORS[status] || 'default'}
                />
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
              <Chip
                label={p.exists ? 'OK' : 'Missing'}
                color={p.exists ? 'success' : 'error'}
                size="small"
              />
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

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Alert, Box, Button, CircularProgress, Grid, Stack, Typography } from '@mui/material';
import { PlayArrow, Stop, PlaylistPlay } from '@mui/icons-material';
import IngressAutomationService from '@/service/ingress/IngressAutomationService';
import LibraryComplianceService from '@/service/library/LibraryComplianceService';
import { getCatalogStats } from '@/service/catalog/CatalogStatsService';
import {
  buildComplianceTile,
  buildLibraryTiles,
  buildPipelineStages,
  summarizeQueue,
  summarizeWatcher,
  type LibraryTile,
} from '@/service/home/homeOverviewModel';
import useAsyncResource from '@/hooks/home/useAsyncResource';
import { useNotify } from '@/context/NotificationContext';
import { PageContainer, PageHeader } from '@/components/ui/PageHeader';
import StatTile from '@/components/ui/StatTile';
import StatusChip from '@/components/ui/StatusChip';
import PipelineStrip from './PipelineStrip';
import SectionError from './SectionError';

export const REVIEW_QUEUE_HREF = '/ingress-automation';
const PIPELINE_POLL_MS = 15_000;

export interface HomeOverviewProps {
  /**
   * To-Do tiles, rendered above the library section when provided. A later
   * PR fills this from /api/attention/summary; nothing calls it yet.
   */
  todoSlot?: React.ReactNode;
}

function SectionTitle({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between" sx={{ mb: 1.5 }}>
      <Typography id={id} variant="h4" component="h2">{children}</Typography>
      {aside}
    </Stack>
  );
}

function TileGrid({ tiles, loading, count }: { tiles: LibraryTile[]; loading: boolean; count: number }) {
  const items = loading ? Array.from({ length: count }, (_, i) => ({ id: `s${i}`, label: '', value: null }) as unknown as LibraryTile) : tiles;
  return (
    <>
      {items.map((tile) => (
        <Grid key={tile.id} size={{ xs: 6, sm: 4, lg: 2 }}>
          <StatTile
            label={tile.label}
            value={tile.value === null ? null : tile.value.toLocaleString()}
            detail={tile.detail}
            tone={tile.tone}
            href={tile.href}
            loading={loading}
          />
        </Grid>
      ))}
    </>
  );
}

const HomeOverview: React.FC<HomeOverviewProps> = ({ todoSlot }) => {
  const notify = useNotify();
  const queue = useAsyncResource(() => IngressAutomationService.getQueueStatus(), PIPELINE_POLL_MS);
  const watcher = useAsyncResource(() => IngressAutomationService.getWatcherStatus(), PIPELINE_POLL_MS);
  const stats = useAsyncResource(() => getCatalogStats());
  const compliance = useAsyncResource(() => LibraryComplianceService.getSummary());
  const [busy, setBusy] = useState<'watcher' | 'process' | null>(null);

  const stages = buildPipelineStages(queue.data, stats.data);
  const queueSummary = summarizeQueue(queue.data);
  const watcherSummary = summarizeWatcher(watcher.data);
  const complianceTile = buildComplianceTile(compliance.data);

  const toggleWatcher = async () => {
    if (!watcherSummary) return;
    setBusy('watcher');
    try {
      if (watcherSummary.running) {
        await IngressAutomationService.stopWatcher();
        notify('Watcher stopped.', 'success');
      } else {
        // No paths: the backend falls back to its configured ingest folders.
        await IngressAutomationService.startWatcher();
        notify('Watcher started.', 'success');
      }
      await Promise.all([watcher.reload(), queue.reload()]);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not change the watcher.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const processPending = async () => {
    setBusy('process');
    try {
      const processed = await IngressAutomationService.processPending();
      notify(processed ? `Processed ${processed} pending file${processed === 1 ? '' : 's'}.` : 'Nothing was waiting to be processed.', 'success');
      await queue.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not process pending files.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const watcherStatus = watcher.loading ? null : watcherSummary ? (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
      <StatusChip status={watcherSummary.status} label={watcherSummary.running ? 'Watcher running' : 'Watcher stopped'} />
      <Typography variant="body2" color="text.secondary">
        {watcherSummary.initialScan
          ?? (watcherSummary.watchedPaths.length
            ? `Watching ${watcherSummary.watchedPaths.length} folder${watcherSummary.watchedPaths.length === 1 ? '' : 's'}`
            : 'No folders watched')}
      </Typography>
    </Stack>
  ) : (
    <StatusChip status="neutral" label="Watcher status unavailable" />
  );

  const actions = (
    <>
      <Button
        variant="outlined"
        onClick={toggleWatcher}
        disabled={!watcherSummary || busy !== null}
        startIcon={busy === 'watcher' ? <CircularProgress size={14} color="inherit" /> : watcherSummary?.running ? <Stop /> : <PlayArrow />}
      >
        {watcherSummary?.running ? 'Stop watcher' : 'Start watcher'}
      </Button>
      <Button
        variant="outlined"
        onClick={processPending}
        disabled={busy !== null || !queueSummary?.pendingToProcess}
        startIcon={busy === 'process' ? <CircularProgress size={14} color="inherit" /> : <PlaylistPlay />}
      >
        Process pending
      </Button>
      <Button variant="contained" component={Link} href={REVIEW_QUEUE_HREF}>
        Open review queue
      </Button>
    </>
  );

  return (
    <PageContainer>
      <PageHeader title="Home" subtitle="Files moving through ingest, and what is already in your library." />

      <Box component="section" aria-labelledby="home-pipeline" sx={{ mb: 4 }}>
        <SectionTitle id="home-pipeline" aside={<Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>{actions}</Stack>}>
          Ingest
        </SectionTitle>
        <Box sx={{ mb: 1.5 }}>{watcherStatus}</Box>
        {watcher.error && <SectionError what="Watcher status" message={watcher.error} onRetry={() => void watcher.reload()} />}
        {watcherSummary?.lastError && <Alert severity="warning" sx={{ mb: 2 }}>Last scan error: {watcherSummary.lastError}</Alert>}
        {queue.error && <SectionError what="Queue counts" message={queue.error} onRetry={() => void queue.reload()} />}
        {queueSummary && queueSummary.failed > 0 && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={<Button color="inherit" size="small" component={Link} href={REVIEW_QUEUE_HREF}>Review failures</Button>}
          >
            {queueSummary.failed.toLocaleString()} file{queueSummary.failed === 1 ? '' : 's'} failed to ingest.
          </Alert>
        )}
        <PipelineStrip stages={stages} loading={queue.loading} reviewHref={REVIEW_QUEUE_HREF} />
      </Box>

      {todoSlot && (
        <Box component="section" aria-labelledby="home-todo" sx={{ mb: 4 }}>
          <SectionTitle id="home-todo">To-Do</SectionTitle>
          {todoSlot}
        </Box>
      )}

      <Box component="section" aria-labelledby="home-library">
        <SectionTitle id="home-library">Library</SectionTitle>
        {stats.error && <SectionError what="Library totals" message={stats.error} onRetry={() => void stats.reload()} />}
        {compliance.error && <SectionError what="Compliance summary" message={compliance.error} onRetry={() => void compliance.reload()} />}
        <Grid container spacing={2}>
          {!stats.error && <TileGrid tiles={buildLibraryTiles(stats.data)} loading={stats.loading} count={5} />}
          {!compliance.error && <TileGrid tiles={complianceTile ? [complianceTile] : []} loading={compliance.loading} count={1} />}
        </Grid>
      </Box>
    </PageContainer>
  );
};

export default HomeOverview;

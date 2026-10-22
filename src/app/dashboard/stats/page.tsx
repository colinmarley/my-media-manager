'use client';

/**
 * /dashboard/stats — the web counterpart of the mobile app's stats screen.
 *
 * One call to GET /api/catalog/stats does the counting (see
 * backend/api/catalog.py + services/catalog_stats.py); this page only lays
 * out what it returns. Charts are plain width-scaled bars rather than a
 * charting dependency: the data is a handful of labelled counts, and a bar
 * is legible, printable and screen-reader friendly with a little markup.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Grid, Paper, Stack, Typography } from '@mui/material';
import { getCatalogStats } from '@/service/catalog/CatalogStatsService';
import {
  CatalogStats,
  CatalogStatsBucket,
  CatalogStatsItemType,
} from '@/types/catalog/CatalogStats.type';

const TYPE_LABELS: Record<CatalogStatsItemType, string> = {
  movie: 'Movies',
  series: 'Series',
  disc: 'Discs',
  tape: 'Tapes',
};

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

const StatTile = ({ label, value, caption }: { label: string; value: number; caption?: string }) => (
  <Grid size={{ xs: 6, sm: 4, md: 3 }}>
    <Paper variant="outlined" sx={Styles.tile}>
      <Typography variant="h4" data-testid={`tile-${label}`}>{value}</Typography>
      <Typography variant="body2">{label}</Typography>
      {caption && <Typography variant="caption" color="text.secondary">{caption}</Typography>}
    </Paper>
  </Grid>
);

/** Horizontal bar chart: one row per bucket, bars scaled to the largest one. */
export const StatsBarChart = ({
  title,
  buckets,
  emptyLabel = 'Nothing here yet.',
}: {
  title: string;
  buckets: CatalogStatsBucket[];
  emptyLabel?: string;
}) => {
  const largest = Math.max(1, ...buckets.map((bucket) => bucket.count));

  return (
    <Paper variant="outlined" sx={Styles.panel}>
      <Typography variant="subtitle1" sx={{ mb: 1.5 }}>{title}</Typography>
      {buckets.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{emptyLabel}</Typography>
      ) : (
        <Stack spacing={1.25}>
          {buckets.map((bucket) => (
            <Box key={bucket.label}>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2">{bucket.label}</Typography>
                <Typography variant="body2" color="text.secondary">{bucket.count}</Typography>
              </Stack>
              <Box sx={Styles.track}>
                <Box
                  role="progressbar"
                  aria-label={`${bucket.label}: ${bucket.count}`}
                  aria-valuenow={bucket.count}
                  aria-valuemin={0}
                  aria-valuemax={largest}
                  sx={{ ...Styles.bar, width: `${(bucket.count / largest) * 100}%` }}
                />
              </Box>
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
};

const StatsList = ({
  title,
  emptyLabel,
  items,
}: {
  title: string;
  emptyLabel: string;
  items: { key: string; primary: string; secondary: string }[];
}) => (
  <Paper variant="outlined" sx={Styles.panel}>
    <Typography variant="subtitle1" sx={{ mb: 1.5 }}>{title}</Typography>
    {items.length === 0 ? (
      <Typography variant="body2" color="text.secondary">{emptyLabel}</Typography>
    ) : (
      <Stack spacing={1}>
        {items.map((item) => (
          <Stack key={item.key} direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="body2" noWrap>{item.primary}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {item.secondary}
            </Typography>
          </Stack>
        ))}
      </Stack>
    )}
  </Paper>
);

const StatsPage = () => {
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await getCatalogStats());
    } catch (e: any) {
      setError(e?.message || 'Unable to load catalog stats.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !stats) {
    return (
      <Box sx={Styles.page}>
        <Typography variant="h4" sx={{ mb: 3 }}>Stats</Typography>
        <CircularProgress aria-label="Loading catalog stats" />
      </Box>
    );
  }

  if (error || !stats) {
    return (
      <Box sx={Styles.page}>
        <Typography variant="h4" sx={{ mb: 3 }}>Stats</Typography>
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}
        >
          {error || 'Unable to load catalog stats.'}
        </Alert>
      </Box>
    );
  }

  const typeBuckets: CatalogStatsBucket[] = (Object.keys(TYPE_LABELS) as CatalogStatsItemType[])
    .map((type) => ({ label: TYPE_LABELS[type], count: stats.byType[type] ?? 0 }))
    .filter((bucket) => bucket.count > 0);

  return (
    <Box sx={Styles.page}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }} spacing={2}>
        <Box>
          <Typography variant="h4">Stats</Typography>
          <Typography variant="body2" color="text.secondary">
            {`Counted on the server from ${stats.totalItems} catalog records on ${formatDay(stats.generatedAt)}.`}
          </Typography>
        </Box>
        <Button variant="outlined" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <StatTile label="Total items" value={stats.totalItems} />
        <StatTile label="Movies" value={stats.byType.movie ?? 0} />
        <StatTile label="Series" value={stats.byType.series ?? 0} />
        <StatTile label="Discs" value={stats.byType.disc ?? 0} />
        <StatTile label="Tapes" value={stats.byType.tape ?? 0} />
        <StatTile
          label="Lent out"
          value={stats.lentOut.count}
          caption={stats.lentOut.count ? 'Out on loan right now' : 'Everything is home'}
        />
        <StatTile
          label="Without a location"
          value={stats.storage.withoutLocation}
          caption={`${stats.storage.withLocation} of ${stats.storage.total} discs/tapes filed`}
        />
        <StatTile
          label={`Added in ${stats.recentDays} days`}
          value={stats.recentlyAdded.count}
          caption="Newest first below"
        />
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}><StatsBarChart title="By type" buckets={typeBuckets} /></Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatsBarChart title="By disc format" buckets={stats.byDiscFormat} emptyLabel="No discs catalogued." />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatsBarChart
            title="By release decade"
            buckets={stats.byDecade}
            emptyLabel="No release years to group."
          />
          {stats.undated > 0 && (
            <Typography variant="caption" color="text.secondary">
              {`${stats.undated} record(s) have no release year.`}
            </Typography>
          )}
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatsBarChart title="Storage locations" buckets={stats.storage.byType} emptyLabel="Nothing filed into a box or binder yet." />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatsList
            title={`Recently added (${stats.recentlyAdded.count})`}
            emptyLabel={`Nothing added in the last ${stats.recentDays} days.`}
            items={stats.recentlyAdded.items.map((item) => ({
              key: `${item.type}-${item.id}`,
              primary: item.title,
              secondary: `${TYPE_LABELS[item.type] ?? item.type} · ${formatDay(item.createdAt)}`,
            }))}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <StatsList
            title={`Lent out (${stats.lentOut.count})`}
            emptyLabel="Nothing is on loan."
            items={stats.lentOut.items.map((item) => ({
              key: `${item.type}-${item.id}`,
              primary: item.title,
              secondary: `with ${item.borrower}`,
            }))}
          />
        </Grid>
      </Grid>
    </Box>
  );
};

const Styles = {
  page: { p: 3 },
  tile: { p: 2 },
  panel: { p: 2, height: '100%', boxSizing: 'border-box' },
  track: {
    mt: 0.5,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'action.hover',
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: 'primary.main',
    transition: 'width 0.3s ease-in-out',
  },
};

export default StatsPage;

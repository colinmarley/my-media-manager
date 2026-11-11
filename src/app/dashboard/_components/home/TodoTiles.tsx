'use client';

import React from 'react';
import Link from 'next/link';
import { Box, Button, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { TaskAltOutlined } from '@mui/icons-material';

import useAttentionSummary from '@/hooks/attention/useAttentionSummary';
import { kindsWithItems, todoHref } from '@/service/attention/attentionModel';
import { status as statusColors } from '@/theme/tokens';
import SectionError from './SectionError';

/**
 * Home's To-Do row: one compact link per kind that has items ("12 Needs renaming"), or an
 * "All organized" line. Reads the shared attention summary (no request of its own).
 */
const TodoTiles: React.FC = () => {
  const { summary, loading, error, refresh } = useAttentionSummary();

  if (loading && !summary) {
    return (
      <Stack direction="row" spacing={1.5} aria-label="Loading To-Do counts">
        {[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" width={160} height={64} />)}
      </Stack>
    );
  }
  if (!summary) {
    return error ? <SectionError what="To-Do counts" message={error} onRetry={() => void refresh()} /> : null;
  }

  const kinds = kindsWithItems(summary.counts);
  if (kinds.length === 0) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" role="status" sx={{ color: statusColors.success.fg }}>
        <TaskAltOutlined fontSize="small" />
        <Typography variant="body2">All organized. Nothing needs your attention.</Typography>
      </Stack>
    );
  }

  return (
    <Box>
      <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1.5} component="ul" aria-label="To-Do by category" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {kinds.map((entry) => {
          const Icon = entry.icon;
          return (
            <Box component="li" key={entry.kind}>
              <Paper
                variant="outlined"
                component={Link}
                href={todoHref({ kind: entry.kind })}
                data-kind={entry.kind}
                aria-label={`${entry.count.toLocaleString()} ${entry.label}`}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.25, px: 1.75, py: 1.25, minWidth: 150,
                  textDecoration: 'none', color: 'inherit',
                  '&:hover': { borderColor: 'text.disabled' },
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                }}
              >
                <Icon fontSize="small" sx={{ color: statusColors[entry.tone].fg }} />
                <Box>
                  <Typography variant="h5" component="p" sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                    {entry.count.toLocaleString()}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">{entry.label}</Typography>
                </Box>
              </Paper>
            </Box>
          );
        })}
      </Stack>
      <Button component={Link} href={todoHref()} size="small" sx={{ mt: 1 }}>Open To-Do</Button>
    </Box>
  );
};

export default TodoTiles;

'use client';
import React from 'react';
import { Alert, Box, Button, Chip, Divider, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { Edit as EditIcon, CheckCircle as ReadyIcon } from '@mui/icons-material';
import { useTapeIngestStore } from '@/store/useTapeIngestStore';
import { TapeIngestItem } from '@/types/tape-ingest/TapeIngest.type';
import { buildDestinationPreview } from './destinationUtils';

interface Props { onEdit: (fileIndex: number) => void; onContinue: () => void; }

const LABELS: Record<string, string> = {
  movie: 'Movie', home_video: 'Home Video', tv_show: 'TV Show',
  trailer: 'Trailer', commercial: 'Commercial', skip: 'Skip', unclassified: 'Unclassified',
};

function getAssignedTitle(item: TapeIngestItem): string {
  if (item.contentType === 'movie' && item.movieMetadata) return `${item.movieMetadata.title} (${item.movieMetadata.year})`;
  if (item.contentType === 'tv_show' && item.tvShowMetadata) {
    const { seriesTitle, seasonNumber, episodeNumber } = item.tvShowMetadata;
    return `${seriesTitle} S${String(seasonNumber).padStart(2,'0')}E${String(episodeNumber).padStart(2,'0')}`;
  }
  if (item.contentType === 'home_video' && item.homeVideoMetadata) return item.homeVideoMetadata.title || '(untitled)';
  if ((item.contentType === 'trailer' || item.contentType === 'commercial') && item.promoMetadata)
    return `${item.promoMetadata.title} (${item.promoMetadata.targetName})`;
  return '—';
}

function getTapeDetailSummary(item: TapeIngestItem): string {
  return [
    item.tapeBrand && item.tapeBrand !== 'Unknown' ? item.tapeBrand : null,
    item.tapeCondition && item.tapeCondition !== 'unknown' ? item.tapeCondition : null,
    item.recordingSpeed && item.recordingSpeed !== 'unknown' ? item.recordingSpeed.toUpperCase() : null,
    item.labelNotes || null,
  ].filter(Boolean).join(' · ') || '—';
}

export default function TapeSessionPreview({ onEdit, onContinue }: Props) {
  const { items, tapeType, destinationBase } = useTapeIngestStore();
  const unclassifiedCount = items.filter((i) => i.contentType === 'unclassified').length;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Review Before Processing</Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>Session</Typography>
        <Typography variant="body2">
          <strong>Tape type:</strong> {tapeType.toUpperCase().replace('_', '-')}
          &nbsp;·&nbsp;Tape details (brand, condition, speed, label) are set per-file — see the Tape column below.
        </Typography>
      </Paper>

      {unclassifiedCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {unclassifiedCount} file{unclassifiedCount !== 1 ? 's are' : ' is'} still unclassified and will be moved to <code>_NeedsReview</code>.
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>File</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Assigned Title</TableCell>
              <TableCell>Tape Details</TableCell>
              <TableCell>Destination</TableCell>
              <TableCell padding="checkbox" />
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item, idx) => (
              <TableRow key={item.filePath}>
                <TableCell>
                  <Typography variant="caption" noWrap sx={{ maxWidth: 180, display: 'block' }}>{item.fileName}</Typography>
                </TableCell>
                <TableCell>
                  <Chip label={LABELS[item.contentType] ?? item.contentType} size="small"
                    color={item.contentType === 'skip' ? 'warning' : item.contentType === 'unclassified' ? 'default' : 'primary'} variant="outlined" />
                </TableCell>
                <TableCell>
                  <Typography variant="caption">{getAssignedTitle(item)}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">{getTapeDetailSummary(item)}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', maxWidth: 240, display: 'block' }}>
                    {buildDestinationPreview(item, destinationBase) ?? '—'}
                  </Typography>
                </TableCell>
                <TableCell padding="checkbox">
                  <Button size="small" startIcon={<EditIcon />} onClick={() => onEdit(idx)}>Edit</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Divider sx={{ mb: 2 }} />
      <Button variant="contained" size="large" startIcon={<ReadyIcon />} onClick={onContinue}>
        Looks Good — Continue to Process
      </Button>
    </Box>
  );
}

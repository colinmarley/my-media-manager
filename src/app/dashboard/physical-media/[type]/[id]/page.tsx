'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Alert, Box, Chip, CircularProgress, Divider, Paper, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { api } from '@/service/api/apiClient';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { CatalogTape } from '@/types/catalog/Tape.type';

interface LinkedMediaFile {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  detectedMediaType: string | null;
  assignmentStatus: string | null;
  targetPath: string | null;
  organizationStatus: string | null;
  createdAt: string | null;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  const gb = bytes / 1_073_741_824;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_048_576).toFixed(0)} MB`;
}

export default function PhysicalMediaDetailPage() {
  const params = useParams<{ type: string; id: string }>();
  const mediaKind = params.type === 'tapes' ? 'tapes' : 'discs';
  const id = params.id;

  const [item, setItem] = useState<CatalogDisc | CatalogTape | null>(null);
  const [files, setFiles] = useState<LinkedMediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      api.get<CatalogDisc | CatalogTape>(`/api/catalog/${mediaKind}/${id}`),
      api.get<LinkedMediaFile[]>(`/api/catalog/${mediaKind}/${id}/files`),
    ])
      .then(([itemData, filesData]) => {
        if (cancelled) return;
        setItem(itemData);
        setFiles(filesData);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [mediaKind, id]);

  if (loading) return <Box sx={{ p: 3 }}><CircularProgress size={24} /></Box>;
  if (error) return <Box sx={{ p: 3 }}><Alert severity="error">{error}</Alert></Box>;
  if (!item) return <Box sx={{ p: 3 }}><Alert severity="warning">Not found</Alert></Box>;

  const isTape = mediaKind === 'tapes';
  const tape = isTape ? (item as CatalogTape) : null;
  const disc = !isTape ? (item as CatalogDisc) : null;

  return (
    <Box sx={{ p: 3, maxWidth: 900 }}>
      <Typography variant="h4" sx={{ mb: 0.5 }}>{item.title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {isTape ? 'Physical tape' : 'Physical disc'}
      </Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Details</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {disc && disc.format && <Chip label={`Format: ${disc.format}`} size="small" variant="outlined" />}
          {disc && disc.regionCode && <Chip label={`Region: ${disc.regionCode}`} size="small" variant="outlined" />}
          {disc && disc.condition && <Chip label={`Condition: ${disc.condition}`} size="small" variant="outlined" />}
          {disc && disc.barcode && <Chip label={`Barcode: ${disc.barcode}`} size="small" variant="outlined" />}
          {disc && disc.isPartOfSet && <Chip label="Part of a set" size="small" color="info" variant="outlined" />}
          {disc && disc.isRentalDisc && <Chip label="Rental disc" size="small" color="warning" variant="outlined" />}

          {tape && tape.tapeType && <Chip label={`Type: ${tape.tapeType.toUpperCase()}`} size="small" variant="outlined" />}
          {tape && tape.tapeLabel && <Chip label={`Label: ${tape.tapeLabel}`} size="small" variant="outlined" />}
          {tape && tape.brand && <Chip label={`Brand: ${tape.brand}`} size="small" variant="outlined" />}
          {tape && tape.condition && <Chip label={`Condition: ${tape.condition}`} size="small" variant="outlined" />}
          {tape && tape.recordingSpeed && <Chip label={`Speed: ${tape.recordingSpeed.toUpperCase()}`} size="small" variant="outlined" />}
        </Stack>
        {tape?.labelNotes && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="body2" color="text.secondary">{tape.labelNotes}</Typography>
          </>
        )}
      </Paper>

      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
        Files from this {isTape ? 'tape' : 'disc'} ({files.length})
      </Typography>

      {files.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No files linked yet. Files get linked automatically when ripped/digitized with this
          {isTape ? ' tape' : ' disc'} selected, or you can link existing files manually from the library browser.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>File</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {files.map((f) => (
                <TableRow key={f.id} hover>
                  <TableCell>
                    <Typography variant="body2">{f.fileName}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                      {f.targetPath ?? f.filePath}
                    </Typography>
                  </TableCell>
                  <TableCell>{f.detectedMediaType ?? '—'}</TableCell>
                  <TableCell>{formatBytes(f.fileSize)}</TableCell>
                  <TableCell>
                    <Chip
                      label={f.organizationStatus ?? f.assignmentStatus ?? 'unknown'}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

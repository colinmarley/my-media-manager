'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, IconButton, Paper, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import AddLinkIcon from '@mui/icons-material/AddLink';
import { api } from '@/service/api/apiClient';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { CatalogTape } from '@/types/catalog/Tape.type';
import { deleteDisc } from '@/service/catalog/DiscCatalogService';
import { deleteTape } from '@/service/catalog/TapeCatalogService';
import { disconnectFile, LinkedMediaFile } from '@/service/catalog/MediaFileLinkService';
import DiscEditDialog from '../../_components/DiscEditDialog';
import TapeEditDialog from '../../_components/TapeEditDialog';
import ConfirmDeleteDialog from '../../_components/ConfirmDeleteDialog';
import ConnectFileDialog from '../../_components/ConnectFileDialog';

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  const gb = bytes / 1_073_741_824;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_048_576).toFixed(0)} MB`;
}

export default function PhysicalMediaDetailPage() {
  const params = useParams<{ type: string; id: string }>();
  const router = useRouter();
  const mediaKind = params.type === 'tapes' ? 'tapes' : 'discs';
  const isTape = mediaKind === 'tapes';
  const id = params.id;

  const [item, setItem] = useState<CatalogDisc | CatalogTape | null>(null);
  const [files, setFiles] = useState<LinkedMediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    return Promise.all([
      api.get<CatalogDisc | CatalogTape>(`/api/catalog/${mediaKind}/${id}`),
      api.get<LinkedMediaFile[]>(`/api/catalog/${mediaKind}/${id}/files`),
    ])
      .then(([itemData, filesData]) => {
        setItem(itemData);
        setFiles(filesData);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [mediaKind, id]);

  useEffect(() => {
    let cancelled = false;
    load().then(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, [load]);

  const handleDisconnect = async (fileId: string) => {
    setDisconnectingId(fileId);
    setDisconnectError('');
    try {
      await disconnectFile(fileId, isTape ? 'tape' : 'disc');
      await load();
    } catch (e: unknown) {
      setDisconnectError(e instanceof Error ? e.message : 'Failed to disconnect file');
    } finally {
      setDisconnectingId(null);
    }
  };

  if (loading) return <Box sx={{ p: 3 }}><CircularProgress size={24} /></Box>;
  if (error) return <Box sx={{ p: 3 }}><Alert severity="error">{error}</Alert></Box>;
  if (!item) return <Box sx={{ p: 3 }}><Alert severity="warning">Not found</Alert></Box>;

  const tape = isTape ? (item as CatalogTape) : null;
  const disc = !isTape ? (item as CatalogDisc) : null;

  return (
    <Box sx={{ p: 3, maxWidth: 900 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ mb: 0.5 }}>{item.title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {isTape ? 'Physical tape' : 'Physical disc'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>Edit</Button>
          <Button startIcon={<DeleteIcon />} color="error" onClick={() => setDeleteOpen(true)}>Delete</Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Details</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {disc && disc.format && <Chip label={`Format: ${disc.format}`} size="small" variant="outlined" />}
          {disc && disc.regionCode && <Chip label={`Region: ${disc.regionCode}`} size="small" variant="outlined" />}
          {disc && disc.condition && <Chip label={`Condition: ${disc.condition}`} size="small" variant="outlined" />}
          {disc && disc.barcode && <Chip label={`Barcode: ${disc.barcode}`} size="small" variant="outlined" />}
          {disc && disc.discNumber != null && <Chip label={`Disc #${disc.discNumber}`} size="small" variant="outlined" />}
          {disc && disc.language && <Chip label={`Language: ${disc.language}`} size="small" variant="outlined" />}
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

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2">
          Connected Files ({files.length})
        </Typography>
        <Button size="small" startIcon={<AddLinkIcon />} onClick={() => setConnectOpen(true)}>
          Connect a file
        </Button>
      </Stack>

      {disconnectError && <Alert severity="error" sx={{ mb: 1.5 }}>{disconnectError}</Alert>}

      {files.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No files connected yet. Files get connected automatically when ripped/digitized with this
          {isTape ? ' tape' : ' disc'} selected, or click &ldquo;Connect a file&rdquo; above to link one manually.
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
                <TableCell align="right">Actions</TableCell>
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
                  <TableCell align="right">
                    <Tooltip title="Disconnect from this item">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => handleDisconnect(f.id)}
                          disabled={disconnectingId === f.id}
                        >
                          {disconnectingId === f.id
                            ? <CircularProgress size={16} />
                            : <LinkOffIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {disc && (
        <DiscEditDialog
          open={editOpen}
          disc={disc}
          onClose={() => setEditOpen(false)}
          onSaved={() => load()}
        />
      )}
      {tape && (
        <TapeEditDialog
          open={editOpen}
          tape={tape}
          onClose={() => setEditOpen(false)}
          onSaved={() => load()}
        />
      )}
      <ConfirmDeleteDialog
        open={deleteOpen}
        title={`Delete ${isTape ? 'tape' : 'disc'}?`}
        description={`"${item.title}" will be permanently removed from your catalog. Connected files are not deleted, just disconnected.`}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          if (isTape) {
            await deleteTape(id);
          } else {
            await deleteDisc(id);
          }
          router.push('/dashboard/physical-media');
        }}
      />
      <ConnectFileDialog
        open={connectOpen}
        kind={isTape ? 'tape' : 'disc'}
        targetId={id}
        onClose={() => setConnectOpen(false)}
        onConnected={() => load()}
      />
    </Box>
  );
}

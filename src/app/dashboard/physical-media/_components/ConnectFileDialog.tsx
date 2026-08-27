'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, List, ListItemButton, ListItemText, TextField, Typography,
} from '@mui/material';
import { searchMediaFiles, connectFileToDisc, connectFileToTape, LinkedMediaFile } from '@/service/catalog/MediaFileLinkService';

export default function ConnectFileDialog({
  open,
  kind,
  targetId,
  onClose,
  onConnected,
}: {
  open: boolean;
  kind: 'disc' | 'tape';
  targetId: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LinkedMediaFile[]>([]);
  const [searching, setSearching] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = async (q: string) => {
    setSearching(true);
    try {
      setResults(await searchMediaFiles({ q: q || undefined, unlinked: true }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setError('');
    runSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(value), 300);
  };

  const handleConnect = async (fileId: string) => {
    setConnectingId(fileId);
    setError('');
    try {
      if (kind === 'disc') {
        await connectFileToDisc(fileId, targetId);
      } else {
        await connectFileToTape(fileId, targetId);
      }
      onConnected();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to connect file');
    } finally {
      setConnectingId(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect an existing file</DialogTitle>
      <DialogContent>
        <TextField
          label="Search by filename"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          fullWidth
          size="small"
          autoFocus
          sx={{ mb: 2, mt: 1 }}
          slotProps={{
            input: {
              endAdornment: searching ? <CircularProgress size={16} /> : undefined,
            },
          }}
        />

        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

        {!searching && results.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No unlinked files found{query ? ` matching "${query}"` : ''}.
          </Typography>
        )}

        <List dense sx={{ maxHeight: 320, overflowY: 'auto' }}>
          {results.map((file) => (
            <ListItemButton
              key={file.id}
              onClick={() => handleConnect(file.id)}
              disabled={connectingId !== null}
            >
              <ListItemText
                primary={file.fileName}
                secondary={
                  <Box component="span" sx={{ display: 'block', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                    {file.targetPath ?? file.filePath}
                  </Box>
                }
              />
              {connectingId === file.id
                ? <CircularProgress size={16} />
                : file.detectedMediaType && <Chip label={file.detectedMediaType} size="small" variant="outlined" />}
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

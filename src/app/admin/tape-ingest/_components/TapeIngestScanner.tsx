'use client';
import React, { useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormLabel, LinearProgress, List, ListItem, ListItemButton, ListItemIcon, ListItemText, MenuItem, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { ArrowUpward as UpIcon, Folder as FolderIcon, Search as ScanIcon } from '@mui/icons-material';
import { useTapeIngestStore } from '@/store/useTapeIngestStore';
import TapeIngestService from '@/service/tape-ingest/TapeIngestService';
import { TapeType } from '@/types/tape-ingest/TapeIngest.type';

export default function TapeIngestScanner() {
  const { sourcePath, tapeType, scanStatus, scanError, items, setSourcePath, setTapeType, scan } = useTapeIngestStore();
  const [scanRoots, setScanRoots] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPath, setPickerPath] = useState('');
  const [pickerEntries, setPickerEntries] = useState<Array<{ name: string; path: string }>>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  useEffect(() => {
    TapeIngestService.listScanRoots().then(setScanRoots).catch(() => {});
    TapeIngestService.getSettings().then((s) => {
      if (s.ingress_folder && !sourcePath) setSourcePath(s.ingress_folder);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDirectories = async (path: string) => {
    setPickerLoading(true); setPickerError(null);
    try {
      const dirs = await TapeIngestService.listDirectories(path);
      setPickerEntries(dirs.map((d) => ({ name: d.name, path: d.path })));
      setPickerPath(path);
    } catch (err: unknown) { setPickerError(err instanceof Error ? err.message : String(err)); setPickerEntries([]); }
    finally { setPickerLoading(false); }
  };

  const openPicker = async () => {
    const startPath = sourcePath || scanRoots[0] || '/';
    setPickerOpen(true);
    await loadDirectories(startPath);
  };

  const goUp = async () => {
    if (!pickerPath || pickerPath === '/') return;
    const trimmed = pickerPath.replace(/\/+$/, '');
    const lastSlash = trimmed.lastIndexOf('/');
    await loadDirectories(lastSlash <= 0 ? '/' : trimmed.slice(0, lastSlash));
  };

  const totalMinutes = Math.round(items.reduce((acc, i) => acc + (i.durationSeconds ?? 0), 0) / 60);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Step 1 — Select Source & Scan</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-end">
        <FormControl sx={{ minWidth: 220 }}>
          <FormLabel sx={{ mb: 0.5, fontSize: 13 }}>Source Path</FormLabel>
          <Stack direction="row" spacing={1}>
            {scanRoots.length > 0 && (
              <Select size="small" value={scanRoots.includes(sourcePath) ? sourcePath : ''} onChange={(e) => setSourcePath(e.target.value)} displayEmpty sx={{ minWidth: 120 }}>
                <MenuItem value="" disabled>Quick pick</MenuItem>
                {scanRoots.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
              </Select>
            )}
            <TextField size="small" placeholder="/ark/media/ingest" value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} sx={{ flex: 1 }} />
            <Button variant="outlined" size="small" onClick={openPicker}>Browse</Button>
          </Stack>
        </FormControl>

        <FormControl>
          <FormLabel sx={{ mb: 0.5, fontSize: 13 }}>Tape Type</FormLabel>
          <ToggleButtonGroup size="small" exclusive value={tapeType}
            onChange={(_, val: TapeType | null) => val && setTapeType(val)}>
            <ToggleButton value="vhs">VHS</ToggleButton>
            <ToggleButton value="vhs_c">VHS-C</ToggleButton>
            <ToggleButton value="mini_dv">Mini DV</ToggleButton>
          </ToggleButtonGroup>
        </FormControl>

        <Button variant="contained" startIcon={<ScanIcon />} onClick={scan} disabled={!sourcePath || scanStatus === 'scanning'}>
          {scanStatus === 'scanning' ? 'Scanning…' : 'Scan'}
        </Button>
      </Stack>

      {scanStatus === 'scanning' && <LinearProgress sx={{ mt: 2 }} />}
      {scanStatus === 'error' && <Typography color="error" sx={{ mt: 1 }}>{scanError}</Typography>}
      {scanStatus === 'done' && (
        <Typography sx={{ mt: 1.5 }} color="text.secondary">
          Found {items.length} file{items.length !== 1 ? 's' : ''}{totalMinutes > 0 ? ` · ~${totalMinutes} min total` : ''}
        </Typography>
      )}


      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Select Folder</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField size="small" label="Current Folder" value={pickerPath} onChange={(e) => setPickerPath(e.target.value)}
              onBlur={() => pickerPath && void loadDirectories(pickerPath)} />
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" startIcon={<UpIcon />} onClick={goUp} disabled={pickerLoading || !pickerPath || pickerPath === '/'}>Up</Button>
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>Choose a folder, then click Use This Folder.</Typography>
            </Stack>
            {pickerError && <Typography color="error" variant="body2">{pickerError}</Typography>}
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 280, overflow: 'auto' }}>
              <List dense disablePadding>
                {pickerEntries.map((entry) => (
                  <ListItem key={entry.path} disablePadding>
                    <ListItemButton onClick={() => void loadDirectories(entry.path)} disabled={pickerLoading}>
                      <ListItemIcon><FolderIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary={entry.name} secondary={entry.path} />
                    </ListItemButton>
                  </ListItem>
                ))}
                {!pickerLoading && pickerEntries.length === 0 && (
                  <ListItem><ListItemText primary="No subfolders found" secondary="You can still use the current folder." /></ListItem>
                )}
              </List>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickerOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => { setSourcePath(pickerPath); setPickerOpen(false); }} disabled={!pickerPath}>Use This Folder</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

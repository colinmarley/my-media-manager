'use client';

import React, { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { DiscRipperService } from '@/service/disc-ripper/DiscRipperService';
import type { DiscTitle } from '@/types/disc-ripper/DiscRipper.type';
import { fmtDur } from './discRipperUtils';

export default function DiscScanStep({
  titles,
  setTitles,
  scanError,
  setScanError,
  onContinue,
}: {
  titles: DiscTitle[];
  setTitles: (t: DiscTitle[]) => void;
  scanError: string;
  setScanError: (e: string) => void;
  onContinue: () => void;
}) {
  const [scanning, setScanning] = useState(false);

  const scan = async () => {
    setScanning(true);
    setScanError('');
    setTitles([]);
    try {
      const info = await DiscRipperService.getDiscInfo();
      if (info.error) {
        setScanError(info.error);
      } else {
        setTitles(info.titles);
      }
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : 'Scan failed — is the ripper service running?');
    } finally {
      setScanning(false);
    }
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Insert the disc and click Scan to read its contents.
        The ripper service must be running on the ai-workstation (port 8083).
      </Typography>
      <Button
        variant="contained"
        onClick={scan}
        disabled={scanning}
        startIcon={scanning ? <CircularProgress size={16} /> : <RefreshIcon />}
      >
        {scanning ? 'Scanning…' : 'Scan Disc'}
      </Button>

      {scanError && <Alert severity="error" sx={{ mt: 2 }}>{scanError}</Alert>}

      {titles.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Found {titles.length} title(s) — select the episodes/content in the next step
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Resolution</TableCell>
                  <TableCell>Codec</TableCell>
                  <TableCell>Chapters</TableCell>
                  <TableCell>Size</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {titles.map((t) => (
                  <TableRow key={t.index} hover sx={{ opacity: t.duration_seconds < 120 ? 0.5 : 1 }}>
                    <TableCell>{t.index}</TableCell>
                    <TableCell>
                      {fmtDur(t.duration_seconds)}
                      {t.duration_seconds < 120 && (
                        <Chip label="short" size="small" sx={{ ml: 1, height: 16, fontSize: 10 }} />
                      )}
                    </TableCell>
                    <TableCell>{t.width && t.height ? `${t.width}×${t.height}` : '—'}</TableCell>
                    <TableCell>{t.codec || '—'}</TableCell>
                    <TableCell>{t.chapter_count || '—'}</TableCell>
                    <TableCell>{DiscRipperService.formatBytes(t.file_size_bytes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Button variant="contained" sx={{ mt: 2 }} onClick={onContinue}>
            Continue to Configure →
          </Button>
        </Box>
      )}
    </Box>
  );
}

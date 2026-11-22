'use client';

import React, { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { DiscRipperService } from '@/service/disc-ripper/DiscRipperService';
import type { DiscScanInfo, DiscTitle } from '@/types/disc-ripper/DiscRipper.type';
import { findRipsByFingerprint } from '@/service/catalog/DiscCatalogService';
import type { StoredRip } from '@/types/disc-ripper/DiscRipper.type';
import { audioSummary, describeStoredRip, fmtDur, subtitleSummary } from './discRipperUtils';

export default function DiscScanStep({
  titles,
  setTitles,
  scanError,
  setScanError,
  scanInfo,
  previousRips,
  onScanned,
  onPreviousRips,
  onContinue,
}: {
  titles: DiscTitle[];
  setTitles: (t: DiscTitle[]) => void;
  scanError: string;
  setScanError: (e: string) => void;
  /** Disc identity of the scan just made (null when the scan failed or the ripper is an older build). */
  onScanned?: (info: DiscScanInfo | null) => void;
  /** The last scan's disc identity and earlier rips of that disc (held by the page). */
  scanInfo?: DiscScanInfo | null;
  previousRips?: StoredRip[];
  onPreviousRips?: (rips: StoredRip[]) => void;
  onContinue: () => void;
}) {
  const [scanning, setScanning] = useState(false);

  const scan = async () => {
    setScanning(true);
    setScanError('');
    setTitles([]);
    onScanned?.(null);
    onPreviousRips?.([]);
    try {
      const info = await DiscRipperService.getDiscInfo();
      if (info.error) {
        setScanError(info.error);
      } else {
        setTitles(info.titles);
        onScanned?.(info.disc ?? null);
        if (info.disc?.fingerprint) {
          onPreviousRips?.(await findRipsByFingerprint(info.disc.fingerprint));
        }
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
        disc-ripper-service must be running and reachable at DISC_RIPPER_URL (port 8083 by default).
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
          {scanInfo && (
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>{scanInfo.volume_label || scanInfo.disc_name || 'Unlabelled disc'}</strong>
              {[scanInfo.disc_type, scanInfo.makemkv_version,
                scanInfo.skipped_short ? `${scanInfo.skipped_short} short title(s) skipped` : null]
                .filter(Boolean).map((part) => ` · ${part}`).join('')}
            </Typography>
          )}
          {(previousRips?.length ?? 0) > 0 && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              <strong>This disc has been ripped before.</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {previousRips!.map((rip) => <li key={rip.id}>{describeStoredRip(rip)}</li>)}
              </ul>
            </Alert>
          )}
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
                  <TableCell>Audio</TableCell>
                  <TableCell>Subtitles</TableCell>
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
                    <TableCell>{audioSummary(t.streams)}</TableCell>
                    <TableCell>{subtitleSummary(t.streams)}</TableCell>
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

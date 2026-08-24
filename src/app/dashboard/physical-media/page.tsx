'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Box, Chip, CircularProgress, Paper, Stack, Tab, Tabs,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import useDiscs from '@/hooks/catalog/useDiscs';
import useTapes from '@/hooks/catalog/useTapes';

export default function PhysicalMediaPage() {
  const [tab, setTab] = useState<'discs' | 'tapes'>('discs');
  const { discs, loading: discsLoading, error: discsError } = useDiscs();
  const { tapes, loading: tapesLoading, error: tapesError } = useTapes();

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 1 }}>Physical Media</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Everything you own on disc or tape, and the files ripped/digitized from each.
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label={`Discs (${discs.length})`} value="discs" />
        <Tab label={`Tapes (${tapes.length})`} value="tapes" />
      </Tabs>

      {tab === 'discs' && (
        <Box>
          {discsLoading && <CircularProgress size={20} />}
          {discsError && <Typography color="error">{discsError}</Typography>}
          {!discsLoading && discs.length === 0 && (
            <Typography color="text.secondary">
              No discs catalogued yet. Add one from Admin → Discs, or link one while starting a rip.
            </Typography>
          )}
          {discs.length > 0 && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>Format</TableCell>
                    <TableCell>Condition</TableCell>
                    <TableCell>Region</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {discs.map((disc) => (
                    <TableRow key={disc.id} hover>
                      <TableCell>
                        <Link href={`/dashboard/physical-media/discs/${disc.id}`}>{disc.title}</Link>
                      </TableCell>
                      <TableCell>{disc.format ?? '—'}</TableCell>
                      <TableCell>
                        {disc.condition
                          ? <Chip label={disc.condition} size="small" variant="outlined" />
                          : '—'}
                      </TableCell>
                      <TableCell>{disc.regionCode ?? '—'}</TableCell>
                      <TableCell>
                        {disc.containsSpecialFeatures && (
                          <Chip label="has extras" size="small" color="info" variant="outlined" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {tab === 'tapes' && (
        <Box>
          {tapesLoading && <CircularProgress size={20} />}
          {tapesError && <Typography color="error">{tapesError}</Typography>}
          {!tapesLoading && tapes.length === 0 && (
            <Typography color="text.secondary">
              No tapes catalogued yet.
            </Typography>
          )}
          {tapes.length > 0 && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Label</TableCell>
                    <TableCell>Brand</TableCell>
                    <TableCell>Condition</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tapes.map((tape) => (
                    <TableRow key={tape.id} hover>
                      <TableCell>
                        <Link href={`/dashboard/physical-media/tapes/${tape.id}`}>{tape.title}</Link>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          {tape.tapeType && <Chip label={tape.tapeType.toUpperCase()} size="small" />}
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{tape.tapeLabel ?? '—'}</TableCell>
                      <TableCell>{tape.brand ?? '—'}</TableCell>
                      <TableCell>
                        {tape.condition
                          ? <Chip label={tape.condition} size="small" variant="outlined" />
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}
    </Box>
  );
}

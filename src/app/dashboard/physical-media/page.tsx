'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Box, Button, Chip, CircularProgress, FormControlLabel, IconButton, Paper, Stack, Switch, Tab, Tabs,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import useDiscs from '@/hooks/catalog/useDiscs';
import useTapes from '@/hooks/catalog/useTapes';
import { deleteDisc } from '@/service/catalog/DiscCatalogService';
import { deleteTape } from '@/service/catalog/TapeCatalogService';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { CatalogTape } from '@/types/catalog/Tape.type';
import DiscEditDialog from './_components/DiscEditDialog';
import TapeEditDialog from './_components/TapeEditDialog';
import ConfirmDeleteDialog from './_components/ConfirmDeleteDialog';

export default function PhysicalMediaPage() {
  const [tab, setTab] = useState<'discs' | 'tapes'>('discs');
  const [needsRippingOnly, setNeedsRippingOnly] = useState(false);
  const { discs: allDiscs, loading: discsLoading, error: discsError, refetch: refetchDiscs } = useDiscs();
  const { tapes: allTapes, loading: tapesLoading, error: tapesError, refetch: refetchTapes } = useTapes();

  const discs = needsRippingOnly ? allDiscs.filter((d) => !d.linkedFileCount) : allDiscs;
  const tapes = needsRippingOnly ? allTapes.filter((t) => !t.linkedFileCount) : allTapes;

  const [discDialogOpen, setDiscDialogOpen] = useState(false);
  const [editingDisc, setEditingDisc] = useState<CatalogDisc | null>(null);
  const [deletingDisc, setDeletingDisc] = useState<CatalogDisc | null>(null);

  const [tapeDialogOpen, setTapeDialogOpen] = useState(false);
  const [editingTape, setEditingTape] = useState<CatalogTape | null>(null);
  const [deletingTape, setDeletingTape] = useState<CatalogTape | null>(null);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 1 }}>Physical Media</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Everything you own on disc or tape, and the files ripped/digitized from each.
      </Typography>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab label={`Discs (${allDiscs.length})`} value="discs" />
          <Tab label={`Tapes (${allTapes.length})`} value="tapes" />
        </Tabs>
        <Stack direction="row" spacing={2} alignItems="center">
          <FormControlLabel
            control={<Switch size="small" checked={needsRippingOnly} onChange={(e) => setNeedsRippingOnly(e.target.checked)} />}
            label="Needs ripping only"
          />
          {tab === 'discs' ? (
            <Button startIcon={<AddIcon />} onClick={() => { setEditingDisc(null); setDiscDialogOpen(true); }}>
              New Disc
            </Button>
          ) : (
            <Button startIcon={<AddIcon />} onClick={() => { setEditingTape(null); setTapeDialogOpen(true); }}>
              New Tape
            </Button>
          )}
        </Stack>
      </Stack>

      {tab === 'discs' && (
        <Box>
          {discsLoading && <CircularProgress size={20} />}
          {discsError && <Typography color="error">{discsError}</Typography>}
          {!discsLoading && discs.length === 0 && (
            <Typography color="text.secondary">
              {needsRippingOnly
                ? 'Every catalogued disc has at least one linked file — nothing needs ripping.'
                : 'No discs catalogued yet. Click “New Disc” above, or link one while starting a rip.'}
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
                    <TableCell align="right">Actions</TableCell>
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
                        <Stack direction="row" spacing={0.5}>
                          {!disc.linkedFileCount && (
                            <Chip label="Unripped" size="small" color="warning" variant="outlined" />
                          )}
                          {disc.containsSpecialFeatures && (
                            <Chip label="has extras" size="small" color="info" variant="outlined" />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => { setEditingDisc(disc); setDiscDialogOpen(true); }}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => setDeletingDisc(disc)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
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
              {needsRippingOnly
                ? 'Every catalogued tape has at least one linked file — nothing needs ripping.'
                : 'No tapes catalogued yet. Click “New Tape” above.'}
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
                    <TableCell />
                    <TableCell align="right">Actions</TableCell>
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
                      <TableCell>
                        {!tape.linkedFileCount && (
                          <Chip label="Unripped" size="small" color="warning" variant="outlined" />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => { setEditingTape(tape); setTapeDialogOpen(true); }}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => setDeletingTape(tape)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      <DiscEditDialog
        open={discDialogOpen}
        disc={editingDisc}
        onClose={() => setDiscDialogOpen(false)}
        onSaved={() => refetchDiscs()}
      />
      <TapeEditDialog
        open={tapeDialogOpen}
        tape={editingTape}
        onClose={() => setTapeDialogOpen(false)}
        onSaved={() => refetchTapes()}
      />
      <ConfirmDeleteDialog
        open={!!deletingDisc}
        title="Delete disc?"
        description={`"${deletingDisc?.title}" will be permanently removed from your catalog. Files linked to it are not deleted, just unlinked.`}
        onClose={() => setDeletingDisc(null)}
        onConfirm={async () => {
          if (deletingDisc) {
            await deleteDisc(deletingDisc.id);
            await refetchDiscs();
          }
        }}
      />
      <ConfirmDeleteDialog
        open={!!deletingTape}
        title="Delete tape?"
        description={`"${deletingTape?.title}" will be permanently removed from your catalog. Files linked to it are not deleted, just unlinked.`}
        onClose={() => setDeletingTape(null)}
        onConfirm={async () => {
          if (deletingTape) {
            await deleteTape(deletingTape.id);
            await refetchTapes();
          }
        }}
      />
    </Box>
  );
}

'use client';

import React, { useRef, useState } from 'react';
import {
  Alert, Autocomplete, Button, Chip, CircularProgress, Collapse, MenuItem,
  Paper, Stack, TextField, Typography,
} from '@mui/material';
import { searchDiscs, createDisc } from '@/service/catalog/DiscCatalogService';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import type { DiscFormat } from '@/types/catalog/Common.type';

const FORMAT_OPTIONS: { value: DiscFormat; label: string }[] = [
  { value: 'DVD', label: 'DVD' },
  { value: 'BLURAY', label: 'Blu-ray' },
  { value: 'UHD_BLURAY', label: '4K UHD Blu-ray' },
  { value: 'HD_DVD', label: 'HD DVD' },
];

/** The fields of a new disc record, from the create form. */
export function newDiscBody(form: {
  title: string; barcode: string; discNumber: string; edition: string; format: DiscFormat;
}): Partial<CatalogDisc> {
  const discNumber = parseInt(form.discNumber, 10);
  return {
    title: form.title.trim() || 'Untitled Disc',
    barcode: form.barcode.trim() || undefined,
    discNumber: Number.isFinite(discNumber) && discNumber > 0 ? discNumber : undefined,
    edition: form.edition.trim() || undefined,
    format: form.format,
  };
}

/**
 * Search for or create the physical Disc catalog record this rip belongs to.
 * The Disc table in my-media-manager's Postgres is the canonical, cross-service
 * disc entity (see backend/api/catalog.py) — disc-ripper-service has no disc
 * identity of its own, it just stores the linked catalog_disc_id on the job.
 *
 * Linking is required: Start Rip stays disabled until a disc is picked or
 * created here, so every ripped file knows the physical disc (and through it
 * the release) it came from.
 */
export default function DiscCatalogLinkPanel({
  discTitle,
  discType,
  volumeLabel,
  linkedDisc,
  onLink,
  onUnlink,
}: {
  discTitle: string;
  /** The rip's disc type, used as the new record's default format. */
  discType?: 'dvd' | 'bluray';
  /** The disc's own label from the scan, shown as a hint while picking. */
  volumeLabel?: string | null;
  linkedDisc: CatalogDisc | null;
  onLink: (disc: CatalogDisc) => void;
  onUnlink: () => void;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [results, setResults] = useState<CatalogDisc[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeResults, setBarcodeResults] = useState<CatalogDisc[]>([]);
  const [barcodeSearching, setBarcodeSearching] = useState(false);
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New-record form
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDiscNumber, setNewDiscNumber] = useState('');
  const [newEdition, setNewEdition] = useState('');
  const [newFormat, setNewFormat] = useState<DiscFormat | ''>('');
  const format: DiscFormat = newFormat || (discType === 'bluray' ? 'BLURAY' : 'DVD');

  const runSearch = async (query: string) => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      setResults(await searchDiscs({ title: query }));
    } finally {
      setSearching(false);
    }
  };

  const handleInputChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(value), 400);
  };

  const runBarcodeSearch = async (query: string) => {
    if (!query.trim()) { setBarcodeResults([]); return; }
    setBarcodeSearching(true);
    try {
      const found = await searchDiscs({ barcode: query.trim() });
      setBarcodeResults(found);
      // A barcode scanner types digits + Enter — an unambiguous match should
      // link immediately rather than making the user click a result.
      if (found.length === 1) onLink(found[0]);
    } finally {
      setBarcodeSearching(false);
    }
  };

  const handleBarcodeInputChange = (value: string) => {
    setBarcodeInput(value);
    if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
    barcodeTimer.current = setTimeout(() => runBarcodeSearch(value), 400);
  };

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
    runBarcodeSearch(barcodeInput);
  };

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const disc = await createDisc(newDiscBody({
        title: newTitle || discTitle || searchInput,
        barcode: barcodeInput,
        discNumber: newDiscNumber,
        edition: newEdition,
        format,
      }));
      onLink(disc);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create disc record');
    } finally {
      setCreating(false);
    }
  };

  if (linkedDisc) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2">Linked to disc:</Typography>
            <Chip label={linkedDisc.title} size="small" color="primary" />
            {linkedDisc.discNumber != null && (
              <Typography variant="caption" color="text.secondary">Disc {linkedDisc.discNumber}</Typography>
            )}
            {linkedDisc.edition && (
              <Typography variant="caption" color="text.secondary">{linkedDisc.edition}</Typography>
            )}
          </Stack>
          <Button size="small" onClick={onUnlink}>Unlink</Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Physical Disc (required)
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
        Link this rip to a disc in your physical media catalog, or create a new record for it.
        {volumeLabel ? ` The disc in the drive calls itself “${volumeLabel}”.` : ''}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <TextField
          size="small"
          label="Scan or type barcode"
          value={barcodeInput}
          inputMode="numeric"
          onChange={(e) => handleBarcodeInputChange(e.target.value)}
          onKeyDown={handleBarcodeKeyDown}
          sx={{ minWidth: 220 }}
          slotProps={{
            input: {
              endAdornment: barcodeSearching ? <CircularProgress size={16} /> : undefined,
            },
          }}
        />
        {barcodeResults.length > 1 && (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {barcodeResults.map((disc) => (
              <Chip
                key={disc.id}
                label={disc.title}
                size="small"
                variant="outlined"
                clickable
                onClick={() => onLink(disc)}
              />
            ))}
          </Stack>
        )}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
        <Autocomplete
          size="small"
          sx={{ minWidth: 260, flex: '1 1 260px' }}
          options={results}
          loading={searching}
          getOptionLabel={(opt) => opt.title}
          inputValue={searchInput}
          onInputChange={(_, value) => handleInputChange(value)}
          onChange={(_, value) => { if (value) onLink(value); }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search existing discs"
              slotProps={{
                input: {
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {searching && <CircularProgress size={16} />}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                },
              }}
            />
          )}
        />
        <Button
          variant="outlined"
          size="small"
          onClick={() => { setShowCreate((v) => !v); if (!newTitle) setNewTitle(discTitle || searchInput); }}
          sx={{ alignSelf: 'center' }}
        >
          {showCreate ? 'Cancel New Record' : 'Create New Disc Record'}
        </Button>
      </Stack>
      <Collapse in={showCreate} unmountOnExit>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          <TextField
            size="small"
            label="Disc title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            sx={{ flex: '2 1 220px' }}
          />
          <TextField
            size="small"
            label="Disc #"
            type="number"
            value={newDiscNumber}
            onChange={(e) => setNewDiscNumber(e.target.value)}
            sx={{ width: 90 }}
            slotProps={{ htmlInput: { min: 1 } }}
          />
          <TextField
            size="small"
            label="Edition"
            placeholder="Director's Cut"
            value={newEdition}
            onChange={(e) => setNewEdition(e.target.value)}
            sx={{ flex: '1 1 160px' }}
          />
          <TextField
            select
            size="small"
            label="Format"
            value={format}
            onChange={(e) => setNewFormat(e.target.value as DiscFormat)}
            sx={{ width: 170 }}
          >
            {FORMAT_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            size="small"
            disabled={creating}
            startIcon={creating ? <CircularProgress size={14} /> : undefined}
            onClick={handleCreate}
          >
            {creating ? 'Creating…' : 'Create and Link'}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          The barcode above, if entered, is saved on the new record.
        </Typography>
      </Collapse>
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Paper>
  );
}

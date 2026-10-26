'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, TextField,
} from '@mui/material';
import { createDisc, updateDisc } from '@/service/catalog/DiscCatalogService';
import { lookupUpc, scanCover } from '@/service/catalog/DiscLookupService';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { DiscFormat, DiscCondition, StorageType } from '@/types/catalog/Common.type';
import { storageLocationPayload, validateStorageLocation } from '@/utils/storageLocation';
import StorageLocationFields from './StorageLocationFields';

const FORMATS: DiscFormat[] = ['DVD', 'BLURAY', 'HD_DVD', 'UHD_BLURAY', 'LASERDISC'];
const CONDITIONS: DiscCondition[] = ['Mint', 'Good', 'Fair', 'Poor'];

// Fields a barcode lookup or cover scan can suggest.
type Suggestion = { title?: string; format?: DiscFormat; releaseDate?: string };
type SuggestionKey = keyof Suggestion;
const SUGGESTION_LABELS: Record<SuggestionKey, string> = {
  title: 'Title', format: 'Format', releaseDate: 'Release date',
};

function asFormat(value?: string | null): DiscFormat | undefined {
  return FORMATS.find((f) => f === value);
}

export default function DiscEditDialog({
  open,
  disc,
  onClose,
  onSaved,
}: {
  open: boolean;
  disc?: CatalogDisc | null;
  onClose: () => void;
  onSaved: (disc: CatalogDisc) => void;
}) {
  const isEdit = !!disc;

  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<DiscFormat | ''>('');
  const [barcode, setBarcode] = useState('');
  const [condition, setCondition] = useState<DiscCondition | ''>('');
  const [regionCode, setRegionCode] = useState('');
  const [discNumber, setDiscNumber] = useState('');
  const [language, setLanguage] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [isPartOfSet, setIsPartOfSet] = useState(false);
  const [isRentalDisc, setIsRentalDisc] = useState(false);
  const [containsSpecialFeatures, setContainsSpecialFeatures] = useState(false);
  const [storageType, setStorageType] = useState<StorageType | ''>('');
  const [storageId, setStorageId] = useState('');
  const [storageError, setStorageError] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [lookupBusy, setLookupBusy] = useState<'upc' | 'scan' | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [lookupInfo, setLookupInfo] = useState('');
  const [pendingOverwrite, setPendingOverwrite] = useState<Suggestion | null>(null);

  // Lookups can take minutes: compare results against the values on screen when they
  // arrive, and drop results that belong to a previous entry.
  const latest = useRef<Record<SuggestionKey, string>>({ title, format, releaseDate });
  latest.current = { title, format, releaseDate };
  const lookupSeq = useRef(0);

  const clearLookup = () => {
    setLookupError('');
    setLookupInfo('');
    setPendingOverwrite(null);
  };

  // Per-disc fields; format and condition carry over between "add another" entries.
  const resetPerDiscFields = (from?: CatalogDisc | null) => {
    setTitle(from?.title ?? '');
    setBarcode(from?.barcode ?? '');
    setRegionCode(from?.regionCode ?? '');
    setDiscNumber(from?.discNumber != null ? String(from.discNumber) : '');
    setLanguage(from?.language ?? '');
    setPurchaseDate(from?.purchaseDate ?? '');
    setReleaseDate(from?.releaseDate ?? '');
    setIsPartOfSet(from?.isPartOfSet ?? false);
    setIsRentalDisc(from?.isRentalDisc ?? false);
    setContainsSpecialFeatures(from?.containsSpecialFeatures ?? false);
    lookupSeq.current += 1;
    setLookupBusy(null);
    clearLookup();
  };

  useEffect(() => {
    if (!open) return;
    resetPerDiscFields(disc);
    setFormat(disc?.format ?? '');
    setCondition(disc?.condition ?? '');
    setStorageType(disc?.storageType ?? '');
    setStorageId(disc?.storageId ?? '');
    setStorageError('');
    setError('');
    setInfo('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, disc]);

  const setters: Record<SuggestionKey, (v: string) => void> = {
    title: setTitle,
    format: (v) => setFormat(v as DiscFormat),
    releaseDate: setReleaseDate,
  };

  // Fill empty fields; anything the user already typed is held back for confirmation.
  const applySuggestion = (source: string, suggestion: Suggestion, note = '') => {
    const current = latest.current;
    const filled: string[] = [];
    const conflicts: Suggestion = {};
    (Object.keys(SUGGESTION_LABELS) as SuggestionKey[]).forEach((key) => {
      const value = suggestion[key];
      if (!value) return;
      if (!current[key].trim()) {
        setters[key](value);
        filled.push(SUGGESTION_LABELS[key]);
      } else if (current[key] !== value) {
        (conflicts as Record<SuggestionKey, string>)[key] = value;
      }
    });
    setLookupInfo(
      (filled.length ? `${source} filled: ${filled.join(', ')}.` : `${source}: no empty fields to fill.`) + note,
    );
    setPendingOverwrite(Object.keys(conflicts).length ? conflicts : null);
  };

  const applyOverwrite = () => {
    if (!pendingOverwrite) return;
    const keys = Object.keys(pendingOverwrite) as SuggestionKey[];
    keys.forEach((key) => setters[key](pendingOverwrite[key]!));
    setLookupInfo(`Replaced: ${keys.map((k) => SUGGESTION_LABELS[k]).join(', ')}.`);
    setPendingOverwrite(null);
  };

  const handleLookup = async () => {
    const code = barcode.trim();
    clearLookup();
    if (!/^\d{8,14}$/.test(code)) { setLookupError('Enter an 8–14 digit barcode to look up.'); return; }
    setLookupBusy('upc');
    const seq = ++lookupSeq.current;
    try {
      const result = await lookupUpc(code);
      if (seq !== lookupSeq.current) return;
      if (!result.found) {
        setLookupError(`No match found for barcode ${code}.`);
      } else if (result.looksLikeMedia === false) {
        setLookupError(`Barcode matched "${result.rawTitle || result.title}", which doesn't look like a disc. Check the barcode.`);
      } else {
        applySuggestion('Barcode lookup', {
          title: result.title || undefined,
          format: asFormat(result.format),
          releaseDate: result.releaseDate || undefined,
        });
      }
    } catch (e: unknown) {
      if (seq === lookupSeq.current) setLookupError(e instanceof Error ? e.message : 'Barcode lookup failed');
    } finally {
      if (seq === lookupSeq.current) setLookupBusy(null);
    }
  };

  const handleScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    clearLookup();
    setLookupBusy('scan');
    const seq = ++lookupSeq.current;
    try {
      const result = await scanCover(file);
      if (seq !== lookupSeq.current) return;
      if (!result.found || !result.title) {
        setLookupError("Couldn't read a title from that photo.");
      } else {
        const notes = [
          result.year ? `Year on cover: ${result.year}` : '',
          !result.verified || result.confidence === 'low' ? 'Low confidence — please check' : '',
        ].filter(Boolean);
        applySuggestion(
          'Cover scan',
          { title: result.title, format: asFormat(result.format) },
          notes.length ? ` ${notes.join('. ')}.` : '',
        );
      }
    } catch (err: unknown) {
      if (seq === lookupSeq.current) setLookupError(err instanceof Error ? err.message : 'Cover scan failed');
    } finally {
      if (seq === lookupSeq.current) setLookupBusy(null);
    }
  };

  const handleSave = async (addAnother = false) => {
    if (!title.trim()) { setError('Title is required'); return; }
    const locationError = validateStorageLocation(storageType, storageId, disc?.storageId);
    setStorageError(locationError);
    if (locationError) return;
    setSaving(true);
    setError('');
    setInfo('');
    const payload: Partial<CatalogDisc> = {
      title: title.trim(),
      format: format || undefined,
      barcode: barcode || undefined,
      condition: condition || undefined,
      regionCode: regionCode || undefined,
      discNumber: discNumber ? Number(discNumber) : undefined,
      language: language || undefined,
      purchaseDate: purchaseDate || undefined,
      releaseDate: releaseDate || undefined,
      isPartOfSet,
      isRentalDisc,
      containsSpecialFeatures,
      ...storageLocationPayload(storageType, storageId, disc?.storageId),
    };
    try {
      const saved = isEdit
        ? await updateDisc(disc!.id, payload)
        : await createDisc(payload);
      onSaved(saved);
      if (addAnother) {
        resetPerDiscFields(null);
        setInfo(`Saved "${saved.title}". Ready for the next disc.`);
      } else {
        onClose();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save disc');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit Disc' : 'New Disc'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {info && <Alert severity="success">{info}</Alert>}
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField label="Barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} fullWidth size="small" />
            <Button
              variant="outlined" onClick={handleLookup}
              disabled={!!lookupBusy || !barcode.trim()} sx={{ whiteSpace: 'nowrap' }}
            >
              {lookupBusy === 'upc' ? 'Looking up…' : 'Look up'}
            </Button>
            <Button variant="outlined" component="label" disabled={!!lookupBusy} sx={{ whiteSpace: 'nowrap' }}>
              {lookupBusy === 'scan' ? 'Scanning…' : 'Scan cover'}
              <input hidden type="file" accept="image/*" aria-label="Cover photo" onChange={handleScan} />
            </Button>
          </Stack>
          {lookupError && <Alert severity="warning">{lookupError}</Alert>}
          {lookupInfo && <Alert severity="info">{lookupInfo}</Alert>}
          {pendingOverwrite && (
            <Alert
              severity="warning"
              action={(
                <>
                  <Button color="inherit" size="small" onClick={applyOverwrite}>Replace</Button>
                  <Button color="inherit" size="small" onClick={() => setPendingOverwrite(null)}>Keep mine</Button>
                </>
              )}
            >
              Lookup suggests different values:{' '}
              {(Object.keys(pendingOverwrite) as SuggestionKey[])
                .map((k) => `${SUGGESTION_LABELS[k]}: "${pendingOverwrite[k]}"`)
                .join('; ')}
            </Alert>
          )}
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
            autoFocus
          />
          <Stack direction="row" spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Format</InputLabel>
              <Select label="Format" value={format} onChange={(e) => setFormat(e.target.value as DiscFormat)}>
                <MenuItem value=""><em>None</em></MenuItem>
                {FORMATS.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Condition</InputLabel>
              <Select label="Condition" value={condition} onChange={(e) => setCondition(e.target.value as DiscCondition)}>
                <MenuItem value=""><em>None</em></MenuItem>
                {CONDITIONS.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField label="Region Code" value={regionCode} onChange={(e) => setRegionCode(e.target.value)} fullWidth size="small" />
            <TextField label="Disc #" type="number" value={discNumber} onChange={(e) => setDiscNumber(e.target.value)} sx={{ width: 100 }} size="small" />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} fullWidth size="small" />
            <TextField
              label="Purchase Date" type="date" value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)} fullWidth size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Release Date" type="date" value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)} fullWidth size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
          <StorageLocationFields
            storageType={storageType} storageId={storageId} error={storageError}
            onTypeChange={setStorageType} onIdChange={setStorageId}
          />
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <FormControlLabel
              control={<Checkbox checked={isPartOfSet} onChange={(e) => setIsPartOfSet(e.target.checked)} />}
              label="Part of a set"
            />
            <FormControlLabel
              control={<Checkbox checked={isRentalDisc} onChange={(e) => setIsRentalDisc(e.target.checked)} />}
              label="Rental disc"
            />
            <FormControlLabel
              control={<Checkbox checked={containsSpecialFeatures} onChange={(e) => setContainsSpecialFeatures(e.target.checked)} />}
              label="Contains special features"
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        {!isEdit && (
          <Button onClick={() => handleSave(true)} disabled={saving}>Save &amp; add another</Button>
        )}
        <Button variant="contained" onClick={() => handleSave()} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Disc'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

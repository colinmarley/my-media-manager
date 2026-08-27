'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, TextField,
} from '@mui/material';
import { createDisc, updateDisc } from '@/service/catalog/DiscCatalogService';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { DiscFormat, DiscCondition } from '@/types/catalog/Common.type';

const FORMATS: DiscFormat[] = ['DVD', 'BLURAY', 'HD_DVD', 'UHD_BLURAY', 'LASERDISC'];
const CONDITIONS: DiscCondition[] = ['Mint', 'Good', 'Fair', 'Poor'];

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

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(disc?.title ?? '');
    setFormat(disc?.format ?? '');
    setBarcode(disc?.barcode ?? '');
    setCondition(disc?.condition ?? '');
    setRegionCode(disc?.regionCode ?? '');
    setDiscNumber(disc?.discNumber != null ? String(disc.discNumber) : '');
    setLanguage(disc?.language ?? '');
    setPurchaseDate(disc?.purchaseDate ?? '');
    setReleaseDate(disc?.releaseDate ?? '');
    setIsPartOfSet(disc?.isPartOfSet ?? false);
    setIsRentalDisc(disc?.isRentalDisc ?? false);
    setContainsSpecialFeatures(disc?.containsSpecialFeatures ?? false);
    setError('');
  }, [open, disc]);

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
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
    };
    try {
      const saved = isEdit
        ? await updateDisc(disc!.id, payload)
        : await createDisc(payload);
      onSaved(saved);
      onClose();
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
            <TextField label="Barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} fullWidth size="small" />
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
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Disc'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

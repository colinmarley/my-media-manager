'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Select, Stack, TextField,
} from '@mui/material';
import { createTape, updateTape } from '@/service/catalog/TapeCatalogService';
import { CatalogTape } from '@/types/catalog/Tape.type';
import { TapeType, TapeBrand, TapeCondition, RecordingSpeed } from '@/types/tape-ingest/TapeIngest.type';

const TAPE_TYPES: TapeType[] = ['vhs', 'vhs_c', 'mini_dv'];
const BRANDS: TapeBrand[] = ['TDK', 'Maxell', 'Sony', 'BASF', 'Fuji', 'Scotch', 'Memorex', 'Ampex', 'Generic', 'Unknown'];
const CONDITIONS: TapeCondition[] = ['good', 'fair', 'poor', 'unknown'];
const SPEEDS: RecordingSpeed[] = ['sp', 'lp', 'ep', 'unknown'];

export default function TapeEditDialog({
  open,
  tape,
  onClose,
  onSaved,
}: {
  open: boolean;
  tape?: CatalogTape | null;
  onClose: () => void;
  onSaved: (tape: CatalogTape) => void;
}) {
  const isEdit = !!tape;

  const [title, setTitle] = useState('');
  const [tapeType, setTapeType] = useState<TapeType | ''>('');
  const [tapeLabel, setTapeLabel] = useState('');
  const [brand, setBrand] = useState<TapeBrand | ''>('');
  const [condition, setCondition] = useState<TapeCondition | ''>('');
  const [recordingSpeed, setRecordingSpeed] = useState<RecordingSpeed | ''>('');
  const [labelNotes, setLabelNotes] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(tape?.title ?? '');
    setTapeType(tape?.tapeType ?? '');
    setTapeLabel(tape?.tapeLabel ?? '');
    setBrand(tape?.brand ?? '');
    setCondition(tape?.condition ?? '');
    setRecordingSpeed(tape?.recordingSpeed ?? '');
    setLabelNotes(tape?.labelNotes ?? '');
    setPurchaseDate(tape?.purchaseDate ?? '');
    setError('');
  }, [open, tape]);

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    const payload: Partial<CatalogTape> = {
      title: title.trim(),
      tapeType: tapeType || undefined,
      tapeLabel: tapeLabel || undefined,
      brand: brand || undefined,
      condition: condition || undefined,
      recordingSpeed: recordingSpeed || undefined,
      labelNotes: labelNotes || undefined,
      purchaseDate: purchaseDate || undefined,
    };
    try {
      const saved = isEdit
        ? await updateTape(tape!.id, payload)
        : await createTape(payload);
      onSaved(saved);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save tape');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit Tape' : 'New Tape'}</DialogTitle>
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
              <InputLabel>Type</InputLabel>
              <Select label="Type" value={tapeType} onChange={(e) => setTapeType(e.target.value as TapeType)}>
                <MenuItem value=""><em>None</em></MenuItem>
                {TAPE_TYPES.map((t) => <MenuItem key={t} value={t}>{t.toUpperCase()}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              label="Physical Label" value={tapeLabel} onChange={(e) => setTapeLabel(e.target.value)}
              placeholder="VHSC_0001" fullWidth size="small"
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>Brand</InputLabel>
              <Select label="Brand" value={brand} onChange={(e) => setBrand(e.target.value as TapeBrand)}>
                <MenuItem value=""><em>None</em></MenuItem>
                {BRANDS.map((b) => <MenuItem key={b} value={b}>{b}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Condition</InputLabel>
              <Select label="Condition" value={condition} onChange={(e) => setCondition(e.target.value as TapeCondition)}>
                <MenuItem value=""><em>None</em></MenuItem>
                {CONDITIONS.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Speed</InputLabel>
              <Select label="Speed" value={recordingSpeed} onChange={(e) => setRecordingSpeed(e.target.value as RecordingSpeed)}>
                <MenuItem value=""><em>None</em></MenuItem>
                {SPEEDS.map((s) => <MenuItem key={s} value={s}>{s.toUpperCase()}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
          <TextField
            label="Purchase Date" type="date" value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)} fullWidth size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Label Notes" value={labelNotes} onChange={(e) => setLabelNotes(e.target.value)}
            fullWidth multiline minRows={2} size="small"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Tape'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

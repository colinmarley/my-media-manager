'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from '@mui/material';
import { addWishlistItem, validateWishlistItem, WISHLIST_LIMITS } from '@/service/catalog/WishlistService';
import { WishlistItem, WishlistItemInput } from '@/types/catalog/Wishlist.type';

type FieldErrors = Partial<Record<keyof WishlistItemInput, string>>;

export default function WishlistAddDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (item: WishlistItem) => void;
}) {
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState('');
  const [year, setYear] = useState('');
  const [barcode, setBarcode] = useState('');
  const [imdbId, setImdbId] = useState('');
  const [notes, setNotes] = useState('');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setFormat('');
    setYear('');
    setBarcode('');
    setImdbId('');
    setNotes('');
    setFieldErrors({});
    setError('');
  }, [open]);

  const handleSave = async () => {
    const payload: WishlistItemInput = {
      title: title.trim(),
      format: format.trim() || undefined,
      year: year.trim() || undefined,
      barcode: barcode.trim() || undefined,
      imdbId: imdbId.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    const errors = validateWishlistItem(payload);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError('');
    try {
      const saved = await addWishlistItem(payload);
      onSaved(saved);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add wishlist item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add to Wishlist</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={!!fieldErrors.title}
            helperText={fieldErrors.title}
            slotProps={{ htmlInput: { maxLength: WISHLIST_LIMITS.title } }}
            required
            fullWidth
            autoFocus
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Format" value={format} onChange={(e) => setFormat(e.target.value)}
              placeholder="Blu-ray" error={!!fieldErrors.format} helperText={fieldErrors.format}
              fullWidth size="small"
            />
            <TextField
              label="Year" value={year} onChange={(e) => setYear(e.target.value)}
              error={!!fieldErrors.year} helperText={fieldErrors.year}
              fullWidth size="small"
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)}
              error={!!fieldErrors.barcode} helperText={fieldErrors.barcode}
              fullWidth size="small"
            />
            <TextField
              label="IMDb ID" value={imdbId} onChange={(e) => setImdbId(e.target.value)}
              placeholder="tt0133093" error={!!fieldErrors.imdbId} helperText={fieldErrors.imdbId}
              fullWidth size="small"
            />
          </Stack>
          <TextField
            label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)}
            error={!!fieldErrors.notes} helperText={fieldErrors.notes}
            fullWidth multiline minRows={2} size="small"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

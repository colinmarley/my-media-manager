'use client';

import React, { useId } from 'react';
import { FormControl, InputLabel, MenuItem, Select, Stack, TextField } from '@mui/material';
import { StorageType } from '@/types/catalog/Common.type';
import { STORAGE_TYPES } from '@/utils/storageLocation';

// Box/Binder picker + MED#### ID, shared by the disc and tape edit dialogs.
// Choosing "None" clears the location on save.
export default function StorageLocationFields({
  storageType,
  storageId,
  error,
  onTypeChange,
  onIdChange,
}: {
  storageType: StorageType | '';
  storageId: string;
  error?: string;
  onTypeChange: (value: StorageType | '') => void;
  onIdChange: (value: string) => void;
}) {
  const labelId = useId();
  return (
    <Stack direction="row" spacing={2}>
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id={labelId}>Storage</InputLabel>
        <Select
          labelId={labelId}
          label="Storage"
          value={storageType}
          onChange={(e) => {
            const value = e.target.value as StorageType | '';
            onTypeChange(value);
            if (!value) onIdChange('');
          }}
        >
          <MenuItem value=""><em>None</em></MenuItem>
          {STORAGE_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
        </Select>
      </FormControl>
      <TextField
        label="Storage ID" value={storageId} onChange={(e) => onIdChange(e.target.value)}
        placeholder="MED0001" fullWidth size="small" disabled={!storageType}
        error={!!error} helperText={error || (storageType ? 'MED followed by 4 digits' : ' ')}
      />
    </Stack>
  );
}

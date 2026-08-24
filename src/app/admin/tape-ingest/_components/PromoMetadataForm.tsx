'use client';
import React, { useState } from 'react';
import { Box, FormControl, FormLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { PromoMetadata, PromoTargetType } from '@/types/tape-ingest/TapeIngest.type';

const CURRENT_YEAR = new Date().getFullYear();
const TARGET_TYPE_LABELS: Record<PromoTargetType, string> = {
  company: 'Company', movie: 'Movie', show: 'TV Show', product: 'Product', other: 'Other',
};
const TARGET_TYPES: PromoTargetType[] = ['company', 'movie', 'show', 'product', 'other'];

interface Props { value: PromoMetadata; type: 'trailer' | 'commercial'; onChange: (m: PromoMetadata) => void; }

export default function PromoMetadataForm({ value, type, onChange }: Props) {
  const update = (patch: Partial<PromoMetadata>) => onChange({ ...value, ...patch });
  const [yearError, setYearError] = useState('');

  return (
    <Box sx={{ mt: 1 }}>
      <Stack spacing={2}>
        <TextField label={type === 'trailer' ? 'Trailer Title' : 'Commercial Title'} size="small" required fullWidth
          value={value.title} onChange={(e) => update({ title: e.target.value })}
          placeholder={type === 'trailer' ? 'Teaser Trailer #1, Official Trailer, ...' : 'Super Bowl Spot, TV Ad 30s, ...'} />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <FormLabel sx={{ mb: 0.5, fontSize: 13 }}>What is it for?</FormLabel>
            <Select value={value.targetType} onChange={(e) => update({ targetType: e.target.value as PromoTargetType })}>
              {TARGET_TYPES.map((t) => <MenuItem key={t} value={t}>{TARGET_TYPE_LABELS[t]}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Target Name" size="small" required fullWidth value={value.targetName}
            onChange={(e) => update({ targetName: e.target.value })}
            placeholder="Coca-Cola, Back to the Future, Friends, ..." sx={{ flex: 1 }} />
          <TextField label="Year" size="small" type="number"
            slotProps={{ htmlInput: { min: 1888, max: CURRENT_YEAR } }}
            value={value.year ?? ''} error={!!yearError} helperText={yearError || 'Optional'}
            onChange={(e) => {
              const raw = e.target.value.trim(); const num = parseInt(raw, 10);
              setYearError(!raw ? '' : (isNaN(num) || num < 1888 || num > CURRENT_YEAR) ? `1888 – ${CURRENT_YEAR}` : '');
              update({ year: raw ? num : undefined });
            }} sx={{ width: 120 }} />
        </Stack>

        <TextField label="Notes" size="small" fullWidth multiline minRows={2}
          value={value.description ?? ''} onChange={(e) => update({ description: e.target.value })}
          placeholder="Optional context about this trailer/commercial" />

        <Box sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">File will be saved as:</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {value.title ? `${value.title.trim().replace(/\s+/g, '_')}.mp4` : '—'}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

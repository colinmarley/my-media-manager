'use client';

import React from 'react';
import { Chip, FormControl, MenuItem, Select } from '@mui/material';
import { EXTRAS_CATEGORIES, EXTRAS_CATEGORY_LABELS, ExtrasCategory } from '@/types/disc-ripper/DiscRipper.type';

/**
 * Compact per-title extras-taxonomy picker for the title selection list in
 * ConfigureStep. Mirrors tape-ingest's ContentTypeSelector.tsx conceptually
 * (categorized selection with a confirming Chip) but as a Select dropdown
 * rather than a ButtonGroup, since it needs to fit inline in a dense per-title
 * row alongside the show episode-assignment control.
 *
 * "Main Feature" (empty string) means this title is NOT an extra — it's
 * handled by the normal movie/episode naming logic in _build_dest_name.
 */
export default function ExtrasTypeSelector({
  value,
  onChange,
}: {
  value: ExtrasCategory | '';
  onChange: (value: ExtrasCategory | '') => void;
}) {
  return (
    <FormControl size="small" sx={{ minWidth: 180 }}>
      <Select
        value={value}
        displayEmpty
        onChange={(e) => onChange(e.target.value as ExtrasCategory | '')}
      >
        <MenuItem value="">
          <em>Main Feature</em>
        </MenuItem>
        {EXTRAS_CATEGORIES.map((category) => (
          <MenuItem key={category} value={category}>
            {EXTRAS_CATEGORY_LABELS[category]}
          </MenuItem>
        ))}
      </Select>
      {value !== '' && (
        <Chip
          label={EXTRAS_CATEGORY_LABELS[value]}
          size="small"
          color="secondary"
          variant="outlined"
          sx={{ mt: 0.5, alignSelf: 'flex-start' }}
        />
      )}
    </FormControl>
  );
}

'use client';
import React from 'react';
import {
  Box, Divider, FormControl, FormLabel, MenuItem, Select,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import {
  TapeBrand, TapeCondition, TapePhysicalMetadata, TapeType, RecordingSpeed,
} from '@/types/tape-ingest/TapeIngest.type';
import TapeImageUploader from './TapeImageUploader';

const BRANDS: TapeBrand[] = [
  'TDK', 'Maxell', 'Sony', 'BASF', 'Fuji',
  'Scotch', 'Memorex', 'Ampex', 'Generic', 'Unknown',
];
const CONDITIONS: { value: TapeCondition; label: string }[] = [
  { value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' }, { value: 'unknown', label: 'Unknown' },
];
const SPEEDS: { value: RecordingSpeed; label: string; hint: string }[] = [
  { value: 'sp', label: 'SP', hint: 'Standard Play — best quality' },
  { value: 'lp', label: 'LP', hint: 'Long Play — 2× duration' },
  { value: 'ep', label: 'EP', hint: 'Extended Play — 3× duration' },
  { value: 'unknown', label: '?', hint: 'Unknown' },
];

const TAPE_ID_PATTERN = /^[A-Z0-9_-]*$/i;

interface TapePhysicalMetadataFormProps {
  value: TapePhysicalMetadata;
  tapeType: TapeType;
  tapeId?: string;
  onChange: (meta: TapePhysicalMetadata) => void;
  onTapeIdChange?: (id: string) => void;
}

export default function TapePhysicalMetadataForm({
  value, tapeType, tapeId = '', onChange, onTapeIdChange,
}: TapePhysicalMetadataFormProps) {
  const update = (patch: Partial<TapePhysicalMetadata>) => onChange({ ...value, ...patch });
  const isMiniDv = tapeType === 'mini_dv';

  const handleTapeIdChange = (raw: string) => {
    // Allow only alphanumeric, underscores, hyphens — auto-uppercase
    const clean = raw.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    onTapeIdChange?.(clean);
  };

  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        Physical Tape Details
      </Typography>

      <Stack spacing={2}>
        {/* Tape ID */}
        {onTapeIdChange !== undefined && (
          <TextField
            label="Tape ID"
            size="small"
            value={tapeId}
            onChange={(e) => handleTapeIdChange(e.target.value)}
            placeholder="VHSC_0001"
            helperText="Unique identifier for the physical tape — used to organise archive photos"
            slotProps={{
              htmlInput: { style: { fontFamily: 'monospace', letterSpacing: '0.05em' } },
            }}
            sx={{ maxWidth: 260 }}
          />
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {/* Brand */}
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <FormLabel sx={{ fontSize: 13, mb: 0.5 }}>Brand / Stock</FormLabel>
            <Select
              value={value.brand}
              onChange={(e) => update({ brand: e.target.value as TapeBrand })}
            >
              {BRANDS.map((b) => <MenuItem key={b} value={b}>{b}</MenuItem>)}
            </Select>
          </FormControl>

          {/* Recording speed */}
          <FormControl size="small" disabled={isMiniDv}>
            <FormLabel sx={{ fontSize: 13, mb: 0.5 }}>
              Recording Speed
              {isMiniDv && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                  (N/A for Mini DV)
                </Typography>
              )}
            </FormLabel>
            <ToggleButtonGroup
              size="small" exclusive
              value={isMiniDv ? null : value.recordingSpeed}
              onChange={(_, v: RecordingSpeed | null) => { if (!isMiniDv && v) update({ recordingSpeed: v }); }}
            >
              {SPEEDS.map(({ value: sv, label, hint }) => (
                <ToggleButton key={sv} value={sv} title={hint} disabled={isMiniDv}>{label}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </FormControl>
        </Stack>

        {/* Condition */}
        <FormControl>
          <FormLabel sx={{ fontSize: 13, mb: 0.5 }}>Tape Condition</FormLabel>
          <ToggleButtonGroup
            size="small" exclusive value={value.condition}
            onChange={(_, v: TapeCondition | null) => v && update({ condition: v })}
          >
            {CONDITIONS.map(({ value: cv, label }) => (
              <ToggleButton key={cv} value={cv}>{label}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        </FormControl>

        {/* Label / Notes */}
        <TextField
          label="Label / Written Notes" size="small" fullWidth multiline minRows={2}
          value={value.labelNotes}
          onChange={(e) => update({ labelNotes: e.target.value })}
          placeholder="What's written on the tape label, e.g. 'Christmas 1993 + Vacation'"
        />

        {/* Image uploader — only shown when a tape ID is set */}
        {tapeId && (
          <>
            <Divider />
            <TapeImageUploader tapeId={tapeId} />
          </>
        )}
      </Stack>
    </Box>
  );
}

'use client';
import React, { useEffect, useState } from 'react';
import { Autocomplete, Box, Chip, FormControl, FormLabel, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { HomeVideoMetadata, DateMode } from '@/types/tape-ingest/TapeIngest.type';
import TapeIngestService from '@/service/tape-ingest/TapeIngestService';

const CURRENT_YEAR = new Date().getFullYear();

function buildFilenamePreview(m: HomeVideoMetadata): string {
  if (!m.title) return '—';
  const datePart = !m.date ? '' : m.dateMode === 'range' && m.dateEnd ? `${m.date}_to_${m.dateEnd}` : m.date;
  const slug = m.title.trim().replace(/\s+/g, '_');
  return datePart ? `${datePart}_${slug}.mp4` : `${slug}.mp4`;
}

interface Props { value: HomeVideoMetadata; onChange: (m: HomeVideoMetadata) => void; }

export default function HomeVideoForm({ value, onChange }: Props) {
  const update = (patch: Partial<HomeVideoMetadata>) => onChange({ ...value, ...patch });
  const [knownPeople, setKnownPeople] = useState<string[]>([]);
  const [titleError, setTitleError] = useState('');
  const [dateError, setDateError] = useState('');

  useEffect(() => { TapeIngestService.getKnownPeople().then(setKnownPeople).catch(() => {}); }, []);

  return (
    <Box sx={{ mt: 1 }}>
      <Stack spacing={2}>
        <TextField label="Title" size="small" required fullWidth value={value.title}
          onChange={(e) => { update({ title: e.target.value }); if (titleError && e.target.value.trim()) setTitleError(''); }}
          onBlur={() => setTitleError(value.title.trim() ? '' : 'Title is required')}
          error={!!titleError} helperText={titleError || undefined}
          placeholder="Christmas Morning, Wedding Reception, …" />

        <FormControl>
          <FormLabel sx={{ fontSize: 13, mb: 0.5 }}>Date</FormLabel>
          <ToggleButtonGroup size="small" exclusive value={value.dateMode}
            onChange={(_, v: DateMode | null) => { if (v) { update({ dateMode: v, date: '', dateEnd: '' }); setDateError(''); } }}>
            <ToggleButton value="exact">Exact date</ToggleButton>
            <ToggleButton value="year">Year only</ToggleButton>
            <ToggleButton value="range">Date range</ToggleButton>
          </ToggleButtonGroup>
        </FormControl>

        {value.dateMode === 'exact' && (
          <TextField label="Date" size="small" type="date" value={value.date ?? ''}
            onChange={(e) => update({ date: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
        )}
        {value.dateMode === 'year' && (
          <TextField label="Year" size="small" type="number"
            slotProps={{ htmlInput: { min: 1888, max: CURRENT_YEAR } }}
            value={value.date ?? ''} error={!!dateError} helperText={dateError || `1888 – ${CURRENT_YEAR}`}
            onChange={(e) => {
              const raw = e.target.value; const num = parseInt(raw, 10);
              setDateError(!raw ? '' : (isNaN(num) || num < 1888 || num > CURRENT_YEAR) ? `Enter a year between 1888 and ${CURRENT_YEAR}` : '');
              update({ date: raw });
            }} />
        )}
        {value.dateMode === 'range' && (
          <Stack direction="row" spacing={1}>
            <TextField label="Start" size="small" type="date" value={value.date ?? ''}
              onChange={(e) => update({ date: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
            <TextField label="End" size="small" type="date" value={value.dateEnd ?? ''}
              onChange={(e) => update({ dateEnd: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
          </Stack>
        )}

        <Autocomplete multiple freeSolo options={knownPeople} value={value.people}
          onChange={(_, newVal) => update({ people: newVal as string[] })}
          renderTags={(val, getTagProps) => val.map((option, index) => (
            <Chip label={option} size="small" {...getTagProps({ index })} key={option} />
          ))}
          renderInput={(params) => (
            <TextField {...params} size="small" label="People"
              placeholder="Type a name and press Enter"
              helperText="Previously entered names appear as suggestions" />
          )} />

        <TextField label="Location" size="small" fullWidth value={value.location ?? ''}
          onChange={(e) => update({ location: e.target.value })} placeholder="Grandma's House, Lake Tahoe, …" />
        <TextField label="Description" size="small" fullWidth multiline minRows={2}
          value={value.description ?? ''} onChange={(e) => update({ description: e.target.value })} />

        <Box sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">File will be saved as:</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {buildFilenamePreview(value)}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

'use client';
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Container, Divider, FormControl, FormLabel, MenuItem, Select, Slider, Stack, TextField, Typography } from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import TapeIngestService from '@/service/tape-ingest/TapeIngestService';
import { TapeIngestSettings } from '@/types/tape-ingest/TapeIngest.type';

const FFMPEG_PRESETS = ['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'];
const CRF_MARKS = [{ value: 0, label: '0' }, { value: 18, label: '18' }, { value: 23, label: '23' }, { value: 28, label: '28' }, { value: 51, label: '51' }];

export default function SettingsPage() {
  const [settings, setSettings] = useState<TapeIngestSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    TapeIngestService.getSettings().then(setSettings).catch(() => setError('Could not load settings — is the backend running?')).finally(() => setLoading(false));
  }, []);

  const update = (patch: Partial<TapeIngestSettings>) => setSettings((prev) => prev ? { ...prev, ...patch } : prev);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true); setError(null); setSaved(false);
    try { await TapeIngestService.saveSettings(settings); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    catch { setError('Failed to save settings.'); }
    finally { setSaving(false); }
  };

  if (loading) return <Container maxWidth="sm" sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Container>;

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>Settings</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure default paths and encoding quality for tape ingest.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {saved && <Alert severity="success" sx={{ mb: 2 }}>Settings saved.</Alert>}

      <Stack spacing={3}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>Tape Ingest Paths</Typography>
          <Stack spacing={2}>
            <TextField label="Ingress Folder" size="small" fullWidth value={settings?.ingress_folder ?? ''}
              onChange={(e) => update({ ingress_folder: e.target.value })}
              helperText="Local folder where edited files are dropped before classification. Leave blank to always browse manually."
              placeholder="/ark/media/ingest" />
            <TextField label="Destination Base Path" size="small" fullWidth value={settings?.destination_base ?? ''}
              onChange={(e) => update({ destination_base: e.target.value })}
              helperText="Root under which Movies/, TV Shows/, Home Videos/ etc. will be created."
              placeholder="/ark/media/jellyfin" />
          </Stack>
        </Box>

        <Divider />

        <Box>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>FFmpeg Quality (VHS / VHS-C post-processing)</Typography>
          <Stack spacing={3}>
            <Box>
              <FormLabel sx={{ fontSize: 13, display: 'block', mb: 1 }}>
                CRF — {settings?.ffmpeg_crf ?? 20}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>(lower = better quality, larger file)</Typography>
              </FormLabel>
              <Slider value={settings?.ffmpeg_crf ?? 20} onChange={(_, v) => update({ ffmpeg_crf: v as number })}
                min={0} max={51} step={1} marks={CRF_MARKS} valueLabelDisplay="auto" sx={{ mt: 1 }} />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">High quality / large</Typography>
                <Typography variant="caption" color="text.secondary">Low quality / small</Typography>
              </Stack>
            </Box>
            <FormControl size="small" sx={{ maxWidth: 240 }}>
              <FormLabel sx={{ fontSize: 13, mb: 0.5 }}>Encoding Speed (Preset)</FormLabel>
              <Select value={settings?.ffmpeg_preset ?? 'medium'} onChange={(e) => update({ ffmpeg_preset: e.target.value })}>
                {FFMPEG_PRESETS.map((p) => <MenuItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}{p === 'medium' ? ' (default)' : ''}</MenuItem>)}
              </Select>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>Slower preset = better compression at same CRF.</Typography>
            </FormControl>
          </Stack>
        </Box>

        <Box>
          <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            onClick={handleSave} disabled={saving || !settings}>
            Save Settings
          </Button>
        </Box>
      </Stack>
    </Container>
  );
}

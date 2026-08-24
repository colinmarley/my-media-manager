'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Save, RestartAlt } from '@mui/icons-material';
import IngressAutomationService, { IngressConfig } from '@/service/ingress/IngressAutomationService';

const METADATA_SOURCE_OPTIONS: { value: IngressConfig['defaultMetadataSource']; label: string; description: string }[] = [
  { value: 'library_then_omdb', label: 'Library first, then OMDB', description: 'Match against your existing library before querying OMDB. Recommended.' },
  { value: 'omdb_only', label: 'OMDB only', description: 'Always query OMDB for matches. Skips local library lookup.' },
  { value: 'tmdb_only', label: 'TMDB only', description: 'Always query TMDB for matches. Requires a TMDB API key.' },
  { value: 'library_only', label: 'Library only', description: 'Only match against your existing library. No external API calls.' },
];

export default function SettingsPage() {
  const [config, setConfig] = useState<IngressConfig | null>(null);
  const [draft, setDraft] = useState<Partial<IngressConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const DEFAULT_DRAFT: Partial<IngressConfig> = {
    defaultIngressPaths: ['/data/media/encoded'],
    jellyfinDestBase: '/ark/media/jellyfin',
    autoAssignThreshold: 80,
    autoOrganizeEnabled: true,
    autoProcessEnabled: true,
    autoProcessIntervalSeconds: 2,
    fileStabilityWaitSeconds: 10,
    debounceSeconds: 5,
    defaultMetadataSource: 'library_then_omdb',
  };

  const populateDraft = (cfg: IngressConfig) => ({
    defaultIngressPaths: cfg.defaultIngressPaths ?? DEFAULT_DRAFT.defaultIngressPaths,
    jellyfinDestBase: cfg.jellyfinDestBase ?? DEFAULT_DRAFT.jellyfinDestBase,
    autoAssignThreshold: cfg.autoAssignThreshold ?? DEFAULT_DRAFT.autoAssignThreshold,
    autoOrganizeEnabled: cfg.autoOrganizeEnabled ?? DEFAULT_DRAFT.autoOrganizeEnabled,
    autoProcessEnabled: cfg.autoProcessEnabled ?? DEFAULT_DRAFT.autoProcessEnabled,
    autoProcessIntervalSeconds: cfg.autoProcessIntervalSeconds ?? DEFAULT_DRAFT.autoProcessIntervalSeconds,
    fileStabilityWaitSeconds: cfg.fileStabilityWaitSeconds ?? DEFAULT_DRAFT.fileStabilityWaitSeconds,
    debounceSeconds: cfg.debounceSeconds ?? DEFAULT_DRAFT.debounceSeconds,
    defaultMetadataSource: cfg.defaultMetadataSource ?? DEFAULT_DRAFT.defaultMetadataSource,
  });

  useEffect(() => {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 8000)
    );

    Promise.race([IngressAutomationService.getConfig(), timeout])
      .then((cfg) => {
        setConfig(cfg as IngressConfig);
        setDraft(populateDraft(cfg as IngressConfig));
      })
      .catch((err) => {
        const msg = err?.message === 'timeout'
          ? 'Settings could not be loaded — backend did not respond in time. Showing defaults.'
          : (err?.message || 'Could not reach backend. Showing defaults.');
        setError(msg);
        setDraft(DEFAULT_DRAFT);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await IngressAutomationService.updateConfig(draft);
      setConfig(updated);
      setDraft({
        defaultIngressPaths: updated.defaultIngressPaths,
        jellyfinDestBase: updated.jellyfinDestBase,
        autoAssignThreshold: updated.autoAssignThreshold,
        autoOrganizeEnabled: updated.autoOrganizeEnabled,
        autoProcessEnabled: updated.autoProcessEnabled,
        autoProcessIntervalSeconds: updated.autoProcessIntervalSeconds,
        fileStabilityWaitSeconds: updated.fileStabilityWaitSeconds,
        debounceSeconds: updated.debounceSeconds,
        defaultMetadataSource: updated.defaultMetadataSource,
      });
      setSuccess('Settings saved successfully.');
    } catch (err: any) {
      setError(err?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(config ? populateDraft(config) : DEFAULT_DRAFT);
    setError(null);
    setSuccess(null);
  };

  const setField = <K extends keyof IngressConfig>(key: K, value: IngressConfig[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSuccess(null);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', py: 3, px: 2 }}>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure the automation pipeline, folder paths, and media metadata preferences. Changes are saved to the backend and persisted across restarts.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      {/* ── Folder Paths ─────────────────────────────────────────────── */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Folder Paths</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The source folder is watched for newly encoded files. The destination folder is where Jellyfin‑compliant media is organized.
          </Typography>
          <Stack spacing={2}>
            <Box>
              <TextField
                label="Source (Encoded) Folder"
                fullWidth
                value={(draft.defaultIngressPaths ?? []).join('\n')}
                onChange={(e) =>
                  setField(
                    'defaultIngressPaths',
                    e.target.value
                      .split('\n')
                      .map((l) => l.trim())
                      .filter(Boolean)
                  )
                }
                multiline
                minRows={2}
                helperText="One folder path per line. The file watcher monitors these directories for new media files."
                placeholder="/data/media/encoded"
              />
            </Box>
            <Box>
              <TextField
                label="Destination (Jellyfin) Folder"
                fullWidth
                value={draft.jellyfinDestBase ?? ''}
                onChange={(e) => setField('jellyfinDestBase', e.target.value)}
                helperText="Root path where movies and shows are organized into Jellyfin‑compliant folder structures."
                placeholder="/ark/media/jellyfin"
              />
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* ── Media Metadata ───────────────────────────────────────────── */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Media Metadata Source</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Controls where the automation looks for media information when matching files.
          </Typography>
          <FormControl fullWidth>
            <InputLabel>Default Metadata Source</InputLabel>
            <Select
              label="Default Metadata Source"
              value={draft.defaultMetadataSource ?? 'library_then_omdb'}
              onChange={(e) => setField('defaultMetadataSource', e.target.value as IngressConfig['defaultMetadataSource'])}
            >
              {METADATA_SOURCE_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  <Box>
                    <Typography variant="body2">{opt.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{opt.description}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>
              {METADATA_SOURCE_OPTIONS.find((o) => o.value === draft.defaultMetadataSource)?.description}
            </FormHelperText>
          </FormControl>
        </CardContent>
      </Card>

      {/* ── Automation Behaviour ─────────────────────────────────────── */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Automation Behaviour</Typography>

          <Stack spacing={3}>
            <FormControlLabel
              control={
                <Switch
                  checked={draft.autoProcessEnabled ?? true}
                  onChange={(e) => setField('autoProcessEnabled', e.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">Auto-process pending queue items</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Automatically process files in the queue on a regular interval.
                  </Typography>
                </Box>
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={draft.autoOrganizeEnabled ?? true}
                  onChange={(e) => setField('autoOrganizeEnabled', e.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">Auto-organize matched files</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Move files to the Jellyfin destination folder automatically when confidence meets the threshold.
                  </Typography>
                </Box>
              }
            />

            <Divider />

            <Box>
              <Typography variant="body2" gutterBottom>
                Auto-assign confidence threshold: <strong>{draft.autoAssignThreshold ?? 80}%</strong>
              </Typography>
              <Slider
                value={draft.autoAssignThreshold ?? 80}
                onChange={(_e, val) => setField('autoAssignThreshold', val as number)}
                min={0}
                max={100}
                step={5}
                marks={[
                  { value: 0, label: '0%' },
                  { value: 50, label: '50%' },
                  { value: 80, label: '80%' },
                  { value: 100, label: '100%' },
                ]}
                valueLabelDisplay="auto"
              />
              <FormHelperText>
                Files with a match confidence at or above this threshold will be automatically assigned and organized.
                Items below this threshold will appear in the queue for manual review.
              </FormHelperText>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* ── Timing ───────────────────────────────────────────────────── */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Timing</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Controls how quickly the watcher reacts to new files and how often the queue processor runs.
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="File stability wait (seconds)"
              type="number"
              value={draft.fileStabilityWaitSeconds ?? 10}
              onChange={(e) => setField('fileStabilityWaitSeconds', Number(e.target.value))}
              inputProps={{ min: 1 }}
              helperText="How long the watcher waits after detecting a file before processing it. Prevents reading files that are still being written."
              fullWidth
            />
            <TextField
              label="Event debounce (seconds)"
              type="number"
              value={draft.debounceSeconds ?? 5}
              onChange={(e) => setField('debounceSeconds', Number(e.target.value))}
              inputProps={{ min: 0 }}
              helperText="Minimum quiet period before re-triggering detection for the same file. Reduces duplicate events."
              fullWidth
            />
            <TextField
              label="Auto-process interval (seconds)"
              type="number"
              value={draft.autoProcessIntervalSeconds ?? 2}
              onChange={(e) => setField('autoProcessIntervalSeconds', Number(e.target.value))}
              inputProps={{ min: 1 }}
              helperText="How often the background processor checks the queue for pending items."
              fullWidth
            />
          </Stack>
        </CardContent>
      </Card>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button
          startIcon={<RestartAlt />}
          onClick={handleReset}
          disabled={saving}
        >
          Reset
        </Button>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save />}
          onClick={handleSave}
          disabled={saving}
        >
          Save Settings
        </Button>
      </Box>
    </Box>
  );
}

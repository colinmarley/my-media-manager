'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse,
  Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Snackbar, Stack,
  TextField, Tooltip, Typography,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ReplayIcon from '@mui/icons-material/Replay';
import { DiscRipperService } from '@/service/disc-ripper/DiscRipperService';
import type { JobAnalysis, RipJob } from '@/types/disc-ripper/DiscRipper.type';
import { fmtDur } from './discRipperUtils';

export default function ResultsStep({
  jobs,
  selectedJobId,
  onSelectJob,
  onQueued,
  onRetry,
}: {
  jobs: RipJob[];
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  onQueued: (jobId: string) => void;
  onRetry: (jobId: string) => void;
}) {
  const terminalJobs = jobs.filter((j) => j.status === 'done' || j.status === 'failed');
  const effectiveJobId = selectedJobId ?? terminalJobs[0]?.id ?? null;
  const sourceJob = terminalJobs.find((j) => j.id === effectiveJobId) ?? null;

  const [localPaths, setLocalPaths] = useState<string[]>([]);
  const [editNames, setEditNames] = useState<Record<number, string>>({});
  const [editEpCodes, setEditEpCodes] = useState<Record<number, string>>({});
  const [expandedVideo, setExpandedVideo] = useState<number | null>(null);
  const [videoErrors, setVideoErrors] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [saveErrors, setSaveErrors] = useState<Record<number, string>>({});
  const [durations, setDurations] = useState<Record<number, number>>({});

  const basename = (p: string) => p.split('/').pop() ?? p;

  const extractEpCode = (name: string) => {
    const m = name.match(/^(S\d+E\d+)/i);
    return m ? m[1].toUpperCase() : null;
  };

  useEffect(() => {
    if (!sourceJob) return;
    const paths = [...sourceJob.output_paths];
    setLocalPaths(paths);
    const names: Record<number, string> = {};
    const codes: Record<number, string> = {};
    paths.forEach((p, i) => {
      const n = basename(p);
      names[i] = n;
      codes[i] = extractEpCode(n) ?? '';
    });
    setEditNames(names);
    setEditEpCodes(codes);
    setExpandedVideo(null);
    setSaveErrors({});
    setVideoErrors({});
    setDurations({});
    setIngestResult(null);

    // Fetch duration for each output file in parallel (ffprobe reads MKV header only)
    if (sourceJob) {
      paths.forEach((_, i) => {
        DiscRipperService.getFileDuration(sourceJob.id, i).then((d) => {
          if (d !== null) setDurations((prev) => ({ ...prev, [i]: d }));
        });
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceJob?.id]);

  const handleEpCodeChange = (i: number, code: string) => {
    const upper = code.toUpperCase();
    setEditEpCodes((prev) => ({ ...prev, [i]: upper }));
    const current = editNames[i] ?? basename(localPaths[i] ?? '');
    if (/^S\d+E\d+/i.test(current)) {
      setEditNames((prev) => ({ ...prev, [i]: current.replace(/^S\d+E\d+/i, upper) }));
    }
  };

  const saveRename = async (i: number) => {
    if (!sourceJob) return;
    setSaving((prev) => ({ ...prev, [i]: true }));
    setSaveErrors((prev) => ({ ...prev, [i]: '' }));
    try {
      const updated = await DiscRipperService.renameFile(sourceJob.id, i, editNames[i]);
      const newPaths = updated.output_paths;
      setLocalPaths(newPaths);
      const newName = basename(newPaths[i]);
      setEditNames((prev) => ({ ...prev, [i]: newName }));
      setEditEpCodes((prev) => ({ ...prev, [i]: extractEpCode(newName) ?? '' }));
    } catch (e: unknown) {
      setSaveErrors((prev) => ({ ...prev, [i]: e instanceof Error ? e.message : 'Rename failed' }));
    } finally {
      setSaving((prev) => ({ ...prev, [i]: false }));
    }
  };

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [copiedAnalysis, setCopiedAnalysis] = useState(false);

  const [queueStatuses, setQueueStatuses] = useState<Record<string, string> | null>(null);
  const [queueCheckLoading, setQueueCheckLoading] = useState(false);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [ingestConfirmOpen, setIngestConfirmOpen] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchSaveMsg, setBatchSaveMsg] = useState('');

  const checkQueueStatuses = async (paths: string[]) => {
    if (!paths.length) return;
    setQueueCheckLoading(true);
    try {
      const res = await fetch('/api/backend/api/ingress/queue');
      if (!res.ok) return;
      const data = await res.json();
      const items: Array<{ file_path: string; status: string }> = data?.data?.items ?? data?.data ?? [];
      const statusMap: Record<string, string> = {};
      for (const item of items) {
        if (paths.includes(item.file_path)) {
          statusMap[item.file_path] = item.status;
        }
      }
      setQueueStatuses(statusMap);
    } catch {
      // leave queueStatuses null — show fallback button
    } finally {
      setQueueCheckLoading(false);
    }
  };

  useEffect(() => {
    setAnalysis(null);
    setAnalyzeError('');
    if (sourceJob?.status === 'failed') {
      DiscRipperService.getJobAnalysis(sourceJob.id).then((a) => {
        if (a) setAnalysis(a);
      }).catch(() => {/* no prior analysis */});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceJob?.id]);

  const analyzeJobFn = async () => {
    if (!sourceJob) return;
    setAnalyzing(true);
    setAnalyzeError('');
    try {
      const a = await DiscRipperService.analyzeJob(sourceJob.id);
      setAnalysis(a);
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : 'Analysis failed — is Ollama reachable?');
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    setQueueStatuses(null);
    setIngestResult(null);
    if (localPaths.length) checkQueueStatuses(localPaths);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceJob?.id, localPaths.join(',')]);

  // Auto-refresh ingest queue status while any file is in a non-terminal state
  useEffect(() => {
    if (!localPaths.length || !queueStatuses) return;
    const hasNonTerminal = localPaths.some((p) => {
      const s = queueStatuses[p];
      return !s || (s !== 'completed' && s !== 'failed');
    });
    if (!hasNonTerminal) return;
    const interval = setInterval(() => checkQueueStatuses(localPaths), 5000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPaths, queueStatuses]);

  const sendToIngest = async () => {
    if (!sourceJob) return;
    setIngestLoading(true);
    setIngestResult(null);
    try {
      const res = await fetch('/api/backend/api/ingress/queue/add-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePaths: localPaths }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      const added = data.data?.added?.length ?? 0;
      const skipped = data.data?.skipped?.length ?? 0;
      const errors = data.data?.errors ?? [];
      let msg = `${added} file(s) added to ingest queue`;
      if (skipped > 0) msg += `, ${skipped} skipped (already queued)`;
      if (errors.length > 0) msg += ` — ${errors.map((e: { reason: string }) => e.reason).join('; ')}`;
      setIngestResult({ ok: errors.length === 0, msg });
      if (errors.length === 0) onQueued(sourceJob.id);
      await checkQueueStatuses(localPaths);
    } catch (e: unknown) {
      setIngestResult({ ok: false, msg: e instanceof Error ? e.message : 'Failed to add to ingest queue' });
    } finally {
      setIngestLoading(false);
    }
  };

  const saveAll = async () => {
    if (!sourceJob) return;
    const dirtyIndices = localPaths
      .map((p, i) => ({ i, dirty: editNames[i] !== basename(p) && (editNames[i] ?? '').endsWith('.mkv') }))
      .filter((x) => x.dirty)
      .map((x) => x.i);
    if (!dirtyIndices.length) return;
    setBatchSaving(true);
    for (let n = 0; n < dirtyIndices.length; n++) {
      setBatchSaveMsg(`Saving ${n + 1} of ${dirtyIndices.length}…`);
      await saveRename(dirtyIndices[n]);
    }
    setBatchSaving(false);
    setBatchSaveMsg('All renames saved');
  };

  if (terminalJobs.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No completed or failed jobs yet. Run a rip job to see results here.
      </Typography>
    );
  }

  return (
    <Box>
      {terminalJobs.length > 1 && (
        <FormControl size="small" sx={{ mb: 3, minWidth: 320 }}>
          <InputLabel>Job</InputLabel>
          <Select
            label="Job"
            value={effectiveJobId ?? ''}
            onChange={(e) => onSelectJob(e.target.value as string)}
          >
            {terminalJobs.map((j) => (
              <MenuItem key={j.id} value={j.id}>
                {j.title} ({j.year})
                {j.season != null ? ` — S${String(j.season).padStart(2, '0')}` : ''}
                {j.status === 'failed' && (
                  <Chip label="failed" size="small" color="error" variant="outlined" sx={{ ml: 1, height: 16, fontSize: 10 }} />
                )}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {sourceJob?.status === 'failed' && (
        <>
          <Alert
            severity="error"
            sx={{ mb: analyzeError || analysis ? 1 : 2 }}
            action={
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Tooltip title={analysis ? 'Re-analyze with AI' : 'Analyze failure with AI'}>
                  <span>
                    <Button
                      color="inherit"
                      size="small"
                      startIcon={analyzing ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighIcon />}
                      onClick={analyzeJobFn}
                      disabled={analyzing}
                    >
                      {analyzing ? 'Analyzing…' : analysis ? 'Re-analyze' : 'Analyze'}
                    </Button>
                  </span>
                </Tooltip>
                <Button color="inherit" size="small" startIcon={<ReplayIcon />} onClick={() => onRetry(sourceJob.id)}>
                  Retry
                </Button>
              </Stack>
            }
          >
            <strong>Job failed</strong>
            {sourceJob.error ? ` — ${sourceJob.error}` : ''}
            {sourceJob.output_paths.length === 0 && ' No output files were produced.'}
          </Alert>

          {analyzeError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              AI analysis failed: {analyzeError}
            </Alert>
          )}

          {analysis && (
            <Box sx={{ mb: 2, p: 1.5, border: '1px solid', borderColor: 'warning.main', borderRadius: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2">AI Analysis</Typography>
                <Chip
                  label={analysis.error_type.replace(/_/g, ' ')}
                  size="small"
                  color="warning"
                  variant="outlined"
                />
                <Typography variant="caption" color="text.secondary">
                  via {analysis.model_used}
                </Typography>
              </Stack>

              <Typography variant="body2" sx={{ mb: 1.5 }}>
                {analysis.error_summary}
              </Typography>

              {analysis.suggested_fix && (
                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.5 }}>
                    SUGGESTED FIX
                  </Typography>
                  <Typography variant="body2">{analysis.suggested_fix}</Typography>
                </Box>
              )}

              {analysis.claude_prompt && analysis.claude_prompt !== 'No code change needed.' && (
                <Box>
                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      CLAUDE CODE PROMPT
                    </Typography>
                    <Tooltip title={copiedAnalysis ? 'Copied!' : 'Copy to clipboard'}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          navigator.clipboard.writeText(analysis.claude_prompt).then(() => {
                            setCopiedAnalysis(true);
                            setTimeout(() => setCopiedAnalysis(false), 2000);
                          }).catch(() => {/* ignore */});
                        }}
                      >
                        <ContentCopyIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                  <Box
                    component="pre"
                    sx={{
                      bgcolor: '#0d1117', color: '#c9d1d9',
                      fontFamily: 'monospace', fontSize: '0.72rem',
                      p: 1.5, borderRadius: 1,
                      maxHeight: 200, overflowY: 'auto',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      m: 0,
                    }}
                  >
                    {analysis.claude_prompt}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </>
      )}

      {sourceJob && sourceJob.output_paths.length > 0 && (() => {
        const dirtyCount = localPaths.filter((p, i) =>
          editNames[i] !== basename(p) && (editNames[i] ?? '').endsWith('.mkv')
        ).length;
        return (
          <Stack spacing={2}>
            {localPaths.length > 1 && dirtyCount > 0 && (
              <Stack direction="row" justifyContent="flex-end">
                <Button
                  size="small"
                  variant="contained"
                  disabled={batchSaving}
                  startIcon={batchSaving ? <CircularProgress size={14} /> : undefined}
                  onClick={saveAll}
                >
                  {batchSaving ? batchSaveMsg : `Save All (${dirtyCount})`}
                </Button>
              </Stack>
            )}
            {localPaths.map((path, i) => {
            const name = editNames[i] ?? basename(path);
            const isDirty = name !== basename(path);
            const showEpCode = sourceJob.media_type === 'show' && extractEpCode(basename(sourceJob.output_paths[i] ?? '')) !== null;
            const streamUrl = DiscRipperService.streamUrl(sourceJob.id, i);
            const epVal = editEpCodes[i] ?? '';
            const epCodeInvalid = showEpCode && epVal !== '' && !/^S\d{2}E\d{2}/i.test(epVal);

            return (
              <Paper key={i} variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                    {showEpCode && (
                      <TextField
                        label="Episode"
                        size="small"
                        value={epVal}
                        sx={{ width: 120 }}
                        error={epCodeInvalid}
                        helperText={epCodeInvalid ? 'Use S01E02 format' : undefined}
                        slotProps={{ input: { style: { fontFamily: 'monospace' } } }}
                        onChange={(e) => handleEpCodeChange(i, e.target.value)}
                      />
                    )}
                    <TextField
                      label="Filename"
                      size="small"
                      value={name}
                      sx={{ flex: '1 1 280px' }}
                      onChange={(e) => setEditNames((prev) => ({ ...prev, [i]: e.target.value }))}
                    />
                    <Button
                      size="small"
                      variant={isDirty ? 'contained' : 'outlined'}
                      disabled={saving[i] || !name.endsWith('.mkv') || epCodeInvalid}
                      onClick={() => saveRename(i)}
                      startIcon={saving[i] ? <CircularProgress size={14} /> : undefined}
                      sx={{ alignSelf: 'center' }}
                    >
                      Save
                    </Button>
                  </Stack>

                  {saveErrors[i] && (
                    <Alert severity="error" sx={{ py: 0 }}>{saveErrors[i]}</Alert>
                  )}

                  <Stack direction="row" spacing={1.5} alignItems="baseline">
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {path}
                    </Typography>
                    {durations[i] != null ? (
                      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {fmtDur(Math.round(durations[i]))}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                        …
                      </Typography>
                    )}
                  </Stack>

                  <Box>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => {
                        setExpandedVideo(expandedVideo === i ? null : i);
                        setVideoErrors((prev) => ({ ...prev, [i]: '' }));
                      }}
                    >
                      {expandedVideo === i ? 'Hide Preview' : '▶ Preview'}
                    </Button>
                  </Box>

                  <Collapse in={expandedVideo === i} unmountOnExit>
                    <Box sx={{ mt: 0.5 }}>
                      {videoErrors[i] ? (
                        <Alert severity="error">
                          Preview failed — {videoErrors[i]}
                        </Alert>
                      ) : (
                        <>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            Transcoding to H.264 — playback starts in a few seconds…
                          </Typography>
                          <video
                            key={streamUrl}
                            controls
                            preload="auto"
                            src={streamUrl}
                            onError={(e) => {
                              const vid = e.currentTarget as HTMLVideoElement;
                              const code = vid.error?.code;
                              const msg = vid.error?.message ?? '';
                              const labels: Record<number, string> = {
                                1: 'aborted',
                                2: 'network error',
                                3: 'decode error',
                                4: 'format not supported',
                              };
                              const detail = code != null
                                ? `${labels[code] ?? `code ${code}`}${msg ? `: ${msg}` : ''} — src: ${streamUrl}`
                                : `unknown error — src: ${streamUrl}`;
                              setVideoErrors((prev) => ({ ...prev, [i]: detail }));
                            }}
                            style={{ width: '100%', maxHeight: 480, borderRadius: 4, display: 'block' }}
                          />
                        </>
                      )}
                    </Box>
                  </Collapse>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
  );
})()}

      {sourceJob && sourceJob.output_paths.length > 0 && (
        <Box sx={{ mt: 3 }}>
          {ingestResult && (
            <Alert severity={ingestResult.ok ? 'success' : 'error'} sx={{ mb: 1.5 }}>
              {ingestResult.msg}
            </Alert>
          )}

          {queueCheckLoading && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="caption" color="text.secondary">Checking ingest queue…</Typography>
            </Stack>
          )}

          {!queueCheckLoading && queueStatuses !== null && localPaths.every((p) => queueStatuses[p]) && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Files detected in ingest queue — processing automatically:
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {localPaths.map((p) => (
                  <Chip
                    key={p}
                    label={`${p.split('/').pop()} — ${queueStatuses[p]}`}
                    size="small"
                    color={queueStatuses[p] === 'completed' ? 'success' : queueStatuses[p] === 'failed' ? 'error' : 'info'}
                  />
                ))}
              </Stack>
              <Button
                size="small"
                variant="text"
                sx={{ mt: 1 }}
                onClick={() => checkQueueStatuses(localPaths)}
              >
                Refresh Status
              </Button>
            </Box>
          )}

          {!queueCheckLoading && (queueStatuses === null || localPaths.some((p) => !queueStatuses?.[p])) && (
            <Box>
              {queueStatuses !== null && localPaths.some((p) => !queueStatuses[p]) && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  Not yet picked up by watcher — add manually or wait for auto-detection.
                </Typography>
              )}
              <Button
                variant="contained"
                disabled={ingestLoading}
                onClick={() => setIngestConfirmOpen(true)}
                startIcon={ingestLoading ? <CircularProgress size={16} /> : undefined}
              >
                {ingestLoading ? 'Adding…' : 'Add to Ingest Queue'}
              </Button>
            </Box>
          )}
        </Box>
      )}

      {/* ── Ingest confirmation dialog ─────────────────────────────────── */}
      <Dialog open={ingestConfirmOpen} onClose={() => setIngestConfirmOpen(false)}>
        <DialogTitle>Add to Jellyfin ingest queue?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1 }}>
            {localPaths.length} file{localPaths.length !== 1 ? 's' : ''} will be queued for import into your Jellyfin library:
          </DialogContentText>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {localPaths.map((p) => (
              <Box component="li" key={p} sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                {p.split('/').pop()}
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIngestConfirmOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => { setIngestConfirmOpen(false); sendToIngest(); }}
          >
            Add to Queue
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Batch save snackbar ────────────────────────────────────────── */}
      <Snackbar
        open={!!batchSaveMsg && !batchSaving}
        autoHideDuration={3000}
        onClose={() => setBatchSaveMsg('')}
        message={batchSaveMsg}
      />
    </Box>
  );
}

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, Paper, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip, Typography,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplayIcon from '@mui/icons-material/Replay';
import StopIcon from '@mui/icons-material/Stop';
import { DiscRipperService } from '@/service/disc-ripper/DiscRipperService';
import type { JobAnalysis, RipJob } from '@/types/disc-ripper/DiscRipper.type';
import { StatusChip } from './discRipperUtils';

export default function MonitorStep({ jobs, serviceError, onRefresh, onViewResults, onRetry }: {
  jobs: RipJob[];
  serviceError: string;
  onRefresh: () => void;
  onViewResults: (jobId: string) => void;
  onRetry: (jobId: string) => void;
}) {
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [liveLog, setLiveLog] = useState<Record<string, string[]>>({});
  const logRef = useRef<HTMLDivElement>(null);
  const [analyzingJobId, setAnalyzingJobId] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Map<string, JobAnalysis>>(new Map());
  const [analyzeErrors, setAnalyzeErrors] = useState<Record<string, string>>({});
  const [copiedJobId, setCopiedJobId] = useState<string | null>(null);
  const [stopConfirmJobId, setStopConfirmJobId] = useState<string | null>(null);

  const streamLog = useCallback((jobId: string) => {
    if (liveLog[jobId]) return;
    const url = `${process.env.NEXT_PUBLIC_DISC_RIPPER_URL ?? 'http://localhost:8083'}/jobs/${jobId}/log`;
    const es = new EventSource(url);
    const lines: string[] = [];
    es.onmessage = (e) => {
      if (e.data === '[EOF]') { es.close(); return; }
      lines.push(e.data);
      setLiveLog((prev) => ({ ...prev, [jobId]: [...lines] }));
    };
    es.onerror = () => es.close();
  }, [liveLog]);

  useEffect(() => {
    if (expandedLog) streamLog(expandedLog);
  }, [expandedLog, streamLog]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [liveLog]);

  useEffect(() => {
    const failedJobs = jobs.filter((j) => j.status === 'failed');
    for (const job of failedJobs) {
      if (!analyses.has(job.id)) {
        DiscRipperService.getJobAnalysis(job.id).then((analysis) => {
          if (analysis) setAnalyses((prev) => new Map(prev).set(job.id, analysis));
        }).catch(() => {/* ignore */});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  const analyzeJob = async (jobId: string) => {
    setAnalyzingJobId(jobId);
    setAnalyzeErrors((prev) => ({ ...prev, [jobId]: '' }));
    try {
      const analysis = await DiscRipperService.analyzeJob(jobId);
      setAnalyses((prev) => new Map(prev).set(jobId, analysis));
    } catch (e: unknown) {
      setAnalyzeErrors((prev) => ({
        ...prev,
        [jobId]: e instanceof Error ? e.message : 'Analysis failed — is Ollama reachable?',
      }));
    } finally {
      setAnalyzingJobId(null);
    }
  };

  const copyClaudePrompt = (jobId: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedJobId(jobId);
      setTimeout(() => setCopiedJobId(null), 2000);
    }).catch(() => {/* ignore */});
  };

  const stop = (jobId: string) => setStopConfirmJobId(jobId);

  const confirmStop = async () => {
    if (!stopConfirmJobId) return;
    try { await DiscRipperService.stopJob(stopConfirmJobId); } catch { /* ignore */ }
    setStopConfirmJobId(null);
    onRefresh();
  };

  const retry = async (jobId: string) => {
    try { await DiscRipperService.retryJob(jobId); } catch { /* ignore */ }
    onRetry(jobId);
    onRefresh();
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="subtitle2">{jobs.length} job(s)</Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={onRefresh}>Refresh</Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Episodes</TableCell>
              <TableCell>Started</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {jobs.map((job) => {
              const eps = job.episode_map ? Object.values(job.episode_map).join(', ') : '—';
              return (
                <React.Fragment key={job.id}>
                  <TableRow hover>
                    <TableCell><StatusChip status={job.status} /></TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{job.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {job.year}
                        {job.disc_type === 'bluray' && (
                          <Chip label="BD" size="small" color="primary" variant="outlined" sx={{ ml: 0.5, height: 14, fontSize: 10 }} />
                        )}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{eps}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{new Date(job.created_at).toLocaleString()}</Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setExpandedLog(expandedLog === job.id ? null : job.id)}
                        >
                          {expandedLog === job.id ? 'Hide Log' : 'Log'}
                        </Button>
                        {['queued', 'ripping', 'delivering'].includes(job.status) && (
                          <Tooltip title="Cancel job">
                            <IconButton size="small" color="error" onClick={() => stop(job.id)}>
                              <StopIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {job.status === 'failed' && (
                          <Tooltip title="Analyze failure with AI">
                            <span>
                              <IconButton
                                size="small"
                                color="warning"
                                onClick={() => analyzeJob(job.id)}
                                disabled={analyzingJobId === job.id}
                              >
                                {analyzingJobId === job.id
                                  ? <CircularProgress size={16} />
                                  : <AutoFixHighIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                        {['failed', 'cancelled'].includes(job.status) && (
                          <Tooltip title="Retry job with same settings">
                            <IconButton size="small" color="primary" onClick={() => retry(job.id)}>
                              <ReplayIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {job.status === 'done' && job.output_paths.length > 0 && (
                          <Button size="small" variant="outlined" onClick={() => onViewResults(job.id)}>
                            Results
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>

                  {expandedLog === job.id && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ p: 0 }}>
                        <Box
                          ref={logRef}
                          sx={{
                            bgcolor: '#0d1117', color: '#c9d1d9',
                            fontFamily: 'monospace', fontSize: '0.75rem',
                            p: 1.5, maxHeight: 300, overflowY: 'auto',
                          }}
                        >
                          {(liveLog[job.id] ?? (job as unknown as { log?: string }).log?.split('\n') ?? []).map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                          {!liveLog[job.id] && (
                            <Typography variant="caption" color="text.secondary">Loading log…</Typography>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  )}

                  {job.error && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Alert severity="error" sx={{ py: 0 }}>{job.error}</Alert>
                      </TableCell>
                    </TableRow>
                  )}

                  {analyzeErrors[job.id] && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Alert severity="error" sx={{ py: 0 }}>
                          AI analysis failed: {analyzeErrors[job.id]}
                        </Alert>
                      </TableCell>
                    </TableRow>
                  )}

                  {analyses.has(job.id) && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'warning.main', borderRadius: 1 }}>
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                            <Typography variant="subtitle2">AI Analysis</Typography>
                            <Chip
                              label={analyses.get(job.id)!.error_type.replace(/_/g, ' ')}
                              size="small"
                              color="warning"
                              variant="outlined"
                            />
                            <Typography variant="caption" color="text.secondary">
                              via {analyses.get(job.id)!.model_used}
                            </Typography>
                          </Stack>

                          <Typography variant="body2" sx={{ mb: 1.5 }}>
                            {analyses.get(job.id)!.error_summary}
                          </Typography>

                          {analyses.get(job.id)!.suggested_fix && (
                            <Box sx={{ mb: 1.5 }}>
                              <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.5 }}>
                                SUGGESTED FIX
                              </Typography>
                              <Typography variant="body2">
                                {analyses.get(job.id)!.suggested_fix}
                              </Typography>
                            </Box>
                          )}

                          {analyses.get(job.id)!.claude_prompt &&
                           analyses.get(job.id)!.claude_prompt !== 'No code change needed.' && (
                            <Box>
                              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
                                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                  CLAUDE CODE PROMPT
                                </Typography>
                                <Tooltip title={copiedJobId === job.id ? 'Copied!' : 'Copy to clipboard'}>
                                  <IconButton size="small" onClick={() => copyClaudePrompt(job.id, analyses.get(job.id)!.claude_prompt)}>
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
                                {analyses.get(job.id)!.claude_prompt}
                              </Box>
                            </Box>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {jobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography variant="body2" color="text.secondary">No jobs yet</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!stopConfirmJobId} onClose={() => setStopConfirmJobId(null)}>
        <DialogTitle>Stop this rip?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Progress on &ldquo;{jobs.find((j) => j.id === stopConfirmJobId)?.title}&rdquo; will be lost
            and cannot be resumed.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStopConfirmJobId(null)}>Cancel</Button>
          <Button onClick={confirmStop} color="error" variant="contained">Stop Rip</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

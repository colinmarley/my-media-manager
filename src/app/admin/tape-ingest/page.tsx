'use client';
import React, { useState } from 'react';
import { Box, Button, Container, Divider, Stack, Step, StepButton, Stepper, Typography } from '@mui/material';
import { useTapeIngestStore } from '@/store/useTapeIngestStore';
import TapeIngestScanner from './_components/TapeIngestScanner';
import TapeIngestFileCard from './_components/TapeIngestFileCard';
import TapeIngestProcessPanel from './_components/TapeIngestProcessPanel';
import TapeSessionPreview from './_components/TapeSessionPreview';
import WorkflowHelpSection from './_components/WorkflowHelpSection';
import MovieSearchDialog from './_components/MovieSearchDialog';
import TvShowSearchDialog from './_components/TvShowSearchDialog';
import { MovieMetadata, TvShowMetadata } from '@/types/tape-ingest/TapeIngest.type';

const STEPS = ['Scan', 'Classify', 'Process'];

export default function TapeIngestPage() {
  const { items, scanStatus, updateItemMovieMetadata, updateItemTvShowMetadata, reset } = useTapeIngestStore();
  const [activeStep, setActiveStep] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [movieDialogFile, setMovieDialogFile] = useState<string | null>(null);
  const [tvShowDialogFile, setTvShowDialogFile] = useState<string | null>(null);

  const scanDone = scanStatus === 'done' && items.length > 0;
  const dialogFile = movieDialogFile ? items.find((i) => i.filePath === movieDialogFile) : null;
  const tvDialogFile = tvShowDialogFile ? items.find((i) => i.filePath === tvShowDialogFile) : null;

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={600}>Tape Ingest</Typography>
          <Typography variant="body2" color="text.secondary">
            Digitize VHS, VHS-C, and Mini DV tapes to Jellyfin library
          </Typography>
        </Box>
        <Button size="small" onClick={reset} disabled={scanStatus === 'idle'}>Reset</Button>
      </Stack>

      <Stepper nonLinear activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label, i) => (
          <Step key={label} completed={i < activeStep}>
            <StepButton onClick={() => { setActiveStep(i); setShowPreview(false); }} disabled={i === 1 && !scanDone}>
              {label}
            </StepButton>
          </Step>
        ))}
      </Stepper>

      {/* Step 0: Scan */}
      {activeStep === 0 && (
        <Box>
          <WorkflowHelpSection step="pre-scan" />
          <Box sx={{ mt: 2 }}><TapeIngestScanner /></Box>
          {scanDone && (
            <Box sx={{ mt: 2 }}>
              <WorkflowHelpSection step="post-scan" />
              <Button variant="contained" sx={{ mt: 2 }} onClick={() => { setActiveStep(1); setShowPreview(false); }}>
                Continue to Classify ({items.length} files)
              </Button>
            </Box>
          )}
        </Box>
      )}

      {/* Step 1: Classify or Preview */}
      {activeStep === 1 && (
        <Box>
          {showPreview ? (
            <TapeSessionPreview onEdit={() => setShowPreview(false)} onContinue={() => { setShowPreview(false); setActiveStep(2); }} />
          ) : (
            <>
              <WorkflowHelpSection step="classify" />
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2, mb: 2 }}>
                <Typography variant="h6">Step 2 — Classify Files</Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={() => setActiveStep(0)}>Back</Button>
                  <Button variant="contained" size="small" onClick={() => setShowPreview(true)}>Review & Continue →</Button>
                </Stack>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                For each file, choose Movie, TV Show, Home Video, Trailer, Commercial, or Skip.
              </Typography>
              {items.map((item) => (
                <TapeIngestFileCard key={item.filePath} item={item}
                  onMovieAssign={setMovieDialogFile} onTvShowAssign={setTvShowDialogFile} />
              ))}
              <Divider sx={{ my: 2 }} />
              <Button variant="contained" onClick={() => setShowPreview(true)}>Review & Continue →</Button>
            </>
          )}
        </Box>
      )}

      {/* Step 2: Process */}
      {activeStep === 2 && (
        <Box>
          <WorkflowHelpSection step="process" />
          <Box sx={{ mt: 2 }}>
            <Button size="small" onClick={() => setActiveStep(1)} sx={{ mb: 2 }}>← Back to Classify</Button>
            <TapeIngestProcessPanel />
          </Box>
        </Box>
      )}

      <MovieSearchDialog open={!!movieDialogFile} fileName={dialogFile?.fileName ?? ''}
        onClose={() => setMovieDialogFile(null)}
        onAssign={(m: MovieMetadata) => { if (movieDialogFile) updateItemMovieMetadata(movieDialogFile, m); setMovieDialogFile(null); }} />

      <TvShowSearchDialog open={!!tvShowDialogFile} fileName={tvDialogFile?.fileName ?? ''}
        onClose={() => setTvShowDialogFile(null)}
        onAssign={(m: TvShowMetadata) => { if (tvShowDialogFile) updateItemTvShowMetadata(tvShowDialogFile, m); setTvShowDialogFile(null); }} />
    </Container>
  );
}

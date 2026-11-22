'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Chip, Step, StepButton, Stepper } from '@mui/material';
import { PageContainer, PageHeader } from '@/components/ui/PageHeader';
import { DiscRipperService } from '@/service/disc-ripper/DiscRipperService';
import type { DiscScanInfo, DiscTitle, RipJob, StartJobRequest } from '@/types/disc-ripper/DiscRipper.type';
import DiscScanStep from './_components/DiscScanStep';
import ConfigureStep from './_components/ConfigureStep';
import MonitorStep from './_components/MonitorStep';
import ResultsStep from './_components/ResultsStep';

const STEPS = ['Scan Disc', 'Configure', 'Monitor', 'Results'];

export default function DiscRipperPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [titles, setTitles] = useState<DiscTitle[]>([]);
  // The stored scan the titles came from: sent with the job so it is tied to this exact disc.
  const [scanInfo, setScanInfo] = useState<DiscScanInfo | null>(null);
  const [scanError, setScanError] = useState('');
  const [jobs, setJobs] = useState<RipJob[]>([]);
  const [jobsError, setJobsError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [resultsJobId, setResultsJobId] = useState<string | null>(null);
  const [queuedJobIds, setQueuedJobIds] = useState<Set<string>>(new Set());

  const loadJobs = useCallback(async () => {
    try {
      const j = await DiscRipperService.listJobs();
      setJobs(j);
      setJobsError('');
    } catch (e: unknown) {
      setJobsError(e instanceof Error ? e.message : 'Could not reach disc ripper service');
    }
  }, []);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleStart = async (req: StartJobRequest) => {
    setSubmitError('');
    try {
      await DiscRipperService.startJob(req);
      await loadJobs();
      setActiveStep(2);
    } catch (e: unknown) {
      const axiosDetail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setSubmitError(axiosDetail ?? (e instanceof Error ? e.message : 'Failed to start job'));
    }
  };

  const handleRetry = async (jobId: string) => {
    await loadJobs();
    setActiveStep(2);
  };

  const activeJobs = jobs.filter((j) =>
    ['queued', 'ripping', 'delivering'].includes(j.status)
  );

  return (
    <PageContainer>
      <PageHeader
        title="Rip Disc"
        subtitle="Rip DVDs and Blu-rays to your Jellyfin library."
        actions={activeJobs.length > 0 ? <Chip label={`${activeJobs.length} active`} size="small" color="info" /> : undefined}
      />

      {jobsError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Disc ripper service unreachable: {jobsError}
        </Alert>
      )}

      <Stepper nonLinear activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label, i) => (
          <Step
            key={label}
            completed={
              (i === 0 && titles.length > 0) ||
              (i === 2 && jobs.length > 0) ||
              (i === 3 && resultsJobId != null && queuedJobIds.has(resultsJobId))
            }
          >
            <StepButton
              onClick={() => setActiveStep(i)}
              disabled={i === 1 && titles.length === 0}
            >
              {label}
              {i === 2 && activeJobs.length > 0 && (
                <Chip label={activeJobs.length} size="small" color="info" sx={{ ml: 0.5 }} />
              )}
            </StepButton>
          </Step>
        ))}
      </Stepper>

      {activeStep === 0 && (
        <DiscScanStep
          titles={titles}
          setTitles={setTitles}
          scanError={scanError}
          setScanError={setScanError}
          onScanned={setScanInfo}
          onContinue={() => setActiveStep(1)}
        />
      )}

      {activeStep === 1 && (
        <Box>
          {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}
          <ConfigureStep
            titles={titles}
            scanId={scanInfo?.scan_id}
            discInfo={scanInfo}
            onSubmit={handleStart}
          />
        </Box>
      )}

      {activeStep === 2 && (
        <MonitorStep
          jobs={jobs}
          serviceError={jobsError}
          onRefresh={loadJobs}
          onViewResults={(id) => { setResultsJobId(id); setActiveStep(3); }}
          onRetry={handleRetry}
        />
      )}

      {activeStep === 3 && (
        <ResultsStep
          jobs={jobs}
          selectedJobId={resultsJobId}
          onSelectJob={setResultsJobId}
          onQueued={(id) => setQueuedJobIds((prev) => new Set(prev).add(id))}
          onRetry={async (id) => { try { await DiscRipperService.retryJob(id); } catch { /* ignore */ } await loadJobs(); setResultsJobId(id); setActiveStep(2); }}
        />
      )}
    </PageContainer>
  );
}

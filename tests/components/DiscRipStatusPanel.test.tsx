import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import DiscRipStatusPanel from '@/app/dashboard/physical-media/_components/DiscRipStatusPanel';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/service/api/apiClient', () => ({
  api: { get: mocks.get },
}));

const job = {
  id: 'job-1',
  title: 'Alien',
  year: 1979,
  season: null,
  mediaType: 'movie',
  discType: 'bluray',
  status: 'encoding',
  active: true,
  progress: 42.5,
  error: null,
  catalogDiscId: 'disc-1',
  fileCount: 0,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:05:00Z',
};

describe('DiscRipStatusPanel', () => {
  beforeEach(() => {
    mocks.get.mockReset();
  });

  it('asks the ripper proxy for this disc\'s latest job', async () => {
    mocks.get.mockResolvedValue({ jobs: [job], activeCount: 1 });
    render(<DiscRipStatusPanel discId="disc-1" />);

    expect(await screen.findByText('encoding')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/api/ripper/jobs?catalogDiscId=disc-1&limit=1');
    expect(screen.getByText(/43%/)).toBeInTheDocument();
  });

  it('shows the job error when the rip failed', async () => {
    mocks.get.mockResolvedValue({
      jobs: [{ ...job, status: 'failed', active: false, error: 'MakeMKV crashed' }],
      activeCount: 0,
    });
    render(<DiscRipStatusPanel discId="disc-1" />);

    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(screen.getByText(/MakeMKV crashed/)).toBeInTheDocument();
  });

  it('says so when the disc has no rip job', async () => {
    mocks.get.mockResolvedValue({ jobs: [], activeCount: 0 });
    render(<DiscRipStatusPanel discId="disc-1" />);

    expect(await screen.findByText(/no rip job for this disc/i)).toBeInTheDocument();
  });

  it('shows a ripper-unavailable message on 503', async () => {
    mocks.get.mockRejectedValue(new Error('API error 503: {"detail":"Disc ripper is not reachable."}'));
    render(<DiscRipStatusPanel discId="disc-1" />);

    expect(await screen.findByText(/disc ripper is unavailable/i)).toBeInTheDocument();
  });

  it('shows an error message on any other failure', async () => {
    mocks.get.mockRejectedValue(new Error('API error 500: boom'));
    render(<DiscRipStatusPanel discId="disc-1" />);

    expect(await screen.findByText(/couldn't load rip status/i)).toBeInTheDocument();
    expect(screen.getByText(/API error 500: boom/)).toBeInTheDocument();
  });
});

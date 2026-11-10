import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MediaProcessingSummaryCard from '../../src/app/dashboard/my-library/_components/detail/MediaProcessingSummaryCard';
import type { LibraryProcessingSummary } from '../../src/app/dashboard/my-library/_components/libraryHelpers';

describe('MediaProcessingSummaryCard', () => {
  it('explains when no summary exists yet', () => {
    render(<MediaProcessingSummaryCard summary={null} />);

    expect(screen.getByText('Processing summary is not available for this title yet.')).toBeInTheDocument();
    expect(screen.queryByText('Processed')).not.toBeInTheDocument();
  });

  it('renders the file metrics and the fallback chip', () => {
    render(
      <MediaProcessingSummaryCard
        summary={
          {
            mediaType: 'movie',
            hasAssignmentSummary: false,
            totalFiles: 10,
            assignedFiles: 8,
            unassignedFiles: 2,
            completionPercent: 80,
          } as LibraryProcessingSummary
        }
      />
    );

    expect(screen.getByText('Processed')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Using fallback counts from discs/files')).toBeInTheDocument();
  });

  it('marks assignment summaries as available and shows the total size', () => {
    render(
      <MediaProcessingSummaryCard
        summary={
          {
            mediaType: 'movie',
            hasAssignmentSummary: true,
            totalFiles: 4,
            assignedFiles: 4,
            unassignedFiles: 0,
            completionPercent: 100,
            totalFileSizeFormatted: '12.4 GB',
          } as LibraryProcessingSummary
        }
      />
    );

    expect(screen.getByText('Assignment summary available')).toBeInTheDocument();
    expect(screen.getByText('Total size: 12.4 GB')).toBeInTheDocument();
    expect(screen.queryByText('Using fallback counts from discs/files')).not.toBeInTheDocument();
  });

  it('adds episode and season coverage for series', () => {
    render(
      <MediaProcessingSummaryCard
        summary={
          {
            mediaType: 'series',
            hasAssignmentSummary: true,
            totalFiles: 12,
            assignedFiles: 12,
            unassignedFiles: 0,
            completionPercent: 100,
            episodesWithFiles: 7,
            totalEpisodes: 10,
            seasonsWithFiles: 2,
            totalSeasons: 3,
          } as LibraryProcessingSummary
        }
      />
    );

    expect(screen.getByText('Episode Coverage')).toBeInTheDocument();
    expect(screen.getByText(/7 \/ 10 episodes with files/)).toBeInTheDocument();
    expect(screen.getByText('Season Coverage')).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 3 seasons with files/)).toBeInTheDocument();
  });

  it('defaults missing series coverage counts to zero', () => {
    render(
      <MediaProcessingSummaryCard
        summary={
          {
            mediaType: 'series',
            hasAssignmentSummary: true,
            totalFiles: 0,
            assignedFiles: 0,
            unassignedFiles: 0,
            completionPercent: 0,
          } as LibraryProcessingSummary
        }
      />
    );

    expect(screen.getByText(/0 \/ 0 episodes with files/)).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 0 seasons with files/)).toBeInTheDocument();
  });
});

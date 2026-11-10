import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

import IngressHistoryCard from '@/app/admin/_components/ingress/IngressHistoryCard';

describe('IngressHistoryCard', () => {
  it('says there is no history yet', () => {
    render(<IngressHistoryCard history={[]} />);

    expect(screen.getByText('No processing history yet.')).toBeInTheDocument();
  });

  it('shows the ten newest entries first with status, confidence and path', () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      item_id: `item-${index}`,
      file_path: `/media/organized/movie-${index}.mkv`,
      status: index === 11 ? 'failed' : 'completed',
      confidence_score: 90,
    }));

    render(<IngressHistoryCard history={history} />);

    expect(screen.getByText('/media/organized/movie-11.mkv')).toBeInTheDocument();
    expect(screen.getByText('/media/organized/movie-2.mkv')).toBeInTheDocument();
    expect(screen.queryByText('/media/organized/movie-1.mkv')).not.toBeInTheDocument();
    expect(screen.queryByText('/media/organized/movie-0.mkv')).not.toBeInTheDocument();

    expect(screen.getAllByText('completed')).toHaveLength(9);
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getAllByText('90%')).toHaveLength(10);
  });

  it('falls back to the queue item id when an entry has no path', () => {
    render(
      <IngressHistoryCard
        history={[{ item_id: 'queue-44', status: 'needs_review', confidence_score: 41 }]}
      />
    );

    expect(screen.getByText('queue-44')).toBeInTheDocument();
    expect(screen.getByText('needs_review')).toBeInTheDocument();
    expect(screen.getByText('41%')).toBeInTheDocument();
  });

  it('leaves the confidence off entries that never scored a match', () => {
    render(
      <IngressHistoryCard
        history={[{ item_id: 'queue-45', file_path: '/media/organized/x.mkv', status: 'completed' }]}
      />
    );

    expect(screen.getByText('/media/organized/x.mkv')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});

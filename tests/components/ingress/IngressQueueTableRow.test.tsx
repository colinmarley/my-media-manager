import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import IngressQueueTableRow from '@/app/admin/_components/ingress/IngressQueueTableRow';
import type { IngressQueueItem } from '@/service/ingress/IngressAutomationService';

const makeItem = (
  overrides: Partial<IngressQueueItem> & { id: string; status: string }
): IngressQueueItem => ({
  file_path: `/ingest/${overrides.id}.mkv`,
  file_name: `${overrides.id}.mkv`,
  attempts: 0,
  queued_at: 0,
  ...overrides,
});

const renderRow = (
  item: IngressQueueItem,
  overrides: Record<string, unknown> = {}
) => {
  const props = {
    item,
    selected: false,
    working: false,
    onToggleSelection: vi.fn(),
    onRetry: vi.fn(),
    onAssign: vi.fn(),
    onMarkDone: vi.fn(),
    onResetToEncoded: vi.fn(),
    onMarkFailed: vi.fn(),
    onReclassify: vi.fn(),
    ...overrides,
  };

  render(
    <table>
      <tbody>
        <IngressQueueTableRow {...(props as never)} />
      </tbody>
    </table>
  );

  return props;
};

describe('IngressQueueTableRow', () => {
  const needsReview = makeItem({
    id: 'row-1',
    status: 'needs_review',
    file_name: 'the.big.show.s01e02.1080p.mkv',
    media_duration_ms: 7_525_000,
    confidence_score: 62,
    parsed_info: { media_type: 'episode', season: 1, episode: 2 },
    best_match: { title: 'The Big Show', year: 2019, media_type: 'series' },
    proposed_path: '/media/series/The Big Show/Season 01/S01E02.mkv',
  });

  it('shows the duration, confidence and classification badges for a review row', () => {
    renderRow(needsReview);

    expect(screen.getByText('the.big.show.s01e02.1080p.mkv')).toBeInTheDocument();
    expect(screen.getByText('2h 05m')).toBeInTheDocument();
    expect(screen.getByText('needs_review')).toBeInTheDocument();
    expect(screen.getByText('TV Episode')).toBeInTheDocument();
    expect(screen.getByText('S01E02')).toBeInTheDocument();
    expect(screen.getByText('The Big Show')).toBeInTheDocument();
    expect(screen.getByText('(2019)')).toBeInTheDocument();
    expect(screen.getByText(/\/media\/series\/The Big Show/)).toBeInTheDocument();
    expect(screen.getByText('62')).toBeInTheDocument();
  });

  it('shows an em dash when ffprobe never reported a duration', () => {
    renderRow(
      makeItem({
        id: 'row-2',
        status: 'pending',
        media_duration_ms: null,
        confidence_score: 55,
        best_match: { title: 'Known Title', year: 2019 },
      })
    );

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Known Title')).toBeInTheDocument();
  });

  it('only exposes the actions that fit the row status', () => {
    renderRow(needsReview);

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign manually' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss / mark failed' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reset files back to encoded for retest' })
    ).not.toBeInTheDocument();
  });

  it('offers only the reset action for an already assigned row', () => {
    const props = renderRow(
      makeItem({ id: 'row-3', status: 'completed', assignment_id: 'media-9' })
    );

    expect(screen.getByRole('button', { name: 'Reset files back to encoded for retest' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset files back to encoded for retest' }));
    expect(props.onResetToEncoded).toHaveBeenCalledWith('row-3');
  });

  it('hands the row id and shift modifier back when the checkbox changes', () => {
    const props = renderRow(needsReview, { selected: true });
    const checkbox = screen.getByRole('checkbox', { name: 'Select the.big.show.s01e02.1080p.mkv' });

    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(props.onToggleSelection).toHaveBeenCalledWith('row-1', false);

    fireEvent.click(checkbox, { shiftKey: true });
    expect(props.onToggleSelection).toHaveBeenLastCalledWith('row-1', true);
  });

  it('reclassifies just this row from the override menu', async () => {
    const props = renderRow(needsReview);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Override' }));
    const option = await screen.findByRole('option', { name: 'Special Feature' });
    fireEvent.click(option);

    expect(props.onReclassify).toHaveBeenCalledWith(['row-1'], 'special_feature');
  });

  it('runs the per-row commands against their own row', () => {
    const props = renderRow(needsReview);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign manually' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss / mark failed' }));

    expect(props.onRetry).toHaveBeenCalledWith('row-1');
    expect(props.onAssign).toHaveBeenCalledWith(['row-1']);
    expect(props.onMarkDone).toHaveBeenCalledWith('row-1');
    expect(props.onMarkFailed).toHaveBeenCalledWith('row-1');
  });

  it('freezes selection and override controls while a queue request is running', () => {
    renderRow(needsReview, { working: true });

    expect(screen.getByRole('checkbox', { name: 'Select the.big.show.s01e02.1080p.mkv' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Override' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the checkbox off rows that cannot be bulk-selected', () => {
    renderRow(makeItem({ id: 'row-4', status: 'processing' }));

    expect(screen.getByRole('checkbox', { name: 'Select row-4.mkv' })).toBeDisabled();
  });
});

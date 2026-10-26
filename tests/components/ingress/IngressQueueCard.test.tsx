import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import IngressQueueCard from '@/app/admin/_components/ingress/IngressQueueCard';
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

const reviewItem = makeItem({ id: 'review-1', status: 'needs_review' });
const autoItem = makeItem({ id: 'auto-1', status: 'auto_assigned' });

const renderCard = (overrides: Record<string, unknown> = {}) => {
  const props = {
    working: false,
    selectedQueueItemIds: [] as string[],
    selectableVisibleItems: [reviewItem, autoItem] as IngressQueueItem[],
    selectedVisibleCount: 0,
    selectedAcceptCount: 0,
    selectedRejectCount: 0,
    selectedRetryCount: 0,
    visibleQueueItems: [reviewItem, autoItem] as IngressQueueItem[],
    filteredQueueItemsCount: 2,
    queuePage: 0,
    queueRowsPerPage: 10,
    setQueuePage: vi.fn(),
    setQueueRowsPerPage: vi.fn(),
    onToggleSelectAllVisible: vi.fn(),
    onBulkAccept: vi.fn(),
    onBulkReject: vi.fn(),
    onBulkRetry: vi.fn(),
    onOpenAssignDialog: vi.fn(),
    onReclassify: vi.fn(),
    onRetry: vi.fn(),
    onMarkDone: vi.fn(),
    onMarkFailed: vi.fn(),
    onResetToEncoded: vi.fn(),
    onToggleItemSelection: vi.fn(),
    ...overrides,
  };

  const result = render(<IngressQueueCard {...(props as never)} />);

  return { ...props, container: result.container };
};

describe('IngressQueueCard', () => {
  it('shows how many rows are selected, falling back to how many are selectable', () => {
    renderCard();

    expect(screen.getByText('2 selectable')).toBeInTheDocument();
  });

  it('prefers the selection count once rows are checked', () => {
    renderCard({ selectedQueueItemIds: ['review-1'], selectedVisibleCount: 1 });

    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('enables each bulk action only when the selection qualifies for it', () => {
    renderCard({
      selectedQueueItemIds: ['review-1'],
      selectedVisibleCount: 1,
      selectedAcceptCount: 1,
      selectedRejectCount: 1,
      selectedRetryCount: 0,
    });

    expect(screen.getByRole('button', { name: 'Accept Selected' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject Selected' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Retry Selected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Assign Selected' })).toBeEnabled();
  });

  it('disables every bulk action while a queue request is running', () => {
    renderCard({
      working: true,
      selectedQueueItemIds: ['review-1', 'auto-1'],
      selectedVisibleCount: 2,
      selectedAcceptCount: 2,
      selectedRejectCount: 1,
      selectedRetryCount: 1,
    });

    expect(screen.getByRole('button', { name: 'Accept Selected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject Selected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry Selected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Assign Selected' })).toBeDisabled();
  });

  it('sends the current selection to the classification presets', () => {
    const props = renderCard({ selectedQueueItemIds: ['review-1', 'auto-1'], selectedVisibleCount: 2 });

    fireEvent.click(screen.getByRole('button', { name: 'Set Main' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set Special' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set Version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));

    expect(props.onReclassify).toHaveBeenNthCalledWith(1, ['review-1', 'auto-1'], 'main_feature');
    expect(props.onReclassify).toHaveBeenNthCalledWith(2, ['review-1', 'auto-1'], 'special_feature');
    expect(props.onReclassify).toHaveBeenNthCalledWith(3, ['review-1', 'auto-1'], 'alternate_version');
    expect(props.onReclassify).toHaveBeenNthCalledWith(4, ['review-1', 'auto-1'], 'auto');
  });

  it('runs the accept, reject, retry and assign commands for the selection', () => {
    const props = renderCard({
      selectedQueueItemIds: ['review-1'],
      selectedVisibleCount: 1,
      selectedAcceptCount: 1,
      selectedRejectCount: 1,
      selectedRetryCount: 1,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Accept Selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject Selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry Selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign Selected' }));

    expect(props.onBulkAccept).toHaveBeenCalled();
    expect(props.onBulkReject).toHaveBeenCalled();
    expect(props.onBulkRetry).toHaveBeenCalled();
    expect(props.onOpenAssignDialog).toHaveBeenCalledWith(['review-1']);
  });

  it('shows an indeterminate select-all box for a partial selection', () => {
    const props = renderCard({ selectedQueueItemIds: ['review-1'], selectedVisibleCount: 1 });

    const selectAll = screen.getByRole('checkbox', { name: 'Select all queue items' });
    expect(selectAll).not.toBeChecked();
    expect(props.container.querySelector('.MuiCheckbox-indeterminate')).toBeInTheDocument();

    fireEvent.click(selectAll);
    expect(props.onToggleSelectAllVisible).toHaveBeenCalled();
  });

  it('disables select-all when nothing on the page can be selected', () => {
    renderCard({ selectableVisibleItems: [], selectedVisibleCount: 0 });

    expect(screen.getByRole('checkbox', { name: 'Select all queue items' })).toBeDisabled();
  });

  it('checks select-all when the whole page is selected', () => {
    renderCard({
      selectedQueueItemIds: ['review-1', 'auto-1'],
      selectedVisibleCount: 2,
      selectedAcceptCount: 2,
    });

    expect(screen.getByRole('checkbox', { name: 'Select all queue items' })).toBeChecked();
  });

  it('renders one table row per visible queue item', () => {
    renderCard();

    expect(screen.getByText('review-1.mkv')).toBeInTheDocument();
    expect(screen.getByText('auto-1.mkv')).toBeInTheDocument();
  });

  it('explains an empty queue instead of rendering an empty table body', () => {
    renderCard({ visibleQueueItems: [], selectableVisibleItems: [], filteredQueueItemsCount: 0 });

    expect(screen.getByText('No active queue items.')).toBeInTheDocument();
  });

  it('paginates against the filtered total rather than the visible page', () => {
    const props = renderCard({ filteredQueueItemsCount: 12 });

    expect(screen.getByText(/of 12/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Go to next page'));

    expect(props.setQueuePage).toHaveBeenCalledWith(1);
  });
});

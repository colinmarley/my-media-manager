/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IngressQueueGroup, IngressQueueGroupsResult } from '@/service/ingress/IngressAutomationService';

const { getQueueGroups, bulkQueueAction } = vi.hoisted(() => ({ getQueueGroups: vi.fn(), bulkQueueAction: vi.fn() }));

vi.mock('@/service/ingress/IngressAutomationService', () => ({ default: { getQueueGroups, bulkQueueAction } }));

import { IngressTriageGroups } from '@/app/admin/_components/IngressTriageGroups';

// QA probes for issue #35 acceptance criteria that the shipped suite only covers indirectly:
// a 1,000+ item group opened in the UI (AC4), a partially failed batch that must keep its
// successful rows marked (AC5), and the status filter reaching the API (AC6).
// These target real behaviour and are not written against the implementation.

function makeItem(id: string, status = 'needs_review') {
  return { id, file_path: `/ark/ingest/disc1/${id}.mkv`, file_name: `${id}.mkv`, status, attempts: 1, queued_at: 1777000000 };
}

function makeGroup(title: string, statusCounts: Record<string, number>, previews: any[] = []): IngressQueueGroup {
  const itemCount = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  return {
    group_key: { media_type: 'movie', ingress_path: '/ark/ingest', source_folder: `/ark/ingest/${title}` },
    media_type: 'movie',
    ingress_path: '/ark/ingest',
    title,
    source_folder: `/ark/ingest/${title}`,
    item_count: itemCount,
    matching_count: itemCount,
    status_counts: statusCounts,
    confidence_min: 40,
    confidence_max: 91,
    first_queued_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    last_queued_at: new Date().toISOString(),
    preview_items: previews,
  };
}

function makeResult(groups: IngressQueueGroup[]): IngressQueueGroupsResult {
  return {
    groups,
    total_groups: groups.length,
    total_items: groups.reduce((sum, group) => sum + group.item_count, 0),
    status_counts: {},
    group_by: 'source_folder',
    limit: 25,
    offset: 0,
    preview_size: 10,
  };
}

const mountedRows = (container: HTMLElement) =>
  container.querySelectorAll('[data-testid^="triage-group-"], [data-testid^="triage-item-"], [data-testid="triage-more"]').length;

describe('IngressTriageGroups QA probes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkQueueAction.mockReset();
    getQueueGroups.mockReset();
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
  });

  // AC4: expanding a group whose server-side count is in the thousands must not mount the folder.
  it('AC4: keeps rendered rows bounded when a 1,930-item group is expanded with an oversized preview', async () => {
    const previews = Array.from({ length: 1000 }, (_, index) => makeItem(`item-${index}`));
    getQueueGroups.mockResolvedValue(makeResult([makeGroup('Backlog', { needs_review: 1930 }, previews)]));

    const { container } = render(<IngressTriageGroups />);
    await waitFor(() => expect(screen.getByText('/ark/ingest/Backlog')).toBeInTheDocument());
    expect(mountedRows(container)).toBeLessThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: /^Expand \/ark\/ingest\/Backlog/ }));
    await waitFor(() => expect(mountedRows(container)).toBeGreaterThan(1));
    expect(mountedRows(container)).toBeLessThan(30);

    const list = screen.getByTestId('triage-list');
    fireEvent.scroll(list, { target: { scrollTop: 12000 } });
    await waitFor(() => expect(mountedRows(container)).toBeLessThan(30));
  });

  // AC5: failures name the item, and the rows the batch did accept stay accepted afterwards.
  it('AC5: keeps accepted rows marked when the batch also reports per-item failures', async () => {
    const items = ['item-1', 'item-2', 'item-3', 'item-4', 'item-5'].map((id) => makeItem(id));
    getQueueGroups.mockResolvedValue(makeResult([makeGroup('Dune', { needs_review: 5 }, items)]));
    bulkQueueAction.mockResolvedValue({
      batch_id: 'batch-partial',
      action: 'accept',
      requested: 5,
      succeeded: 4,
      failed: 1,
      skipped: 0,
      group_truncated: false,
      group_limit: 100,
      results: [
        ...items.slice(0, 4).map((item) => ({ item_id: item.id, action: 'accept', status: 'succeeded', item_status: 'auto_assigned' })),
        { item_id: 'item-5', action: 'accept', status: 'failed', error: 'No matching title in TMDB' },
      ],
    });

    render(<IngressTriageGroups />);
    await waitFor(() => expect(screen.getByText('/ark/ingest/Dune')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Accept 5 in this group' }));
    await waitFor(() => expect(bulkQueueAction).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByText('4 accepted in /ark/ingest/Dune · 1 failed')).toBeInTheDocument());
    expect(screen.getByText(/No matching title in TMDB/)).toBeInTheDocument();

    const chipLabels = Array.from(document.querySelectorAll('[data-testid^="triage-group-"] .MuiChip-label'))
      .map((chip) => (chip.textContent || '').trim());
    const movedCounts = chipLabels
      .filter((label) => /^(\d+) (auto assigned|completed)$/.test(label))
      .map((label) => parseInt(label.match(/\d+/)?.[0] ?? '0', 10));
    expect(movedCounts.reduce((sum, count) => sum + count, 0)).toBe(4);
    expect(chipLabels.some((label) => /^\d+ needs review$/.test(label))).toBe(false);
    expect(screen.getByText('1 failed')).toBeInTheDocument();

    expect(getQueueGroups).toHaveBeenCalledTimes(1);
  });

  // AC6: the status filter is a server query too, and combines with the search box.
  it('AC6: sends the status filter to the API instead of filtering group rows locally', async () => {
    getQueueGroups.mockResolvedValue(makeResult([makeGroup('Alpha', { needs_review: 1 }, [makeItem('item-1')])]));

    render(<IngressTriageGroups />);
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Search path or title'), { target: { value: 'Heat' } });
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalledTimes(2));

    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'failed' }));
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalledTimes(3));

    const params = getQueueGroups.mock.calls[2][0];
    expect(params.statuses).toEqual(['failed']);
    expect(params.q).toBe('Heat');
  });
});

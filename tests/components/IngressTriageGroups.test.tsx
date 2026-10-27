/**
 * Grouped triage view (#35). Every test title carries the acceptance criterion it pins, so the
 * factory's AC trace resolves a criterion to a named test instead of to the file as a whole:
 * AC1 server-paged groups from GET /queue/groups, AC2 one bulk request per group + row updated from
 * the response, AC3 single rows travel the same endpoint, AC4 bounded (windowed) rendering,
 * AC5 per-item failures with the successful rows kept marked, AC6 status/`q` sent to the server.
 * AC7 (the suite itself) is pinned by tests/structure/ingressTriageGroupsSuite.test.ts.
 */
/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IngressQueueGroup, IngressQueueGroupsResult, IngressQueueItem } from '@/service/ingress/IngressAutomationService';

const { getQueueGroups, bulkQueueAction, updateClassification } = vi.hoisted(() => ({
  getQueueGroups: vi.fn(),
  bulkQueueAction: vi.fn(),
  // Preview rows reuse the flat queue list's classification handler, so it needs mocking here too.
  updateClassification: vi.fn(),
}));

vi.mock('@/service/ingress/IngressAutomationService', () => ({ default: { getQueueGroups, bulkQueueAction, updateClassification } }));

import { INGRESS_TIMEOUT_ERROR_NAME } from '@/service/ingress/ingressQueueModel';
import { IngressTriageGroups } from '@/app/admin/_components/IngressTriageGroups';

function makeGroup(title: string, statusCounts: Record<string, number>, preview: IngressQueueItem[] = []): IngressQueueGroup {
  return {
    group_key: { media_type: 'movie', ingress_path: '/movies/incoming', title },
    media_type: 'movie',
    ingress_path: '/movies/incoming',
    title,
    source_folder: `/movies/incoming/${title}`,
    item_count: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
    matching_count: statusCounts.needs_review ?? 0,
    status_counts: statusCounts,
    confidence_min: 60,
    confidence_max: 98,
    first_queued_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    last_queued_at: new Date().toISOString(),
    preview_items: preview,
  };
}

function makeItem(id: string, status = 'needs_review'): IngressQueueItem {
  return {
    id,
    file_path: `/movies/incoming/${id}.mkv`,
    file_name: `${id}.mkv`,
    status,
    confidence_score: 87,
    attempts: 0,
    queued_at: Date.now() - 3 * 24 * 60 * 60 * 1000,
    best_match: { title: 'Dune', year: 2021 },
  };
}

function makeResult(groups: IngressQueueGroup[], totalGroups = groups.length): IngressQueueGroupsResult {
  return {
    groups,
    total_groups: totalGroups,
    total_items: groups.reduce((sum, group) => sum + group.item_count, 0),
    status_counts: { needs_review: 10 },
    group_by: 'source_folder',
    limit: 25,
    offset: 0,
    preview_size: 10,
  };
}

const okBulk = {
  batch_id: 'batch-1',
  action: 'accept',
  requested: 1,
  succeeded: 1,
  failed: 0,
  skipped: 0,
  results: [{ item_id: 'item-1', action: 'accept', status: 'succeeded' as const, item_status: 'auto_assigned' }],
};

const smallGroup = makeGroup('Dune (2021)', { needs_review: 3, failed: 1 }, [makeItem('item-1'), makeItem('item-2')]);
const hugeGroup = makeGroup('Blade Runner 1942', { needs_review: 1920, failed: 20 });

function groupRows() {
  return screen.getAllByTestId(/^triage-group-/);
}

describe('IngressTriageGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueueGroups.mockResolvedValue(makeResult([smallGroup, hugeGroup]));
    bulkQueueAction.mockResolvedValue(okBulk);
    updateClassification.mockResolvedValue({});
  });

  it('AC1: renders one row per folder with counts and per-status chips', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    expect(within(groupRows()[0]).getByText('3')).toBeTruthy();
    expect(within(groupRows()[0]).getByText('of 4')).toBeTruthy();
    expect(within(groupRows()[0]).getByText('3 needs review')).toBeTruthy();
    expect(within(groupRows()[0]).getByText('60–98%')).toBeTruthy();
    expect(screen.getByTestId('triage-summary').textContent).toBe('2 groups · 1,944 items');
  });

  it('AC2: accepts a small group with a single group-scoped bulk request', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Accept/ }));

    await waitFor(() => expect(bulkQueueAction).toHaveBeenCalledTimes(1));
    const payload = bulkQueueAction.mock.calls[0][0];
    expect(payload).toEqual({
      action: 'accept',
      group: smallGroup.group_key,
      statuses: ['needs_review', 'failed'],
    });
    expect(payload.itemIds).toBeUndefined();
    await waitFor(() => expect(screen.getByText('1 accepted in /movies/incoming/Dune (2021)')).toBeTruthy());
  });

  it('AC2: confirms before accepting a group that spans more than the threshold', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[1]).getByRole('button', { name: /^Accept/ }));
    const dialog = await screen.findByText('Accept queue group?');
    expect(dialog).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByText('Accept 1,940 items in /movies/incoming/Blade Runner 1942?')).toBeTruthy();
    expect(bulkQueueAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Accept group' }));
    await waitFor(() => expect(bulkQueueAction).toHaveBeenCalledTimes(1));
    expect(bulkQueueAction.mock.calls[0][0].group).toEqual(hugeGroup.group_key);
  });

  it('AC2: requires an explicit confirmation for ignore, which only the history log can undo', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Ignore/ }));
    await screen.findByText('Ignore queue group?');
    // The dialog has to say what cannot be undone from the queue itself.
    expect(within(screen.getByRole('dialog')).getByText(/only undoable from the history log/)).toBeTruthy();
    expect(bulkQueueAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ignore group' }));
    await waitFor(() => expect(bulkQueueAction).toHaveBeenCalledTimes(1));
    expect(bulkQueueAction.mock.calls[0][0].action).toBe('ignore');
  });

  it('keeps the visible button text inside the accessible names, and the undo warning on the control itself', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));
    const row = groupRows()[0];
    // A hover tooltip must not become the accessible name: WCAG 2.5.3 wants the visible label in it.
    const accept = within(row).getByRole('button', { name: 'Accept 4 in this group' });
    const ignore = within(row).getByRole('button', { name: 'Ignore 4 in this group. Ignore is only undoable from the history log.' });
    expect(accept.textContent).toBe('Accept 4');
    expect(ignore.textContent).toBe('Ignore 4');
  });

  it('AC6: sends search and status filters to the API instead of filtering rows locally', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalledTimes(1));
    expect(getQueueGroups.mock.calls[0][0].q).toBeUndefined();

    fireEvent.change(screen.getByLabelText('Search path or title'), { target: { value: 'Dune' } });
    await waitFor(() =>
      expect(getQueueGroups.mock.calls.some((call: any[]) => call[0].q === 'Dune')).toBe(true)
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reload queue groups' }));
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalledTimes(3));
    // Both rows stay rendered: the server decides which groups match.
    expect(groupRows()).toHaveLength(2);
  });

  it('AC1: pages groups server-side through the table pagination control', async () => {
    getQueueGroups.mockResolvedValue(
      makeResult(Array.from({ length: 25 }, (_, index) => makeGroup(`Movie ${index}`, { needs_review: 1 })), 40)
    );
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
    expect(screen.getByText(/1–25 of 40/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Go to next page'));
    await waitFor(() => expect(getQueueGroups.mock.calls.some((call: any[]) => call[0].offset === 25)).toBe(true));
  });

  it('AC4: keeps rendered rows bounded when a page holds many groups', async () => {
    getQueueGroups.mockResolvedValue(makeResult(Array.from({ length: 40 }, (_, index) => makeGroup(`Movie ${index}`, { needs_review: 1 }))));
    render(<IngressTriageGroups />);
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalled());

    expect(groupRows().length).toBeLessThan(20);
    expect(screen.getByText(/of 40$/)).toBeTruthy();
  });

  it('AC3: acts on a single preview row through the same bulk endpoint as the group', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Expand/ }));
    await waitFor(() => expect(screen.getAllByTestId(/^triage-item-/)).toHaveLength(2));

    fireEvent.click(within(screen.getByTestId('triage-item-item-1')).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(bulkQueueAction).toHaveBeenCalledTimes(1));
    expect(bulkQueueAction.mock.calls[0][0]).toEqual({ action: 'accept', itemIds: ['item-1'] });
  });

  it('AC3: reclassifies a preview row from the folder view and re-reads the group', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Expand/ }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Classification override for item-1.mkv' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Special Feature' }));

    await waitFor(() => expect(updateClassification).toHaveBeenCalledWith('item-1', 'special_feature'));
    // An override changes what the next scan does, so the row is re-read rather than patched by hand.
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalledTimes(2));
  });

  it('AC3: opens the manual assignment dialog the flat queue list uses from a preview row', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Expand/ }));
    fireEvent.click(within(screen.getByTestId('triage-item-item-1')).getByRole('button', { name: 'Assign item-1.mkv manually' }));

    await screen.findByText('Manual Assignment');
    expect(screen.getByText('Assigning 1 queue item.')).toBeTruthy();
  });

  it('AC2: excludes preview rows from a selected group before posting the batch', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[0]).getByRole('checkbox', { name: 'Select group /movies/incoming/Dune (2021)' }));
    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Expand/ }));
    await waitFor(() => expect(screen.getAllByTestId(/^triage-item-/)).toHaveLength(2));

    fireEvent.click(within(screen.getByTestId('triage-item-item-2')).getByRole('checkbox'));
    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Accept/ }));

    await waitFor(() => expect(bulkQueueAction).toHaveBeenCalledTimes(1));
    expect(bulkQueueAction.mock.calls[0][0]).toEqual({
      action: 'accept',
      group: smallGroup.group_key,
      statuses: ['needs_review', 'failed'],
      excludeItemIds: ['item-2'],
    });
  });

  it('AC5: reports failed rows returned by the batch', async () => {
    bulkQueueAction.mockResolvedValue({
      ...okBulk,
      succeeded: 2,
      failed: 2,
      results: [
        { item_id: 'item-9', action: 'accept', status: 'failed', item_status: 'failed', error: 'path missing' },
        { item_id: 'item-8', action: 'accept', status: 'failed', item_status: 'failed', error: 'no match' },
      ],
    });
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Accept/ }));
    await waitFor(() => expect(screen.getByText('2 accepted in /movies/incoming/Dune (2021) · 2 failed')).toBeTruthy());
    expect(screen.getByText('item-9: path missing')).toBeTruthy();
    expect(screen.getByText('item-8: no match')).toBeTruthy();
  });

  it('AC2: rekeys the group row from the batch response instead of refetching the page', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));
    expect(within(groupRows()[0]).getByText('3 needs review')).toBeTruthy();

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Accept/ }));
    await waitFor(() => expect(bulkQueueAction).toHaveBeenCalledTimes(1));

    // The row moved to the response's item status, and no page request was issued.
    await waitFor(() => expect(within(groupRows()[0]).getByText('1 auto assigned')).toBeTruthy());
    expect(within(groupRows()[0]).getByText('2 needs review')).toBeTruthy();
    expect(getQueueGroups).toHaveBeenCalledTimes(1);
    expect(within(groupRows()[0]).getByRole('button', { name: /^Accept/ })).toBeTruthy();
  });

  it('AC2: marks the group in flight and puts the counts back when the batch request fails', async () => {
    let rejectBulk: (error: Error) => void = () => {};
    bulkQueueAction.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectBulk = reject;
        })
    );
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Accept/ }));
    // Optimistic: the actionable rows are already out of `needs review` while the request is open.
    await waitFor(() => expect(within(groupRows()[0]).getByText('Applying…')).toBeTruthy());
    expect(within(groupRows()[0]).queryByText('3 needs review')).toBeNull();
    expect(within(groupRows()[0]).getByText('4 completed')).toBeTruthy();

    act(() => rejectBulk(new Error('queue is busy')));
    await waitFor(() => expect(within(groupRows()[0]).getByText('3 needs review')).toBeTruthy());
    expect(within(groupRows()[0]).queryByText('Applying…')).toBeNull();
    expect(screen.getByText('queue is busy')).toBeTruthy();
  });

  it('AC2: re-reads the page when a batch request runs out of time, since the server may still be applying it', async () => {
    // A group batch can outlive the client's wait. The row must then follow whatever the server says,
    // so the refetch reports something the optimistic snapshot never showed.
    getQueueGroups
      .mockResolvedValueOnce(makeResult([smallGroup, hugeGroup]))
      .mockResolvedValue(
        makeResult([
          makeGroup('Dune (2021)', { completed: 2, failed: 2 }, [makeItem('item-1', 'completed'), makeItem('item-2', 'completed')]),
          hugeGroup,
        ])
      );
    bulkQueueAction.mockRejectedValue(
      Object.assign(new Error('the request ran out of time, the queue may still be working'), { name: INGRESS_TIMEOUT_ERROR_NAME })
    );

    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Accept/ }));
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(within(groupRows()[0]).getByText('2 completed')).toBeTruthy());
    expect(within(groupRows()[0]).getByText('2 failed')).toBeTruthy();
    // Neither the guess the aborted request left behind nor the stale pre-action snapshot survives.
    expect(within(groupRows()[0]).queryByText('4 completed')).toBeNull();
    expect(within(groupRows()[0]).queryByText('3 needs review')).toBeNull();
    expect(screen.getByText('the request ran out of time, the queue may still be working')).toBeTruthy();
  });

  it('clears a failed load once a manual reload succeeds', async () => {
    getQueueGroups.mockRejectedValueOnce(new Error('Failed to load queue groups')).mockResolvedValue(makeResult([smallGroup, hugeGroup]));

    render(<IngressTriageGroups />);
    await waitFor(() => expect(screen.getByText('Failed to load queue groups')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Reload queue groups' }));
    await waitFor(() => expect(groupRows()).toHaveLength(2));
    expect(screen.queryByText('Failed to load queue groups')).toBeNull();
  });

  it('clears a refused batch error once a manual reload succeeds', async () => {
    bulkQueueAction.mockRejectedValue(new Error('queue is busy'));

    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Accept/ }));
    await waitFor(() => expect(screen.getByText('queue is busy')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Reload queue groups' }));
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('queue is busy')).toBeNull());
  });

  it('AC4: counts the rest of the folder instead of rendering it when a preview is expanded', async () => {
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Expand/ }));
    // matching_count 3 minus the 2 previewed rows.
    await waitFor(() => expect(screen.getByText('1 more in this folder')).toBeTruthy());
  });

  it('AC4: keeps rendered rows under a fixed bound for a 200-group page with expanded previews', async () => {
    getQueueGroups.mockResolvedValue(
      makeResult(
        Array.from({ length: 200 }, (_, index) =>
          makeGroup(`Movie ${index}`, { needs_review: 12 }, Array.from({ length: 10 }, (_, item) => makeItem(`g${index}-${item}`)))
        ),
        200
      )
    );
    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows().length).toBeGreaterThan(0));

    const rendered = () => screen.getAllByTestId(/^triage-(group|item)-/).length;
    expect(rendered()).toBeLessThan(30);

    fireEvent.click(within(groupRows()[0]).getByRole('button', { name: /^Expand/ }));
    await waitFor(() => expect(screen.getAllByTestId(/^triage-item-/)).toHaveLength(10));
    expect(rendered()).toBeLessThan(30);

    const list = screen.getByTestId('triage-list');
    Object.defineProperty(list, 'scrollTop', { value: 6000, configurable: true });
    fireEvent.scroll(list);
    // Same bounded size, but a different slice of the 200 groups is mounted.
    await waitFor(() => expect(groupRows()[0].getAttribute('data-testid')).not.toBe('triage-group-movie|/movies/incoming|Movie 0'));
    expect(rendered()).toBeLessThan(30);
  });

  it('AC1: ignores a page response that arrives after a newer one', async () => {
    // Every filter or page change re-reads the server, and answers can come back out of order. The old
    // one must not repaint the list with rows the user has already asked to see less of.
    let resolveStale: (value: IngressQueueGroupsResult) => void = () => {};
    const stale = new Promise<IngressQueueGroupsResult>((resolve) => {
      resolveStale = resolve;
    });
    getQueueGroups
      .mockResolvedValueOnce(makeResult([smallGroup, hugeGroup], 40))
      .mockReturnValueOnce(stale)
      .mockResolvedValueOnce(makeResult([makeGroup('Alien (1979)', { needs_review: 2 })], 40));

    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    fireEvent.click(screen.getByLabelText('Go to next page'));
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalledTimes(2));

    // A second request goes out while page 2 is still in flight, and answers first.
    fireEvent.click(screen.getByRole('button', { name: 'Reload queue groups' }));
    await waitFor(() => expect(screen.getByText('/movies/incoming/Alien (1979)')).toBeTruthy());

    resolveStale(makeResult([smallGroup, hugeGroup], 40));
    await act(async () => {
      await stale;
    });

    expect(screen.getByText('/movies/incoming/Alien (1979)')).toBeTruthy();
    expect(screen.queryByText('/movies/incoming/Dune (2021)')).toBeNull();
  });

  it('AC3: keeps a group picked on another page when this page select-all runs', async () => {
    getQueueGroups
      .mockResolvedValueOnce(makeResult([smallGroup, hugeGroup], 40))
      .mockResolvedValueOnce(makeResult([makeGroup('Alien (1979)', { needs_review: 2 })], 40))
      .mockResolvedValueOnce(makeResult([smallGroup, hugeGroup], 40));

    render(<IngressTriageGroups />);
    await waitFor(() => expect(groupRows()).toHaveLength(2));

    const duneCheckbox = () => within(groupRows()[0]).getByRole('checkbox', { name: 'Select group /movies/incoming/Dune (2021)' });
    fireEvent.click(duneCheckbox());
    await waitFor(() => expect(duneCheckbox()).toBeChecked());

    fireEvent.click(screen.getByLabelText('Go to next page'));
    await waitFor(() => expect(screen.getByText('/movies/incoming/Alien (1979)')).toBeTruthy());

    // Picking this page must not quietly drop the group the user checked on the previous one: every
    // batch is scoped to a single group, and that one is still meant to be armed.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all groups on page' }));

    fireEvent.click(screen.getByLabelText('Go to previous page'));
    await waitFor(() => expect(getQueueGroups).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(duneCheckbox()).toBeChecked());
  });
});

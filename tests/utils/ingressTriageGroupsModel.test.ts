import { describe, expect, it } from 'vitest';

import type { IngressBulkResult, IngressQueueGroup, IngressQueueItem } from '@/service/ingress/IngressAutomationService';
import {
  GROUP_ROW_HEIGHT,
  MORE_ROW_HEIGHT,
  PREVIEW_ROW_HEIGHT,
  applyBulkResultToGroup,
  buildGroupBulkRequest,
  buildRowOffsets,
  buildTriageRows,
  describeBulkResult,
  formatAgeMs,
  formatConfidenceRange,
  getBulkFailureLines,
  getGroupActionCount,
  getGroupLabel,
  getGroupMoreLabel,
  getGroupSelectionState,
  getGroupStatusChips,
  getOldestAgeLabel,
  getTriageWindow,
  needsActionConfirmation,
  optimisticGroupForAction,
  queueGroupSignature,
  toEpochMs,
  toggleGroupSelection,
  togglePreviewItemSelection,
} from '@/service/ingress/ingressTriageGroupsModel';

function makeGroup(overrides: Partial<IngressQueueGroup> = {}): IngressQueueGroup {
  return {
    group_key: { media_type: 'movie', ingress_path: '/movies/incoming', title: 'Dune (2021)' },
    media_type: 'movie',
    ingress_path: '/movies/incoming',
    title: 'Dune (2021)',
    source_folder: '/movies/incoming/Dune (2021)',
    item_count: 1940,
    matching_count: 1930,
    status_counts: { needs_review: 1920, failed: 10, completed: 10 },
    confidence_min: 60,
    confidence_max: 98,
    first_queued_at: '2024-01-01T00:00:00+00:00',
    last_queued_at: '2024-01-02T00:00:00+00:00',
    preview_items: [],
    ...overrides,
  };
}

function makeItem(id: string, status = 'needs_review'): IngressQueueItem {
  return { id, file_path: `/movies/incoming/${id}.mkv`, file_name: `${id}.mkv`, status, attempts: 0, queued_at: 0 };
}

function makeBulkResult(overrides: Partial<IngressBulkResult> = {}): IngressBulkResult {
  return {
    batch_id: 'batch-1',
    action: 'accept',
    requested: 3,
    succeeded: 2,
    failed: 1,
    skipped: 0,
    results: [{ item_id: 'item-9', action: 'accept', status: 'failed', item_status: 'failed', error: 'path missing' }],
    ...overrides,
  };
}

describe('ingressTriageGroupsModel', () => {
  it('keys a group by its grouping columns so selection survives a refetch', () => {
    expect(queueGroupSignature(makeGroup())).toBe('movie|/movies/incoming|Dune (2021)');
    expect(queueGroupSignature(makeGroup({ group_key: { media_type: 'movie', ingress_path: '/m', source_folder: '/m/x' } })))
      .toBe('movie|/m|/m/x');
  });

  it('counts only statuses the bulk action may touch', () => {
    const group = makeGroup();
    // completed rows are not acceptable, ignored rows are not ignorable.
    expect(getGroupActionCount(group, 'accept')).toBe(1930);
    expect(getGroupActionCount(group, 'accept', 5)).toBe(1925);
    expect(getGroupActionCount(makeGroup({ status_counts: { ignored: 4 } }), 'ignore')).toBe(0);
  });

  it('orders status chips by count for the densest chip first', () => {
    expect(getGroupStatusChips(makeGroup()).map((chip) => chip.status)).toEqual(['needs_review', 'failed', 'completed']);
  });

  it('labels a folder group by folder when grouping by folder', () => {
    expect(getGroupLabel(makeGroup(), 'source_folder')).toBe('/movies/incoming/Dune (2021)');
    expect(getGroupLabel(makeGroup(), 'parsed_title')).toBe('Dune (2021)');
  });

  it('treats a selection entry as all-selected and dropped ids as partial', () => {
    const group = makeGroup();
    const signature = queueGroupSignature(group);
    expect(getGroupSelectionState(group, {})).toBe('none');
    expect(getGroupSelectionState(group, { [signature]: [] })).toBe('all');
    expect(getGroupSelectionState(group, { [signature]: ['item-1'] })).toBe('partial');
  });

  it('cycles tri-state selection and excludes single preview rows', () => {
    const group = makeGroup();
    const signature = queueGroupSignature(group);
    const selected = toggleGroupSelection({}, group);
    expect(selected[signature]).toEqual([]);
    expect(toggleGroupSelection(selected, group)[signature]).toBeUndefined();

    const dropped = togglePreviewItemSelection(selected, group, 'item-3', false);
    expect(dropped[signature]).toEqual(['item-3']);
    expect(togglePreviewItemSelection(dropped, group, 'item-3', true)[signature]).toEqual([]);
    // Exclusion edits on an unselected group must not half-select it.
    expect(togglePreviewItemSelection({}, group, 'item-3', true)).toEqual({});
  });

  it('sends the group selector rather than the group ids, so one request covers the folder', () => {
    const group = makeGroup();
    expect(buildGroupBulkRequest('accept', group, [])).toEqual({
      action: 'accept',
      group: group.group_key,
      statuses: ['needs_review', 'failed'],
    });
    expect(buildGroupBulkRequest('ignore', group, ['item-1', 'item-2']).excludeItemIds).toEqual(['item-1', 'item-2']);
  });

  it('summarizes batch results including truncation at the server cap', () => {
    expect(describeBulkResult(makeBulkResult(), 'Dune (2021)')).toBe('2 accepted in Dune (2021) · 1 failed');
    expect(describeBulkResult(makeBulkResult({ failed: 0, skipped: 4, group_truncated: true, group_limit: 1000 }), 'X'))
      .toBe('2 accepted in X · 4 skipped · capped at 1000 items, run again for the rest');
    expect(getBulkFailureLines(makeBulkResult())).toEqual(['item-9: path missing']);
  });

  it('asks before acting on a batch larger than the confirm threshold', () => {
    expect(needsActionConfirmation(25)).toBe(false);
    expect(needsActionConfirmation(26)).toBe(true);
  });

  it('flattens expanded previews into rows and bounds the rendered window', () => {
    const groups = Array.from({ length: 40 }, (_, index) =>
      makeGroup({
        group_key: { media_type: 'movie', ingress_path: '/m', title: `Movie ${index}` },
        title: `Movie ${index}`,
        preview_items: Array.from({ length: 10 }, (_, item) => makeItem(`g${index}-${item}`)),
      })
    );

    // The expanded group also gets one "N more in this folder" row: 1930 matching - 10 previewed.
    const rows = buildTriageRows(groups, new Set(['movie|/m|Movie 0']));
    expect(rows).toHaveLength(40 + 10 + 1);
    expect(getGroupMoreLabel(groups[0])).toBe('1,920 more in this folder');
    expect(buildRowOffsets(rows)[rows.length]).toBe(40 * GROUP_ROW_HEIGHT + 10 * PREVIEW_ROW_HEIGHT + MORE_ROW_HEIGHT);

    const offsets = buildRowOffsets(rows);
    const atTop = getTriageWindow(rows, offsets, 0);
    expect(atTop.start).toBe(0);
    expect(atTop.end).toBeLessThan(25);
    expect(atTop.padTop).toBe(0);
    expect(atTop.padBottom).toBeGreaterThan(0);

    const midScroll = getTriageWindow(rows, offsets, 1500);
    expect(midScroll.start).toBeGreaterThan(atTop.end);
    expect(midScroll.end - midScroll.start).toBeLessThan(25);
    expect(offsets[midScroll.start]).toBeLessThanOrEqual(1500);
    expect(midScroll.padTop + (offsets[midScroll.end] - offsets[midScroll.start]) + midScroll.padBottom)
      .toBe(offsets[rows.length]);
  });

  it('moves the actionable counts to the action target while the batch is open', () => {
    const group = makeGroup({ status_counts: { needs_review: 3, failed: 1, completed: 1 } });
    // Accept touches pending/auto_assigned/needs_review/failed: 4 rows, and leaves `completed` alone.
    expect(optimisticGroupForAction(group, 'accept', 4).status_counts).toEqual({ needs_review: 0, failed: 0, completed: 5 });
    // Never move more than the group has, so a stale count cannot produce negative chips.
    expect(optimisticGroupForAction(group, 'accept', 99).status_counts).toEqual({ needs_review: 0, failed: 0, completed: 5 });
    expect(optimisticGroupForAction(group, 'ignore', 2).status_counts).toEqual({ needs_review: 1, failed: 1, completed: 1, ignored: 2 });
  });

  it('rekeys a group row from the batch response, including rows the cap left undetailed', () => {
    const group = makeGroup({ status_counts: { needs_review: 4, failed: 1 } });
    const result = makeBulkResult({
      requested: 5,
      succeeded: 4,
      failed: 1,
      results: [
        { item_id: 'item-1', action: 'accept', status: 'succeeded', item_status: 'auto_assigned' },
        { item_id: 'item-2', action: 'accept', status: 'succeeded', item_status: 'completed' },
        { item_id: 'item-9', action: 'accept', status: 'failed', item_status: 'failed', error: 'path missing' },
      ],
    });
    // 5 rows left the actionable set: the 2 detailed successes plus the detailed failure, and the 2
    // successes the server capped out of `results`, which land on the action's target status.
    // Counts stay conserved: 4 + 1 before, 1 + 1 + 3 after.
    expect(applyBulkResultToGroup(group, result).status_counts).toEqual({
      needs_review: 0,
      failed: 1,
      auto_assigned: 1,
      completed: 3,
    });
    // A skipped row was never touched, so its count is left where it was.
    expect(
      applyBulkResultToGroup(makeGroup({ status_counts: { completed: 2 } }), {
        ...makeBulkResult({ succeeded: 0, failed: 0, skipped: 2, results: [{ item_id: 'i', action: 'accept', status: 'skipped', item_status: 'completed', error: null }] }),
      }).status_counts
    ).toEqual({ completed: 2 });
  });

  it('reads both epoch and ISO queue stamps for the oldest-item age column', () => {
    expect(toEpochMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs('2024-01-01T00:00:00+00:00')).toBe(Date.parse('2024-01-01T00:00:00+00:00'));
    expect(toEpochMs(null)).toBeNull();
    expect(getOldestAgeLabel(makeGroup({ first_queued_at: 1_000 }), 1_061_000)).toBe('1m');
    expect(getOldestAgeLabel(makeGroup({ first_queued_at: null }))).toBe('—');
    expect(formatAgeMs(-1)).toBe('—');
  });

  it('formats a confidence spread as a range', () => {
    expect(formatConfidenceRange(makeGroup())).toBe('60–98%');
    expect(formatConfidenceRange(makeGroup({ confidence_max: 60 }))).toBe('60%');
    expect(formatConfidenceRange(makeGroup({ confidence_min: null, confidence_max: null }))).toBe('—');
  });
});

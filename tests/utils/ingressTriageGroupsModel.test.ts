import path from 'node:path';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { IngressAiSettings, IngressBulkResult, IngressQueueGroup, IngressQueueItem } from '@/service/ingress/IngressAutomationService';
import {
  BULK_ACTION_STATUSES,
  DEFAULT_AI_MIN_CONFIDENCE,
  GROUP_ROW_HEIGHT,
  MORE_ROW_HEIGHT,
  PREVIEW_ROW_HEIGHT,
  aiFloorChoices,
  applyBulkResultToGroup,
  buildGroupBulkRequest,
  buildRowOffsets,
  buildTriageRows,
  describeAcceptAction,
  describeAiClassifyError,
  describeBulkResult,
  formatAgeMs,
  formatConfidenceRange,
  getAiClassifyAnswers,
  getAiSettings,
  getBulkFailureLines,
  getGroupActionCount,
  getGroupAiSummaryLabel,
  getGroupLabel,
  getGroupMoreLabel,
  getGroupSelectionState,
  getGroupStatusChips,
  getItemAiLabel,
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

/**
 * Issue #36: triage reads the classifier's answer at `parsed_info["ai_classification"]` plus the per-group
 * roll-up the server computes, and turns both into text. These are the strings a reviewer decides on, so
 * they are pinned here as well as through a render.
 */
describe('the Jev answer and its confidence floor (#36)', () => {
  const shadow: IngressAiSettings = { mode: 'shadow', min_confidence: 0.7 };
  const off: IngressAiSettings = { mode: 'off', min_confidence: 0.7 };

  it('reads an absent setting as mode off, and clamps a mode the backend does not speak', () => {
    expect(getAiSettings()).toEqual({ mode: 'off', min_confidence: DEFAULT_AI_MIN_CONFIDENCE });
    expect(getAiSettings({ mode: 'aggressive' as unknown as 'off', min_confidence: 3 })).toEqual({ mode: 'off', min_confidence: 1 });
    // A reviewer cannot pick a threshold under the configured floor, so it is not offered to them.
    expect(aiFloorChoices(0.7)).toEqual([0.7, 0.8, 0.9]);
  });

  it('states the answer with its confidence and what the mode makes of it', () => {
    const answered = makeItem('item-1');
    answered.parsed_info = { ai_classification: { label: 'alternate_version', confidence: 0.825, model: 'jev-decisions' } };
    const label = getItemAiLabel(answered, shadow);
    expect(label.answered).toBe(true);
    expect(label.text).toBe('alt 83%');
    expect(label.detail).toContain('Jev says alternate version at 83% by jev-decisions');
    expect(label.detail).toContain('shadow mode: advisory only');
  });

  it('says so out loud when a file has no answer, and why when the model failed', () => {
    expect(getItemAiLabel(makeItem('item-2'), off)).toEqual({
      text: 'no AI',
      detail: 'No Jev answer — AI is off, so there is no answer to show',
      answered: false,
    });

    const failed = makeItem('item-3');
    failed.parsed_info = { ai_classification_failed: 'model unreachable' };
    expect(getItemAiLabel(failed, shadow).text).toBe('AI failed');
    expect(getItemAiLabel(failed, shadow).detail).toBe('Jev could not classify this file: model unreachable');

    // An answer outside the classifier's own label set reads as no answer, never as a guess.
    const unknown = makeItem('item-4');
    unknown.parsed_info = { ai_classification: { label: 'bonus_features' as unknown as 'main_feature', confidence: 0.9 } };
    expect(getItemAiLabel(unknown, shadow).answered).toBe(false);
  });

  it('rolls a folder up into answered, agreeing, conflicting and weakest answer', () => {
    const group = makeGroup({
      matching_count: 6,
      ai_summary: { answered: 4, missing: 2, agree: 3, conflict: 1, min_confidence: 0.612 },
    });
    expect(getGroupAiSummaryLabel(group, shadow)).toBe('Jev 4/6 answered · 3 agree · 1 conflict · min 61%');
    expect(getGroupAiSummaryLabel(makeGroup({ matching_count: 4 }), shadow))
      .toBe('Jev: no answers in 4 files — shadow mode: advisory only, it never changes the queue status');
    expect(getGroupAiSummaryLabel(makeGroup({ matching_count: 1, ai_summary: { answered: 0, missing: 1, agree: 0, conflict: 0, min_confidence: null } }), off))
      .toBe('Jev: no answers in 1 file — AI is off, so there is no answer to show');
  });

  it('sends the reviewer-picked floor only for accept, and names it on the button', () => {
    const group = makeGroup();
    expect(buildGroupBulkRequest('accept', group, [], 0.8).min_confidence).toBe(0.8);
    expect(buildGroupBulkRequest('accept', group, [], 0)).toHaveProperty('min_confidence', 0);
    expect(buildGroupBulkRequest('accept', group, [])).not.toHaveProperty('min_confidence');
    expect(buildGroupBulkRequest('ignore', group, [], null)).not.toHaveProperty('min_confidence');

    // "Accept 12" and "Accept 12 at 80 percent" are different requests, so the name has to say which.
    expect(describeAcceptAction(12, null)).toEqual({ text: 'Accept 12', ariaLabel: 'Accept 12 in this group' });
    expect(describeAcceptAction(1, 0.8)).toEqual({ text: 'Accept 1 ≥ 80%', ariaLabel: 'Accept 1 items ≥ 80% confidence in this group' });
  });

  it('reports the rows the floor left out, with the floor the server actually applied', () => {
    const result = makeBulkResult({
      succeeded: 2,
      failed: 0,
      skipped: 3,
      confidence_floor: 0.8,
      results: [{ item_id: 'low-confidence', action: 'accept', status: 'skipped', item_status: 'needs_review', error: 'Jev confidence 0.55 is under the 0.8 floor' }],
    });
    expect(describeBulkResult(result, 'Dune (2021)')).toBe('2 accepted in Dune (2021) · 3 skipped · Jev confidence floor 80%');
    // A row the floor declined was not acted on, so it is not a failure and never lands in the list.
    expect(getBulkFailureLines(result)).toEqual([]);
  });

  it('counts a re-classify answer whichever shape the route sent it', () => {
    // GET-style listings answer by array; the queue service keys a folder's answers by item id.
    const asArray = { mode: 'shadow', classifications: [{ item_id: 'a', label: 'main_feature', confidence: 0.9 }] };
    const asMap = { mode: 'shadow', classifications: { a: { label: 'main_feature', confidence: 0.9 }, b: { error: 'unreadable' } } };
    expect(getAiClassifyAnswers(asArray).length).toBe(1);
    expect(getAiClassifyAnswers(asMap).length).toBe(2);
    // Only a labelled entry counts as answered, and a backend that answered nothing says so as 0.
    expect(getAiClassifyAnswers(asMap).filter((answer) => answer?.label).length).toBe(1);
    expect(getAiClassifyAnswers({ mode: 'assist' } as never)).toEqual([]);
    expect(getAiClassifyAnswers()).toEqual([]);
  });

  it('translates "this backend has no classifier" instead of showing the raw 503 body', () => {
    expect(describeAiClassifyError(new Error('502 {"detail":{"code":"INGEST_AI_NOT_CONFIGURED"}}')))
      .toBe('No Jev classifier on this backend — set MEDIA_LIBRARY_INGEST_AI_MODE to shadow or assist to get answers');
    expect(describeAiClassifyError(new Error('boom'))).toBe('boom');
    expect(describeAiClassifyError(null)).toBe('Jev classification failed');
  });
});

/**
 * The folder view sends `statuses` to narrow a group batch, and the backend reports anything outside
 * its own list as not acted on, so the two lists have to agree. Rather than restate the backend table
 * here, read its rule out of the file it lives in: a change on one side fails on the other.
 */
const BACKEND = {
  queue: path.join(process.cwd(), 'backend/services/ingress_queue_service.py'),
  triage: path.join(process.cwd(), 'backend/services/ingress_triage_service.py'),
};

/** `QUEUE_NEEDS_REVIEW = "needs_review"` and friends: the names the bulk rules are written with. */
function queueStatusConstants(): Record<string, string> {
  const source = readFileSync(BACKEND.queue, 'utf8');
  const constants: Record<string, string> = {};
  const declaration = /^(QUEUE_[A-Z_]+) = "([a-z_]+)"$/gm;
  let found = declaration.exec(source);
  while (found) {
    constants[found[1]] = found[2];
    found = declaration.exec(source);
  }
  expect(Object.keys(constants).length).toBeGreaterThan(0);
  return constants;
}

function asStatusList(names: string, constants: Record<string, string>): string[] {
  const statuses = names
    .split(',')
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
    .map((name) => constants[name] ?? name);
  expect(statuses.length).toBeGreaterThan(0);
  return statuses;
}

/** A list the backend writes out status by status, e.g. `("pending", "needs_review", "failed")`. */
function backendLiteralStatuses(action: string): string[] {
  const rule = new RegExp(`${action}: \\(([^)]*)\\)`).exec(readFileSync(BACKEND.triage, 'utf8'));
  if (!rule) throw new Error(`${action} is no longer a literal tuple in the backend — re-sync the frontend mirror`);
  return asStatusList(rule[1], {});
}

/** A list the backend derives, e.g. `tuple(status for status in QUEUE_ALL_STATUSES if status not in (...))`. */
function backendDerivedStatuses(action: string): string[] {
  const constants = queueStatusConstants();
  const all = /QUEUE_ALL_STATUSES = \(\s*([^)]*)\)/.exec(readFileSync(BACKEND.queue, 'utf8'));
  if (!all) throw new Error('QUEUE_ALL_STATUSES is no longer a tuple in the backend — re-sync the frontend mirror');

  const rule = new RegExp(
    `${action}:\\s*tuple\\(\\s*status for status in QUEUE_ALL_STATUSES if status not in \\(([^)]*)\\)`
  ).exec(readFileSync(BACKEND.triage, 'utf8'));
  if (!rule) throw new Error(`${action} no longer derives from QUEUE_ALL_STATUSES — re-sync the frontend mirror`);

  const every = asStatusList(all[1], constants);
  const excluded = asStatusList(rule[1], constants);
  return every.filter((status) => !excluded.includes(status));
}

describe('bulk action statuses mirror the backend table', () => {
  it('never ignores a row the auto-processor is still holding', () => {
    expect(BULK_ACTION_STATUSES.ignore).toEqual(backendDerivedStatuses('BULK_IGNORE'));
    expect(BULK_ACTION_STATUSES.ignore).not.toContain('processing');
  });

  it('accepts, retries and classifies the statuses the backend will act on', () => {
    expect(BULK_ACTION_STATUSES.accept).toEqual(backendDerivedStatuses('BULK_ACCEPT'));
    expect(BULK_ACTION_STATUSES.retry).toEqual(backendLiteralStatuses('BULK_RETRY'));
    expect(BULK_ACTION_STATUSES.classify).toEqual(backendLiteralStatuses('BULK_CLASSIFY'));
  });

  it('keeps a processing row out of the batch request a folder-wide ignore posts', () => {
    const group = makeGroup({ status_counts: { processing: 4, needs_review: 2, ignored: 3 } });
    expect(buildGroupBulkRequest('ignore', group, []).statuses).toEqual(['needs_review']);
    expect(buildGroupBulkRequest('accept', group, []).statuses).toEqual(['needs_review']);
  });
});

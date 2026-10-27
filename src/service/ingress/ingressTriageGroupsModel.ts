import type {
  IngressAiSettings,
  IngressAIClassification,
  IngressBulkAction,
  IngressBulkRequest,
  IngressBulkResult,
  IngressQueueGroup,
  IngressQueueItem,
  QueueGroupBy,
} from './IngressAutomationService';
import { STATUS_COLORS, type QueueChipColor } from './ingressQueueModel';

export const QUEUE_GROUP_BY_OPTIONS: Array<{ value: QueueGroupBy; label: string }> = [
  { value: 'source_folder', label: 'Source folder' },
  { value: 'parsed_title', label: 'Parsed title' },
];

export const QUEUE_GROUP_STATUS_OPTIONS = [
  'all',
  'needs_review',
  'pending',
  'auto_assigned',
  'failed',
  'completed',
  'ignored',
];

/**
 * Mirrors BULK_ACTION_STATUSES in backend/services/ingress_triage_service.py (pinned by
 * tests/utils/ingressTriageGroupsModel.test.ts). `processing` is excluded from ignore exactly as the
 * backend excludes it: the auto-processor holds those rows and would overwrite the outcome when it
 * persists, so they settle on their own instead of being ignored under a running job.
 */
export const BULK_ACTION_STATUSES: Record<IngressBulkAction, string[]> = {
  accept: ['pending', 'auto_assigned', 'needs_review', 'failed'],
  ignore: ['pending', 'auto_assigned', 'needs_review', 'failed', 'completed'],
  retry: ['pending', 'needs_review', 'failed'],
  classify: ['pending', 'auto_assigned', 'needs_review', 'failed'],
};

export const GROUP_ROWS_PER_PAGE_OPTIONS = [10, 25, 50];
export const GROUP_PREVIEW_SIZE = 10;

/** Ignore is only undoable from the history log, so anything bigger than this asks first. */
export const CONFIRM_ACTION_THRESHOLD = 25;

/** Status a bulk action leaves its items in, mirroring `IngressQueueService` (`mark_complete` -> completed). */
export const BULK_ACTION_TARGET_STATUS: Record<IngressBulkAction, string> = {
  accept: 'completed',
  ignore: 'ignored',
  retry: 'pending',
  classify: 'needs_review',
};

// Windowed list geometry. Row heights are fixed, so the scroll window is arithmetic rather than measured.
export const GROUP_ROW_HEIGHT = 76;
export const PREVIEW_ROW_HEIGHT = 40;
export const MORE_ROW_HEIGHT = 28;
export const GROUP_LIST_HEIGHT = 520;
export const WINDOW_OVERSCAN = 3;

export type GroupSelectionMap = Record<string, string[]>;
export type GroupSelectionState = 'none' | 'partial' | 'all';

export type TriageRow =
  | { key: string; kind: 'group'; group: IngressQueueGroup; height: number }
  | { key: string; kind: 'item'; group: IngressQueueGroup; item: IngressQueueItem; height: number }
  | { key: string; kind: 'more'; group: IngressQueueGroup; label: string; height: number };

export function queueGroupSignature(group: IngressQueueGroup): string {
  const { media_type: mediaType, ingress_path: ingressPath } = group.group_key;
  const third = group.group_key.title || group.group_key.source_folder || '';
  return `${mediaType}|${ingressPath}|${third}`;
}

export function getGroupLabel(group: IngressQueueGroup, groupBy: QueueGroupBy): string {
  const label = groupBy === 'source_folder' ? group.source_folder : group.title;
  return label || group.source_folder || '(unparsed)';
}

export function getGroupSubLabel(group: IngressQueueGroup): string {
  return `${group.media_type === 'unclassified' ? 'unclassified' : group.media_type} · ${group.ingress_path || '/'}`;
}

export function getGroupActionCount(group: IngressQueueGroup, action: IngressBulkAction, excluded = 0): number {
  const total = BULK_ACTION_STATUSES[action].reduce((sum, status) => sum + (group.status_counts[status] || 0), 0);
  return Math.max(0, total - excluded);
}

export function getGroupStatusChips(group: IngressQueueGroup): Array<{ status: string; count: number; color: QueueChipColor }> {
  return Object.entries(group.status_counts || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({ status, count, color: STATUS_COLORS[status] || 'default' }));
}

export function getQueueStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function getGroupSelectionState(group: IngressQueueGroup, selection: GroupSelectionMap): GroupSelectionState {
  const excluded = selection[queueGroupSignature(group)];
  if (!excluded) {
    return 'none';
  }
  return excluded.length === 0 ? 'all' : 'partial';
}

/** Tri-state cycle: anything short of fully selected selects the whole group, otherwise clears it. */
export function toggleGroupSelection(selection: GroupSelectionMap, group: IngressQueueGroup): GroupSelectionMap {
  const signature = queueGroupSignature(group);
  const next = { ...selection };
  if (next[signature]) {
    delete next[signature];
  } else {
    next[signature] = [];
  }
  return next;
}

/** Drop one preview item out of an already-selected group; re-checking it puts the item back. */
export function togglePreviewItemSelection(
  selection: GroupSelectionMap,
  group: IngressQueueGroup,
  itemId: string,
  checked: boolean
): GroupSelectionMap {
  const signature = queueGroupSignature(group);
  if (!selection[signature]) {
    return selection;
  }
  const excluded = new Set(selection[signature]);
  if (checked) {
    excluded.delete(itemId);
  } else {
    excluded.add(itemId);
  }
  return { ...selection, [signature]: Array.from(excluded) };
}

/**
 * One request per group: the server resolves the group's ids, so the browser never holds a 1,940-id
 * payload. `statuses` keeps non-actionable rows out of the batch (see BULK_ACTION_STATUSES).
 */
export function buildGroupBulkRequest(
  action: IngressBulkAction,
  group: IngressQueueGroup,
  excludedItemIds: string[],
  minConfidence?: number | null
): IngressBulkRequest {
  const request: IngressBulkRequest = {
    action,
    group: group.group_key,
    statuses: BULK_ACTION_STATUSES[action].filter((status) => (group.status_counts[status] || 0) > 0),
  };
  if (excludedItemIds.length > 0) {
    request.excludeItemIds = excludedItemIds;
  }
  // Only accept carries a Jev floor, and only when the reviewer picked one: without it the batch is the
  // plain #35 accept. The server still raises it to MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE.
  if (minConfidence !== null && minConfidence !== undefined) {
    request.min_confidence = minConfidence;
  }
  return request;
}

const ACTION_VERBS: Record<string, string> = {
  accept: 'accepted',
  ignore: 'ignored',
  retry: 'retried',
  classify: 'reclassified',
};

export function describeBulkResult(result: IngressBulkResult, groupLabel: string): string {
  const parts = [`${result.succeeded} ${ACTION_VERBS[result.action] || result.action} in ${groupLabel}`];
  if (result.failed > 0) {
    parts.push(`${result.failed} failed`);
  }
  if (result.skipped > 0) {
    parts.push(`${result.skipped} skipped`);
  }
  if (result.group_truncated) {
    parts.push(`capped at ${result.group_limit} items, run again for the rest`);
  }
  if (typeof result.confidence_floor === 'number') {
    // Worth naming separately: it can be higher than the reviewer picked, because the configured
    // MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE is a floor a request cannot lower.
    parts.push(`Jev confidence floor ${formatAiConfidence(result.confidence_floor)}`);
  }
  return parts.join(' · ');
}

export function getBulkFailureLines(result: IngressBulkResult, limit = 3): string[] {
  const failures = result.results.filter((row) => row.status === 'failed');
  const lines = failures.slice(0, limit).map((row) => `${row.item_id}: ${row.error || 'action failed'}`);
  if (failures.length > limit) {
    lines.push(`${failures.length - limit} more failures in the history log`);
  }
  return lines;
}

export function needsActionConfirmation(count: number): boolean {
  return count > CONFIRM_ACTION_THRESHOLD;
}

export function buildTriageRows(groups: IngressQueueGroup[], expanded: Set<string>): TriageRow[] {
  return groups.flatMap((group) => {
    const rows: TriageRow[] = [{ key: `group:${queueGroupSignature(group)}`, kind: 'group', group, height: GROUP_ROW_HEIGHT }];
    if (expanded.has(queueGroupSignature(group))) {
      (group.preview_items || []).forEach((item) => {
        rows.push({ key: `item:${item.id}`, kind: 'item', group, item, height: PREVIEW_ROW_HEIGHT });
      });
      const more = getGroupMoreLabel(group);
      if (more) {
        rows.push({ key: `more:${queueGroupSignature(group)}`, kind: 'more', group, label: more, height: MORE_ROW_HEIGHT });
      }
    }
    return rows;
  });
}

/** A group is only ever previewed: the rest of the folder stays server-side (AC: select-group never id-fetches). */
export function getGroupMoreLabel(group: IngressQueueGroup): string {
  const remaining = Math.max(0, (group.matching_count || 0) - (group.preview_items || []).length);
  return remaining > 0 ? `${formatGroupCount(remaining)} more in this folder` : '';
}

/** Move up to `count` rows out of `from` into `to`; stops early when the local counts run out. */
function shiftStatusCounts(
  counts: Record<string, number>,
  from: string[],
  to: string,
  count: number
): Record<string, number> {
  const next = { ...counts };
  let moved = 0;
  from.forEach((status) => {
    if (moved >= count) {
      return;
    }
    const shift = Math.min(next[status] || 0, count - moved);
    if (shift > 0) {
      next[status] = (next[status] || 0) - shift;
      moved += shift;
    }
  });
  if (to && moved > 0) {
    next[to] = (next[to] || 0) + moved;
  }
  return next;
}

/** Status counts as they should look while the batch is in flight; revert by restoring the fetched group. */
export function optimisticGroupForAction(
  group: IngressQueueGroup,
  action: IngressBulkAction,
  count: number
): IngressQueueGroup {
  return {
    ...group,
    status_counts: shiftStatusCounts(group.status_counts, BULK_ACTION_STATUSES[action], BULK_ACTION_TARGET_STATUS[action], count),
  };
}

/**
 * Re-key the row off the batch response instead of refetching the page: per-item statuses when the
 * server detailed them, the action's target status for the rows a truncated batch left undetailed.
 */
export function applyBulkResultToGroup(group: IngressQueueGroup, result: IngressBulkResult): IngressQueueGroup {
  const action = (Object.keys(BULK_ACTION_STATUSES) as IngressBulkAction[]).includes(result.action as IngressBulkAction)
    ? (result.action as IngressBulkAction)
    : 'accept';
  const detailed = result.results || [];
  const succeeded = detailed.filter((row) => row.status === 'succeeded');
  const failed = detailed.filter((row) => row.status === 'failed');
  // A large batch only details part of its rows, so the totals decide how many leave the actionable
  // statuses and the details decide where the first ones land.
  const attemptedSucceeded = Math.max(result.succeeded || 0, succeeded.length);
  const attemptedFailed = Math.max(result.failed || 0, failed.length);
  const target = BULK_ACTION_TARGET_STATUS[action];

  const counts = shiftStatusCounts(
    group.status_counts,
    BULK_ACTION_STATUSES[action],
    '',
    attemptedSucceeded + attemptedFailed
  );
  succeeded.forEach((row) => {
    const status = row.item_status || target;
    counts[status] = (counts[status] || 0) + 1;
  });
  failed.forEach((row) => {
    const status = row.item_status || 'failed';
    counts[status] = (counts[status] || 0) + 1;
  });
  const undetailedSucceeded = attemptedSucceeded - succeeded.length;
  const undetailedFailed = attemptedFailed - failed.length;
  if (undetailedSucceeded > 0) {
    counts[target] = (counts[target] || 0) + undetailedSucceeded;
  }
  if (undetailedFailed > 0) {
    counts.failed = (counts.failed || 0) + undetailedFailed;
  }
  return { ...group, status_counts: counts };
}

/** Cumulative row offsets, so the visible window is found by lookup instead of by rendering everything. */
export function buildRowOffsets(rows: TriageRow[]): number[] {
  const offsets: number[] = [0];
  rows.forEach((row) => offsets.push(offsets[offsets.length - 1] + row.height));
  return offsets;
}

export interface TriageWindow {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

export function getTriageWindow(
  rows: TriageRow[],
  offsets: number[],
  scrollTop: number,
  viewportHeight = GROUP_LIST_HEIGHT,
  overscan = WINDOW_OVERSCAN
): TriageWindow {
  if (rows.length === 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }

  const firstVisible = findRowIndexAt(offsets, scrollTop, rows.length);
  const lastVisible = findRowIndexAt(offsets, Math.min(scrollTop + viewportHeight, offsets[rows.length] - 1), rows.length);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(rows.length, Math.max(lastVisible + 1 + overscan, start + 1));

  return {
    start,
    end,
    padTop: offsets[start],
    padBottom: Math.max(0, offsets[rows.length] - offsets[end]),
  };
}

/** Index of the row covering `position` in the cumulative offsets array. */
function findRowIndexAt(offsets: number[], position: number, rowCount: number): number {
  let low = 0;
  let high = rowCount - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle + 1] <= position) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export function toEpochMs(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value < 1e11 ? value * 1000 : value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatAgeMs(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return '—';
  }
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

export function getOldestAgeLabel(group: IngressQueueGroup, nowMs: number = Date.now()): string {
  const oldest = toEpochMs(group.first_queued_at);
  return oldest === null ? '—' : formatAgeMs(nowMs - oldest);
}

export function formatConfidenceRange(group: IngressQueueGroup): string {
  if (group.confidence_min === null || group.confidence_max === null) {
    return '—';
  }
  return group.confidence_min === group.confidence_max
    ? `${group.confidence_min}%`
    : `${group.confidence_min}–${group.confidence_max}%`;
}

export function formatGroupCount(count: number): string {
  return count.toLocaleString('en-US');
}

// --- Jev ingest classifier, as triage reads it (issue #36) --------------------------------------
// The answers themselves are produced by the classifier (services/ingest_ai_classifier.py on
// feat/jev-ingest-decisions) and stored at parsed_info["ai_classification"]. Triage only reads that
// shape, so every helper below treats a missing answer as normal: AI off means no answer, not an error.

export const DEFAULT_AI_MIN_CONFIDENCE = 0.7;
/** Thresholds the triage toolbar offers. Anything under the configured floor is filtered out. */
export const AI_CONFIDENCE_FLOOR_CHOICES = [0.6, 0.7, 0.8, 0.9];

// The 90px answer column cannot hold `alternate_version 100%`; the full label goes in the title.
const AI_LABEL_SHORT: Record<string, string> = {
  main_feature: 'main',
  alternate_version: 'alt',
  special_feature: 'special',
};

// What each mode means for the answer on screen: `shadow` is advisory only and never moves a row.
const AI_MODE_HINT: Record<string, string> = {
  off: 'AI is off, so there is no answer to show',
  shadow: 'shadow mode: advisory only, it never changes the queue status',
  assist: 'assist mode: a confident answer acts like a classification override',
};

export function getAiSettings(settings?: IngressAiSettings): IngressAiSettings {
  const mode = settings?.mode === 'shadow' || settings?.mode === 'assist' ? settings.mode : 'off';
  const floor = typeof settings?.min_confidence === 'number' ? Math.min(Math.max(settings.min_confidence, 0), 1) : DEFAULT_AI_MIN_CONFIDENCE;
  return { mode, min_confidence: floor };
}

/** Thresholds a reviewer may pick: never below the configured floor they cannot lower. */
export function aiFloorChoices(floor: number): number[] {
  return AI_CONFIDENCE_FLOOR_CHOICES.filter((choice) => choice >= floor);
}

export function formatAiConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** The stored Jev answer, or null when this file has none (AI off, not yet run, or it failed). */
export function getAiAnswer(item: IngressQueueItem): IngressAIClassification | null {
  const answer = item.parsed_info?.ai_classification;
  if (!answer || AI_LABEL_SHORT[answer.label] === undefined || typeof answer.confidence !== 'number') {
    return null;
  }
  return answer;
}

/** Answer text for a preview row. Always returned, answered or not, so the row height never shifts. */
export function getItemAiLabel(
  item: IngressQueueItem,
  ai: IngressAiSettings
): { text: string; detail: string; answered: boolean } {
  const answer = getAiAnswer(item);
  if (!answer) {
    const failure = item.parsed_info?.ai_classification_failed;
    return {
      text: failure ? 'AI failed' : 'no AI',
      detail: failure ? `Jev could not classify this file: ${failure}` : `No Jev answer — ${AI_MODE_HINT[ai.mode]}`,
      answered: false,
    };
  }
  const model = answer.model ? ` by ${answer.model}` : '';
  return {
    text: `${AI_LABEL_SHORT[answer.label]} ${formatAiConfidence(answer.confidence)}`,
    detail: `Jev says ${answer.label.replace(/_/g, ' ')} at ${formatAiConfidence(answer.confidence)}${model} — ${AI_MODE_HINT[ai.mode]}`,
    answered: true,
  };
}

/** Agree / conflict / weakest answer across a group, for the group row's third line. */
export function getGroupAiSummaryLabel(group: IngressQueueGroup, ai: IngressAiSettings): string {
  const summary = group.ai_summary;
  if (!summary || summary.answered === 0) {
    const files = summary ? summary.missing : group.matching_count;
    return `Jev: no answers in ${formatGroupCount(files)} file${files === 1 ? '' : 's'} — ${AI_MODE_HINT[ai.mode]}`;
  }
  const weakest = summary.min_confidence === null ? '—' : formatAiConfidence(summary.min_confidence);
  return `Jev ${summary.answered}/${summary.answered + summary.missing} answered · ${summary.agree} agree · ${summary.conflict} conflict · min ${weakest}`;
}

/**
 * A 503 from /queue/ai-classify arrives as the raw JSON body the service throws with. Translate the one
 * code that means "this backend has no classifier at all" (the classifier lands on
 * feat/jev-ingest-decisions) into something a reviewer can act on; anything else is reported verbatim.
 */
export function describeAiClassifyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('INGEST_AI_NOT_CONFIGURED')) {
    return 'No Jev classifier on this backend — set MEDIA_LIBRARY_INGEST_AI_MODE to shadow or assist to get answers';
  }
  return message || 'Jev classification failed';
}

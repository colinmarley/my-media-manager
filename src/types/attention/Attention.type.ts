/**
 * The To-Do (attention) list as the backend reports it (backend/api/attention.py,
 * backend/services/attention_service.py).
 */
import { MediaFile } from '../library/MediaFile.type';

export type AttentionKind =
  | 'needs_assignment'
  | 'needs_rename'
  | 'needs_review'
  | 'missing_file'
  | 'no_disc_link'
  | 'unprobed'
  | 'unripped_disc';

export type AttentionSubjectType = 'media_file' | 'queue_item' | 'disc' | 'title' | 'finding';

export type AttentionSeverity = 'high' | 'medium' | 'low';

/** GET /api/attention/summary. `total` leaves out `unprobed` and `unripped_disc`. */
export interface AttentionSummary {
  counts: Record<AttentionKind, number>;
  total: number;
  generatedAt: string | null;
}

export interface AttentionQueueInfo {
  status: string | null;
  reviewReason: string | null;
  lastError: string | null;
  confidence: number | null;
  bestMatchTitle: string | null;
  bestMatchYear: number | null;
  bestMatchMediaType: string | null;
  proposedPath: string | null;
}

export interface AttentionItem {
  /** "<kind>:<subjectType>:<subjectId>" */
  id: string;
  kind: AttentionKind;
  subjectType: AttentionSubjectType;
  subjectId: string;
  title: string;
  /** One sentence: what is wrong and what fixes it. */
  detail: string;
  severity: AttentionSeverity;
  mediaType: string | null;
  mediaId: string | null;
  mediaTitle: string | null;
  catalogType: 'movie' | 'series' | null;
  filePath: string | null;
  relativePath: string | null;
  current: string | null;
  expected: string | null;
  queueItemId: string | null;
  discId: string | null;
  file: MediaFile | null;
  createdAt: string | null;
  dismissible: boolean;
  fingerprint: string | null;
  reasons: string[];
  queue: AttentionQueueInfo | null;
}

/** GET /api/attention/items */
export interface AttentionItemsResponse {
  items: AttentionItem[];
  total: number;
}

export interface AttentionItemsQuery {
  /** One kind or several (sent comma-separated). */
  kind?: AttentionKind | AttentionKind[];
  /** `mediaType` and `mediaId` go together: they narrow the list to one title. */
  mediaType?: string;
  mediaId?: string;
  limit?: number;
  offset?: number;
}

/** POST /api/attention/dismiss */
export interface DismissRequest {
  kind: AttentionKind;
  subjectType: AttentionSubjectType;
  subjectId: string;
  /** null / omitted: until the underlying fact changes. */
  days?: number | null;
  note?: string;
}

export interface AttentionDismissal {
  id: string;
  itemId: string;
  kind: AttentionKind;
  subjectType: AttentionSubjectType;
  subjectId: string;
  fingerprint: string | null;
  dismissedUntil: string | null;
  note: string | null;
  createdAt: string | null;
}

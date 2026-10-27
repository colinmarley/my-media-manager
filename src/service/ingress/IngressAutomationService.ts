import { INGRESS_TIMEOUT_ERROR_NAME } from './ingressQueueModel';

export interface IngressWatcherStatus {
  is_running: boolean;
  watched_paths: string[];
  pending_count: number;
  queue_count: number;
  processed_event_count: number;
  process_existing_queued?: number;
  process_existing_started?: boolean;
  initial_queue?: {
    in_progress: boolean;
    scanned_files: number;
    queued_files: number;
    started_at?: number | null;
    completed_at?: number | null;
    last_file?: string | null;
    last_error?: string | null;
  };
}

export interface StartWatcherOptions {
  usePolling?: boolean;
  recursive?: boolean;
  processExistingFiles?: boolean;
}

export interface IngressQueueStatus {
  total: number;
  counts: Record<string, number>;
  recent: Array<Record<string, any>>;
}

export type QueueClassificationOverride = 'auto' | 'main_feature' | 'special_feature' | 'alternate_version';

export interface IngressQueueItem {
  id: string;
  file_path: string;
  file_name: string;
  status: string;
  confidence_score?: number;
  attempts: number;
  last_error?: string;
  assignment_id?: string;
  queued_at: number;
  processed_at?: number;
  media_duration_ms?: number | null;
  proposed_path?: string | null;
  classification_override?: QueueClassificationOverride | null;
  is_alternate_version?: boolean;
  version_number?: number;
  special_feature_number?: number;
  best_match?: {
    title?: string;
    year?: number;
    media_type?: string;
    season?: number;
    episode?: number;
    source?: string;
    confidence_score?: number;
  };
  parsed_info?: {
    title?: string;
    year?: number;
    media_type?: string;
    season?: number;
    episode?: number;
    quality?: string;
    classification_hint?: string;
    is_companion?: boolean;
    /** The Jev answer for this file, when the classifier has produced one. */
    ai_classification?: IngressAIClassification;
    /** Set when the model ran and failed, so "no answer" can say why. */
    ai_classification_failed?: string;
  };
}

/**
 * The Jev ingest classifier's answer, at exactly the shape `parsed_info["ai_classification"]` carries
 * (services/ingest_ai_classifier.py, feat/jev-ingest-decisions). Triage only reads it: it never
 * produces one, and a manual `classification_override` always outranks it.
 */
export interface IngressAIClassification {
  label: 'main_feature' | 'alternate_version' | 'special_feature';
  /** 0-1, as the model reported it. */
  confidence: number;
  probabilities?: Record<string, number>;
  model?: string;
  group_size?: number;
  latency_ms?: number;
  /** Epoch seconds, as the classifier stamps it. */
  classified_at?: number;
  demoted_from_main?: boolean;
}

/** Per-group roll-up of the Jev answers among that group's triageable items (issue #36). */
export interface IngressGroupAiSummary {
  answered: number;
  missing: number;
  agree: number;
  conflict: number;
  /** The weakest answer in the group: what an "accept ≥ threshold" would have to clear. */
  min_confidence: number | null;
}

/** How those answers were produced, and the floor a bulk accept cannot go under. */
export interface IngressAiSettings {
  mode: 'off' | 'shadow' | 'assist';
  min_confidence: number;
}

export type QueueGroupBy = 'parsed_title' | 'source_folder';

/** Keys a group row back to the rows it groups (matches `group_key` in GET /queue/groups). */
export interface IngressQueueGroupKey {
  media_type: string;
  ingress_path: string;
  title?: string | null;
  source_folder?: string | null;
}

export interface IngressQueueGroup {
  group_key: IngressQueueGroupKey;
  media_type: string;
  ingress_path: string;
  title: string | null;
  source_folder: string | null;
  item_count: number;
  matching_count: number;
  status_counts: Record<string, number>;
  confidence_min: number | null;
  confidence_max: number | null;
  ai_summary?: IngressGroupAiSummary;
  first_queued_at: number | string | null;
  last_queued_at: number | string | null;
  preview_items: IngressQueueItem[];
}

export interface IngressQueueGroupsResult {
  groups: IngressQueueGroup[];
  total_groups: number;
  total_items: number;
  status_counts: Record<string, number>;
  /** Absent only from a backend predating issue #36; the UI treats that as mode "off". */
  ai?: IngressAiSettings;
  group_by: QueueGroupBy;
  limit: number;
  offset: number;
  preview_size: number;
}

export type IngressBulkAction = 'accept' | 'ignore' | 'retry' | 'classify';

export interface IngressBulkResultRow {
  item_id: string;
  action: string;
  status: 'succeeded' | 'failed' | 'skipped';
  item_status?: string | null;
  error?: string | null;
}

export interface IngressBulkResult {
  batch_id: string;
  action: string;
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  group_truncated?: boolean;
  group_limit?: number;
  /** The threshold items were really gated on: the requested one, raised to the configured floor. */
  confidence_floor?: number | null;
  results: IngressBulkResultRow[];
}

/** Either `itemIds` (explicit rows) or `group` (the whole group, server-side) drives the batch. */
export interface IngressBulkRequest {
  action: IngressBulkAction;
  itemIds?: string[];
  excludeItemIds?: string[];
  group?: IngressQueueGroupKey;
  statuses?: string[];
  classification?: QueueClassificationOverride;
}

export interface QueueManualAssignPayload {
  itemId: string;
  mediaType: 'movie' | 'episode';
  title: string;
  year?: number;
  source?: string;
  imdbId?: string;
  mediaId?: string;
  legacyMediaId?: string;
  rawData?: Record<string, unknown>;
  posterUrl?: string;
  season?: number;
  episode?: number;
  unknownEpisode?: boolean;
  organizeNow?: boolean;
}

export interface QueueItemStatus {
  status: string;
  confidence?: number;
  title?: string;
  queue_item_id: string;
}

export interface IngressConfig {
  defaultIngressPaths: string[];
  autoProcessEnabled: boolean;
  autoProcessIntervalSeconds: number;
  autoAssignThreshold: number;
  autoOrganizeEnabled: boolean;
  fileStabilityWaitSeconds: number;
  debounceSeconds: number;
  jellyfinDestBase: string;
  defaultMetadataSource: 'library_then_omdb' | 'omdb_only' | 'tmdb_only' | 'library_only';
}

class IngressAutomationService {
  private readonly baseUrl: string;

  constructor() {
    // Always use the frontend's same-origin proxy to avoid CORS and hardcoded host drift.
    this.baseUrl = '/api/backend/api/ingress';
  }

  /**
   * A group-scoped batch (#35) walks up to the backend's `MAX_GROUP_ITEMS` rows through the same
   * organize/record path a single accept takes, so it cannot share the budget a read gets: the client
   * used to give up at 15s and roll its optimistic row back as if nothing had happened while the
   * server kept applying the batch. Named `IngressTimeoutError` so the caller can tell "outcome
   * unknown" from "never applied" and reload instead of reverting.
   */
  private static readonly BULK_REQUEST_TIMEOUT_MS = 120000;

  private static readonly REQUEST_TIMEOUT_MS = 15000;

  /**
   * A folder classification walks every file in the folder through the local model, so it gets the same
   * long budget as a bulk batch instead of the 15s a normal admin read uses. The triage UI keeps the
   * rest of the page usable while it runs.
   */
  private static readonly AI_CLASSIFY_REQUEST_TIMEOUT_MS = 120000;

  private async request(path: string, init?: RequestInit, timeoutMs = IngressAutomationService.REQUEST_TIMEOUT_MS): Promise<any> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || `Ingress request failed: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        const timeoutError = new Error('Ingress request timed out. The backend may still be working.');
        timeoutError.name = INGRESS_TIMEOUT_ERROR_NAME;
        throw timeoutError;
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async getConfig(): Promise<IngressConfig> {
    const result = await this.request('/config');
    return result.data;
  }

  async getWatcherStatus(): Promise<IngressWatcherStatus> {
    const result = await this.request('/watcher/status');
    return result.data;
  }

  async startWatcher(
    ingressPaths: string[] = [],
    options: StartWatcherOptions = {}
  ): Promise<IngressWatcherStatus> {
    const result = await this.request('/watcher/start', {
      method: 'POST',
      body: JSON.stringify({ ingressPaths, ...options }),
    });
    return result.data;
  }

  async stopWatcher(): Promise<IngressWatcherStatus> {
    const result = await this.request('/watcher/stop', {
      method: 'POST',
    });
    return result.data;
  }

  async getQueueStatus(): Promise<IngressQueueStatus> {
    const result = await this.request('/queue/status');
    return result.data;
  }

  async getQueueItems(status?: string): Promise<IngressQueueItem[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const result = await this.request(`/queue/items${query}`);
    return result.data.items;
  }

  async getQueueGroups(options: {
    groupBy?: QueueGroupBy;
    statuses?: string[];
    q?: string;
    limit?: number;
    offset?: number;
    previewSize?: number;
  } = {}): Promise<IngressQueueGroupsResult> {
    const params = new URLSearchParams();
    if (options.statuses?.length) params.set('status', options.statuses.join(','));
    if (options.q) params.set('q', options.q);
    if (options.groupBy) params.set('groupBy', options.groupBy);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.previewSize !== undefined) params.set('previewSize', String(options.previewSize));
    const query = params.toString();
    const result = await this.request(`/queue/groups${query ? `?${query}` : ''}`);
    return result.data;
  }

  async bulkQueueAction(payload: IngressBulkRequest): Promise<IngressBulkResult> {
    const result = await this.request(
      '/queue/bulk',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      IngressAutomationService.BULK_REQUEST_TIMEOUT_MS
    );
    return result.data;
  }

  /**
   * POST /api/ingress/queue/ai-classify: ask the Jev classifier for this folder's answers now, whatever
   * the configured mode. One item id is enough — the classifier answers the whole folder and stores each
   * answer at `parsed_info.ai_classification`. 503 `INGEST_AI_NOT_CONFIGURED` reaches the caller as a
   * normal error so triage can say "no classifier on this backend" rather than failing the row.
   */
  async classifyQueueItemWithAI(itemId: string): Promise<IngressAIClassifyResult> {
    const result = await this.request(
      '/queue/ai-classify',
      {
        method: 'POST',
        body: JSON.stringify({ itemId }),
      },
      IngressAutomationService.AI_CLASSIFY_REQUEST_TIMEOUT_MS
    );
    return result.data;
  }

  async processPending(maxItems: number = 25): Promise<number> {
    const result = await this.request('/queue/process-pending', {
      method: 'POST',
      body: JSON.stringify({ maxItems }),
    });
    return result.data.processedCount;
  }

  async retryItem(itemId: string): Promise<IngressQueueItem> {
    const result = await this.request('/queue/retry', {
      method: 'POST',
      body: JSON.stringify({ itemId }),
    });
    return result.data;
  }

  async markComplete(itemId: string): Promise<IngressQueueItem> {
    const result = await this.request('/queue/mark-complete', {
      method: 'POST',
      body: JSON.stringify({ itemId }),
    });
    return result.data;
  }

  async updateClassification(itemId: string, classification: QueueClassificationOverride): Promise<IngressQueueItem> {
    const result = await this.request('/queue/update-classification', {
      method: 'POST',
      body: JSON.stringify({ itemId, classification }),
    });
    return result.data;
  }

  async markFailed(itemId: string, reason: string): Promise<IngressQueueItem> {
    const result = await this.request('/queue/mark-failed', {
      method: 'POST',
      body: JSON.stringify({ itemId, reason }),
    });
    return result.data;
  }

  async manualAssign(payload: QueueManualAssignPayload): Promise<IngressQueueItem> {
    const result = await this.request('/queue/manual-assign', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return result.data;
  }

  async resetToEncoded(itemId: string): Promise<IngressQueueItem> {
    const result = await this.request('/queue/reset-to-encoded', {
      method: 'POST',
      body: JSON.stringify({ itemId }),
    });
    return result.data.item;
  }

  async resetCompletedToEncoded(): Promise<{
    itemsAttempted: number;
    itemsReset: number;
    filesAttempted: number;
    filesReset: number;
    errors: string[];
  }> {
    const result = await this.request('/queue/reset-completed-to-encoded', {
      method: 'POST',
    });
    return result.data;
  }

  async updateConfig(updates: Partial<IngressConfig>): Promise<IngressConfig> {
    const result = await this.request('/config', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return result.data;
  }

  async getQueueStatusMap(): Promise<Record<string, QueueItemStatus>> {
    const result = await this.request('/queue/status-map');
    return result.data;
  }

  async getHealth(): Promise<Record<string, any>> {
    const result = await this.request('/health');
    return result.data;
  }

  async getHistory(limit: number = 50): Promise<Array<Record<string, any>>> {
    const result = await this.request(`/history?limit=${limit}`);
    return result.data.items;
  }
}

export default new IngressAutomationService();

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
  };
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

  private async request(path: string, init?: RequestInit): Promise<any> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

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
        throw new Error('Ingress request timed out. The backend may still be working.');
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

import {
  ComplianceApplyResult,
  ComplianceFinding,
  CompliancePreview,
  ComplianceScanStatus,
  ComplianceStatus,
  ComplianceSummary,
} from '../../types/library/LibraryCompliance';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

class LibraryComplianceService {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = '/api/backend/api/library/compliance';
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Compliance request failed (${response.status})`);
    }

    const payload = (await response.json()) as ApiResponse<T>;
    return payload.data;
  }

  async startScan(libraryPath: string, mediaType: 'movie' | 'series' = 'movie'): Promise<{ scanId: string }> {
    return this.request<{ scanId: string; libraryPath: string; status: string }>('/scan', {
      method: 'POST',
      body: JSON.stringify({ libraryPath, mediaType }),
    });
  }

  async getScanStatus(scanId: string): Promise<ComplianceScanStatus> {
    return this.request<ComplianceScanStatus>(`/scan/status/${encodeURIComponent(scanId)}`);
  }

  async cancelScan(scanId: string): Promise<void> {
    await this.request<{ scanId: string; status: string }>(`/scan/${encodeURIComponent(scanId)}/cancel`, {
      method: 'POST',
    });
  }

  async getFindings(filters?: {
    status?: ComplianceStatus;
    severity?: string;
    issueType?: string;
    scanId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ComplianceFinding[]> {
    const query = new URLSearchParams();
    if (filters?.status) query.set('status', filters.status);
    if (filters?.severity) query.set('severity', filters.severity);
    if (filters?.issueType) query.set('issueType', filters.issueType);
    if (filters?.scanId) query.set('scanId', filters.scanId);
    if (typeof filters?.limit === 'number') query.set('limit', String(filters.limit));
    if (typeof filters?.offset === 'number') query.set('offset', String(filters.offset));

    const data = await this.request<{ findings: ComplianceFinding[] }>(
      `/findings${query.toString() ? `?${query.toString()}` : ''}`,
    );
    return data.findings || [];
  }

  async getFinding(findingId: string): Promise<ComplianceFinding> {
    const data = await this.request<{ finding: ComplianceFinding }>(
      `/findings/${encodeURIComponent(findingId)}`,
    );
    return data.finding;
  }

  async updateFindingStatus(findingId: string, status: ComplianceStatus): Promise<ComplianceFinding> {
    const data = await this.request<{ finding: ComplianceFinding }>(
      `/findings/${encodeURIComponent(findingId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
    );
    return data.finding;
  }

  async updateAction(
    findingId: string,
    actionId: string,
    updates: { selected?: boolean; targetPath?: string | null },
  ): Promise<void> {
    await this.request<{ action: unknown }>(
      `/findings/${encodeURIComponent(findingId)}/actions/${encodeURIComponent(actionId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          selected: updates.selected,
          targetPath: updates.targetPath,
        }),
      },
    );
  }

  async previewFinding(findingId: string, actionIds?: string[]): Promise<CompliancePreview> {
    return this.request<CompliancePreview>(`/findings/${encodeURIComponent(findingId)}/preview`, {
      method: 'POST',
      body: JSON.stringify({ actionIds }),
    });
  }

  async applyFinding(findingId: string, actionIds?: string[]): Promise<ComplianceApplyResult> {
    return this.request<ComplianceApplyResult>(`/findings/${encodeURIComponent(findingId)}/apply`, {
      method: 'POST',
      body: JSON.stringify({ actionIds }),
    });
  }

  async bulkStatus(findingIds: string[], status: ComplianceStatus): Promise<void> {
    await this.request<{ requested: number; updated: number; status: string }>('/bulk/status', {
      method: 'POST',
      body: JSON.stringify({ findingIds, status }),
    });
  }

  async bulkApply(findingIds: string[]): Promise<void> {
    await this.request('/bulk/apply', {
      method: 'POST',
      body: JSON.stringify({ findingIds }),
    });
  }

  async getSummary(): Promise<ComplianceSummary> {
    return this.request<ComplianceSummary>('/summary');
  }

  async dismissAllFindings(): Promise<void> {
    const findings = await this.getFindings({ status: 'open' });
    const findingIds = findings.map((finding) => finding.id);

    if (findingIds.length > 0) {
      await this.bulkStatus(findingIds, 'ignored');
    }
  }
}

export default new LibraryComplianceService();

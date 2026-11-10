/**
 * Barcode lookup and cover scan for the web add-disc flow — the same backend
 * endpoints the mobile app uses (see backend/api/metadata_search.py and
 * backend/api/cover_scan.py). Results are suggestions, never saved as-is.
 */
import { api } from '../api/apiClient';

export interface UpcLookupResult {
  found: boolean;
  code: string;
  rawTitle?: string;
  title?: string;
  format?: string | null;
  edition?: string | null;
  looksLikeMedia?: boolean;
  releaseDate?: string | null;
}

export interface CoverScanResult {
  found: boolean;
  verified: boolean;
  title: string | null;
  year: string | null;
  format: string | null;
  edition: string | null;
  confidence: 'high' | 'medium' | 'low';
}

// The backend waits up to 180s for the vision model to load and answer.
const COVER_SCAN_TIMEOUT_MS = 190_000;

export async function lookupUpc(code: string): Promise<UpcLookupResult> {
  return api.get<UpcLookupResult>(`/api/metadata-search/upc?code=${encodeURIComponent(code)}`);
}

export async function scanCover(file: File): Promise<CoverScanResult> {
  const form = new FormData();
  form.append('file', file);
  return api.postForm<CoverScanResult>('/api/metadata-search/cover-scan', form, COVER_SCAN_TIMEOUT_MS);
}

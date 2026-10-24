/**
 * Fetch for the /dashboard/stats page. The numbers are aggregated
 * server-side (backend/api/catalog.py -> services/catalog_stats.py) so the
 * web page and the mobile app's stats screen report the same totals.
 *
 * Errors are deliberately not swallowed here — the page shows a retryable
 * error panel, which is more honest than rendering a run of zeroes.
 */
import { api } from '../api/apiClient';
import { CatalogStats } from '../../types/catalog/CatalogStats.type';

export async function getCatalogStats(recentDays = 30): Promise<CatalogStats> {
  return api.get<CatalogStats>(`/api/catalog/stats?recent_days=${recentDays}`);
}

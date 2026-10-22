/**
 * Shape of GET /api/catalog/stats (backend/services/catalog_stats.py) — the
 * payload behind /dashboard/stats.
 */

export type CatalogStatsItemType = 'movie' | 'series' | 'disc' | 'tape';

export interface CatalogStatsBucket {
  label: string;
  count: number;
}

export interface CatalogStatsDecade extends CatalogStatsBucket {
  startYear: number;
}

export interface CatalogStatsRecentItem {
  id: string;
  title: string;
  type: CatalogStatsItemType;
  createdAt: string;
}

export interface CatalogStatsLentItem {
  id: string;
  title: string;
  type: CatalogStatsItemType;
  borrower: string;
}

export interface CatalogStats {
  generatedAt: string;
  recentDays: number;
  totalItems: number;
  byType: Record<CatalogStatsItemType, number>;
  byDiscFormat: CatalogStatsBucket[];
  byDecade: CatalogStatsDecade[];
  /** Dated-able records (movies, series, discs) with no parseable year. */
  undated: number;
  recentlyAdded: {
    days: number;
    count: number;
    items: CatalogStatsRecentItem[];
  };
  /** Storage locations only exist for physical media, so this covers discs + tapes. */
  storage: {
    total: number;
    withLocation: number;
    withoutLocation: number;
    byType: CatalogStatsBucket[];
  };
  lentOut: {
    count: number;
    items: CatalogStatsLentItem[];
  };
}

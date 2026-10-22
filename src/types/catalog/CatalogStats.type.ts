/**
 * Shape of GET /api/catalog/stats (backend/services/catalog_stats.py) — the
 * payload behind /dashboard/stats.
 *
 * Two rules worth knowing before rendering these numbers:
 *
 *   `count` is always the whole total, while `items` is capped at twelve
 *   (ITEM_LIST_LIMIT server-side). A list can therefore be shorter than the
 *   count next to it — /dashboard/stats spells out "Showing 12 of 21" rather
 *   than inventing a flag for it.
 *
 *   `lentOut` is derived, not stored: there is no loans table, so the server
 *   reads the loans the mobile app writes into each record's `raw_data`
 *   (a `loans` array, or bare `loanedTo`/`onLoan` fields) and counts a record
 *   only while its newest loan is unreturned. `borrower` is 'Unspecified'
 *   when a loan records the fact without a name.
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
  /** Who has it, or 'Unspecified' when the loan record only says it is out. */
  borrower: string;
}

export interface CatalogStats {
  generatedAt: string;
  recentDays: number;
  totalItems: number;
  byType: Record<CatalogStatsItemType, number>;
  /** Normalised labels ("Blu-ray", "4K UHD Blu-ray", "DVD"), most-catalogued first. */
  byDiscFormat: CatalogStatsBucket[];
  /** Decades cover movies, series and discs only — tapes have no release year. */
  byDecade: CatalogStatsDecade[];
  /** Dated-able records (movies, series, discs) with no parseable year. */
  undated: number;
  recentlyAdded: {
    days: number;
    /** Whole total for the window; `items` below is capped at twelve. */
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
    /** Whole total of records currently on loan; `items` below is capped at twelve. */
    count: number;
    items: CatalogStatsLentItem[];
  };
}

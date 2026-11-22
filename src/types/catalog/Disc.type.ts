import {
  AuditFields,
  DiscCondition,
  DiscFormat,
  CatalogMediaType,
  ImageFile,
  StorageType,
  VideoFile,
} from './Common.type';

export interface CatalogDisc extends AuditFields {
  id: string;
  title: string;
  videoFiles: VideoFile[];
  imageFiles: ImageFile[];
  mediaId?: string;
  mediaType?: CatalogMediaType;
  isPartOfSet: boolean;
  isRentalDisc: boolean;
  containsSpecialFeatures: boolean;
  releaseDate?: string;
  language?: string;
  subtitles?: string[];
  regionCode?: string;
  format?: DiscFormat;
  discNumber?: number | null;
  edition?: string | null;
  setId?: string | null;
  // The release (box or case) this disc belongs to. The API always sets it,
  // also for a loose disc, whose release is an automatic one-disc wrapper.
  releaseId?: string | null;
  barcode?: string | null;
  purchaseDate?: string | null;
  condition?: DiscCondition | null;
  // Real count of media_files rows linked via disc_id (GET /discs computes
  // this server-side) — the honest "has this been ripped" signal, unlike
  // videoFiles above which nothing in the current pipeline populates.
  linkedFileCount?: number;
  storageType?: StorageType | null;
  storageId?: string | null;
  // Loan, kept in raw_data (no column) — see src/utils/loanUtils.ts.
  loanedTo?: string | null;
  loanedAt?: string | null;
  returnedAt?: string | null;
}

/** The thing that was bought: one box or case, holding one or more discs. */
export interface CatalogRelease {
  id: string;
  title: string;
  barcode?: string | null;
  edition?: string | null;
  // "loose" is the automatic wrapper of a disc catalogued on its own.
  packaging?: 'case' | 'box_set' | 'combo_pack' | 'loose' | null;
  expectedDiscCount?: number | null;
  discs?: CatalogDisc[];
}
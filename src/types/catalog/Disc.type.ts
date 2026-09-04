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
  setId?: string | null;
  barcode?: string | null;
  purchaseDate?: string | null;
  condition?: DiscCondition | null;
  // Real count of media_files rows linked via disc_id (GET /discs computes
  // this server-side) — the honest "has this been ripped" signal, unlike
  // videoFiles above which nothing in the current pipeline populates.
  linkedFileCount?: number;
  storageType?: StorageType | null;
  storageId?: string | null;
}
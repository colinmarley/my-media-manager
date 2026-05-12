import {
  AuditFields,
  DiscCondition,
  DiscFormat,
  CatalogMediaType,
  ImageFile,
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
}
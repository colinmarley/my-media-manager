import {
  AuditFields,
  DiscCondition,
  DiscFormat,
  FirebaseMediaType,
  ImageFile,
  VideoFile,
} from './FBCommon.type';

export interface FBDisc extends AuditFields {
  id: string;
  title: string;
  videoFiles: VideoFile[];
  imageFiles: ImageFile[];
  mediaId?: string;
  mediaType?: FirebaseMediaType;
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
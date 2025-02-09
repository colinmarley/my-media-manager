import { ImageFile, VideoFile } from "./FBCommon.type";

export interface FBDisc {
  id: string;
  title: string;
  videoFiles: VideoFile[];
  imageFiles: ImageFile[];
  resourceId?: string; // Optional field to link to a resource
  isPartOfSet: boolean;
  isRentalDisc: boolean;
  containsSpecialFeatures: boolean;
  // Additional suggested fields
  releaseDate?: string; // Optional field for the release date
  genre?: string; // Optional field for the genre
  language?: string; // Optional field for the language
  subtitles?: string[]; // Optional field for available subtitles
  regionCode?: string; // Optional field for the region code
}
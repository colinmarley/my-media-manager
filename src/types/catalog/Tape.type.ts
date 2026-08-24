import { AuditFields, ImageFile, VideoFile } from './Common.type';
import { TapeBrand, TapeCondition, RecordingSpeed, TapeType } from '../tape-ingest/TapeIngest.type';

export interface CatalogTape extends AuditFields {
  id: string;
  title: string;
  videoFiles: VideoFile[];
  imageFiles: ImageFile[];
  tapeType?: TapeType;
  tapeLabel?: string | null;   // physical identifier, e.g. "VHSC_0001"
  brand?: TapeBrand;
  condition?: TapeCondition;
  recordingSpeed?: RecordingSpeed;
  labelNotes?: string | null;
  purchaseDate?: string | null;
}

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
  // Real count of media_files rows linked via tape_id (GET /tapes computes
  // this server-side) — the honest "has this been digitized" signal, unlike
  // videoFiles above which nothing in the current pipeline populates.
  linkedFileCount?: number;
}

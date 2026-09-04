import { AuditFields, ImageFile, StorageType, VideoFile } from './Common.type';
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
  storageType?: StorageType | null;
  storageId?: string | null;
  // Backend: tapes.set_id FK -> disc_sets (that table is media-type-generic
  // despite the name). Not yet rendered anywhere in the web UI — boxed
  // sets/multi-title-linking is a mobile-only feature for both discs and
  // tapes today.
  setId?: string | null;
}

import { MediaFile } from '@/types/library/MediaFile.type';

/** What the Files and Discs & Tapes tabs can ask the page to do with files. */
export interface FileActionHandlers {
  /** Opens the link dialog to pick a disc / tape for these files. */
  onLink: (files: MediaFile[]) => void;
  onUnlink: (files: MediaFile[]) => void;
  /** Move one file to another title (DiskReassignDialog, file mode). */
  onReassign: (file: MediaFile) => void;
  /** Shows only: file a loose file under a catalogued episode. */
  onAssignEpisode?: (file: MediaFile) => void;
  onSetFlag: (files: MediaFile[], needsReview: boolean) => void;
  /** Opens the canonical rename preview for these files. */
  onRename: (files: MediaFile[]) => void;
  /** Opens the dialog that gives an extra another type (scene, featurette, ...). */
  onChangeExtraType?: (file: MediaFile) => void;
  /** Asks to forget the record of a file that is gone from disk. */
  onRemoveRecord?: (file: MediaFile) => void;
  /** Endpoints from a later backend PR that answered 404 / 405 here. */
  reviewUnavailable: boolean;
  renameUnavailable: boolean;
  busy: boolean;
}

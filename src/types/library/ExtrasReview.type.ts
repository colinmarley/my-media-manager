export interface PendingExtra {
  id: string;
  assignmentId: string | null;
  mediaFileId: string | null;
  category: string | null;
  /** 'rip': a ripped extra held in the ingest queue until its type is confirmed. */
  source: string | null;
  confirmed: boolean;
  createdAt: string | null;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  // Held ripped extras only.
  queueItemId?: string | null;
  durationMs?: number | null;
  title?: string | null;
  year?: number | string | null;
  /** Where confirming will file it, relative to the library; follows the chosen type. */
  proposedPath?: string | null;
  discTitleIndex?: number | null;
  hasContactSheet?: boolean;
  /** After a confirm: the queue item's status ('completed', or 'failed' with `error`). */
  queueStatus?: string | null;
  error?: string | null;
}

/** One audio track of a held extra, in file order (``index`` is what the preview's ``audio`` takes). */
export interface ExtraAudioTrack {
  index: number;
  codec: string | null;
  channels: number | null;
  language: string | null;
  title: string | null;
  default: boolean;
  /** Marked as a commentary track in the file. */
  commentary: boolean;
}

export interface ExtraPlaybackInfo {
  durationSeconds: number | null;
  audioTracks: ExtraAudioTrack[];
}

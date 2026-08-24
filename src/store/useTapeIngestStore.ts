import { create } from 'zustand';
import TapeIngestService from '@/service/tape-ingest/TapeIngestService';
import {
  TapeIngestItem,
  TapeIngestProcessStatus,
  TapeType,
  ContentType,
  HomeVideoMetadata,
  MovieMetadata,
  TvShowMetadata,
  PromoMetadata,
} from '@/types/tape-ingest/TapeIngest.type';

type ScanStatus = 'idle' | 'scanning' | 'done' | 'error';

interface TapeIngestState {
  sourcePath: string;
  tapeType: TapeType;
  scanStatus: ScanStatus;
  scanError: string | null;
  items: TapeIngestItem[];
  destinationBase: string;
  applyFfmpeg: boolean;
  processTaskId: string | null;
  processStatus: TapeIngestProcessStatus | null;
  pollIntervalId: ReturnType<typeof setInterval> | null;

  setSourcePath: (path: string) => void;
  setTapeType: (type: TapeType) => void;
  setDestinationBase: (path: string) => void;
  setApplyFfmpeg: (val: boolean) => void;
  scan: () => Promise<void>;
  updateItemContentType: (filePath: string, contentType: ContentType) => void;
  updateItemMovieMetadata: (filePath: string, metadata: MovieMetadata) => void;
  updateItemHomeVideoMetadata: (filePath: string, metadata: HomeVideoMetadata) => void;
  updateItemTvShowMetadata: (filePath: string, metadata: TvShowMetadata) => void;
  updateItemPromoMetadata: (filePath: string, metadata: PromoMetadata, type: 'trailer' | 'commercial') => void;
  updateItemPhysicalMeta: (filePath: string, brand?: TapeBrand, condition?: TapeCondition, recordingSpeed?: RecordingSpeed, labelNotes?: string) => void;
  updateItemTapeId: (filePath: string, tapeId: string) => void;
  processAll: () => Promise<void>;
  stopPolling: () => void;
  reset: () => void;
}

export const useTapeIngestStore = create<TapeIngestState>((set, get) => ({
  sourcePath: '',
  tapeType: 'vhs',
  scanStatus: 'idle',
  scanError: null,
  items: [],
  destinationBase: '/ark/media/jellyfin',
  applyFfmpeg: false,
  processTaskId: null,
  processStatus: null,
  pollIntervalId: null,

  setSourcePath: (path) => set({ sourcePath: path }),
  setTapeType: (type) => set({ tapeType: type }),
  setDestinationBase: (path) => set({ destinationBase: path }),
  setApplyFfmpeg: (val) => set({ applyFfmpeg: val }),

  scan: async () => {
    const { sourcePath } = get();
    if (!sourcePath) return;
    set({ scanStatus: 'scanning', scanError: null, items: [] });
    try {
      const items = await TapeIngestService.scan(sourcePath);
      set({ items, scanStatus: 'done' });
    } catch (err: unknown) {
      set({ scanStatus: 'error', scanError: err instanceof Error ? err.message : String(err) });
    }
  },

  updateItemContentType: (filePath, contentType) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.filePath === filePath
          ? { ...item, contentType, movieMetadata: undefined, homeVideoMetadata: undefined, tvShowMetadata: undefined, promoMetadata: undefined }
          : item
      ),
    })),

  updateItemMovieMetadata: (filePath, metadata) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.filePath === filePath
          ? { ...item, contentType: 'movie' as ContentType, movieMetadata: metadata, homeVideoMetadata: undefined, tvShowMetadata: undefined, promoMetadata: undefined }
          : item
      ),
    })),

  updateItemHomeVideoMetadata: (filePath, metadata) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.filePath === filePath
          ? { ...item, contentType: 'home_video' as ContentType, homeVideoMetadata: metadata, movieMetadata: undefined, tvShowMetadata: undefined, promoMetadata: undefined }
          : item
      ),
    })),

  updateItemTvShowMetadata: (filePath, metadata) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.filePath === filePath
          ? { ...item, contentType: 'tv_show' as ContentType, tvShowMetadata: metadata, movieMetadata: undefined, homeVideoMetadata: undefined, promoMetadata: undefined }
          : item
      ),
    })),

  updateItemPromoMetadata: (filePath, metadata, type) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.filePath === filePath
          ? { ...item, contentType: type as ContentType, promoMetadata: metadata, movieMetadata: undefined, homeVideoMetadata: undefined, tvShowMetadata: undefined }
          : item
      ),
    })),

  updateItemTapeId: (filePath, tapeId) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.filePath === filePath ? { ...item, tapeId } : item
      ),
    })),

  updateItemPhysicalMeta: (filePath, brand, condition, recordingSpeed, labelNotes) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.filePath === filePath
          ? { ...item, tapeBrand: brand, tapeCondition: condition, recordingSpeed, labelNotes }
          : item
      ),
    })),

  processAll: async () => {
    const { items, destinationBase, applyFfmpeg, tapeType, sourcePath } = get();
    const toProcess = items.filter((i) => i.contentType !== 'unclassified');
    if (!toProcess.length) return;
    try {
      const taskId = await TapeIngestService.processItems(toProcess, { destinationBase, applyFfmpeg, tapeType });
      set({ processTaskId: taskId });

      const id = setInterval(async () => {
        const status = await TapeIngestService.getProcessStatus(taskId);
        set({ processStatus: status });
        if (status.overallStatus !== 'running') {
          clearInterval(id);
          set({ pollIntervalId: null });
          try {
            await TapeIngestService.createSession({
              tape_type: tapeType,
              source_path: sourcePath,
              destination_base: destinationBase,
              apply_ffmpeg: applyFfmpeg,
              files: status.items.map((si) => {
                const src = items.find((i) => i.filePath === si.filePath);
                return {
                  file_path: si.filePath,
                  file_name: si.fileName,
                  content_type: src?.contentType ?? 'unclassified',
                  duration_seconds: src?.durationSeconds,
                  resolution: src?.resolution,
                  codec: src?.videoCodec,
                  file_size_bytes: src?.fileSizeBytes,
                  destination_path: si.targetPath,
                  processing_status: si.status,
                  tape_id: src?.tapeId || undefined,
                  metadata_json: {
                    ...(src?.homeVideoMetadata ? { content: src.homeVideoMetadata as unknown as Record<string, unknown> } : {}),
                    ...(src?.movieMetadata ? { content: src.movieMetadata as unknown as Record<string, unknown> } : {}),
                    ...(src?.tvShowMetadata ? { content: src.tvShowMetadata as unknown as Record<string, unknown> } : {}),
                    ...(src?.promoMetadata ? { content: src.promoMetadata as unknown as Record<string, unknown> } : {}),
                    tape_physical: { brand: src?.tapeBrand, condition: src?.tapeCondition, recording_speed: src?.recordingSpeed, label_notes: src?.labelNotes },
                  },
                };
              }),
            });
          } catch (saveErr) {
            console.warn('Session save failed (non-blocking)', saveErr);
          }
        }
      }, 2000);

      set({ pollIntervalId: id });
    } catch (err: unknown) {
      console.error('Process failed', err);
    }
  },

  stopPolling: () => {
    const { pollIntervalId } = get();
    if (pollIntervalId) { clearInterval(pollIntervalId); set({ pollIntervalId: null }); }
  },

  reset: () => {
    get().stopPolling();
    set({ sourcePath: '', tapeType: 'vhs', scanStatus: 'idle', scanError: null, items: [], applyFfmpeg: false, processTaskId: null, processStatus: null });
  },
}));

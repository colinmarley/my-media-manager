import { api } from '@/service/api/apiClient';
import { ExtraPlaybackInfo, PendingExtra } from '@/types/library/ExtrasReview.type';

const ExtrasReviewService = {
  listCategories(): Promise<string[]> {
    return api.get<string[]>('/api/media/extras/categories');
  },

  listPending(): Promise<PendingExtra[]> {
    return api.get<PendingExtra[]>('/api/media/extras/pending');
  },

  update(id: string, updates: { category?: string; confirmed?: boolean }): Promise<PendingExtra> {
    return api.patch<PendingExtra>(`/api/media/extras/${id}`, updates);
  },

  /** Twelve frames of a held ripped extra as one image (same-origin proxy, so the session cookie goes with it). */
  contactSheetUrl(id: string): string {
    return `/api/backend/api/media/extras/${encodeURIComponent(id)}/contact-sheet`;
  },

  /** A held extra's length and audio tracks, for the player. */
  playbackInfo(id: string): Promise<ExtraPlaybackInfo> {
    return api.get<ExtraPlaybackInfo>(`/api/media/extras/${encodeURIComponent(id)}/playback-info`);
  },

  /**
   * A held extra transcoded for the browser, from `startSeconds` with audio track `audio`.
   * The stream cannot be seeked past what has arrived, so a jump asks for a new URL.
   */
  previewUrl(id: string, startSeconds = 0, audio = 0): string {
    const start = Math.max(0, Math.round(startSeconds * 10) / 10);
    return `/api/backend/api/media/extras/${encodeURIComponent(id)}/preview?start=${start}&audio=${audio}`;
  },
};

export default ExtrasReviewService;

import { api } from '@/service/api/apiClient';
import { PendingExtra } from '@/types/library/ExtrasReview.type';

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
};

export default ExtrasReviewService;

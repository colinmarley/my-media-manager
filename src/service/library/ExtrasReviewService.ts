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
};

export default ExtrasReviewService;

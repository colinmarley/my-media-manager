import { create } from 'zustand';
import ExtrasReviewService from '@/service/library/ExtrasReviewService';
import { PendingExtra } from '@/types/library/ExtrasReview.type';

interface ExtrasReviewState {
  items: PendingExtra[];
  categories: string[];
  loading: boolean;
  error: string | null;
  savingIds: Set<string>;
  load: () => Promise<void>;
  setCategory: (id: string, category: string) => void;
  confirm: (id: string) => Promise<void>;
}

const useExtrasReviewStore = create<ExtrasReviewState>((set, get) => ({
  items: [],
  categories: [],
  loading: false,
  error: null,
  savingIds: new Set(),

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [items, categories] = await Promise.all([
        ExtrasReviewService.listPending(),
        get().categories.length ? Promise.resolve(get().categories) : ExtrasReviewService.listCategories(),
      ]);
      set({ items, categories, loading: false });
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Failed to load pending extras', loading: false });
    }
  },

  // Local-only edit; the category is persisted when the user clicks Confirm.
  setCategory: (id, category) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, category } : item)),
    }));
  },

  confirm: async (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item || !item.category) return;

    set((state) => ({ savingIds: new Set(state.savingIds).add(id) }));
    try {
      await ExtrasReviewService.update(id, { category: item.category, confirmed: true });
      set((state) => ({
        items: state.items.filter((i) => i.id !== id),
        savingIds: new Set([...state.savingIds].filter((x) => x !== id)),
      }));
    } catch (err: unknown) {
      set((state) => ({
        error: err instanceof Error ? err.message : 'Failed to confirm extra',
        savingIds: new Set([...state.savingIds].filter((x) => x !== id)),
      }));
    }
  },
}));

export default useExtrasReviewStore;

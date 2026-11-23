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

const without = (ids: Set<string>, id: string) => new Set([...ids].filter((x) => x !== id));
const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

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
      set({ error: message(err, 'Failed to load pending extras'), loading: false });
    }
  },

  // The pick shows at once. For a ripped extra it is also saved, because the type decides the
  // library file name and the server answers with the new one; other rows save on Confirm.
  setCategory: (id, category) => {
    const item = get().items.find((i) => i.id === id);
    set((state) => ({
      items: state.items.map((i) => (i.id === id ? { ...i, category } : i)),
    }));
    if (item?.source !== 'rip') return;
    ExtrasReviewService.update(id, { category })
      .then((saved) => {
        set((state) => ({
          items: state.items.map((i) =>
            // A later pick may already have replaced this one.
            i.id === id && i.category === category ? { ...i, proposedPath: saved.proposedPath } : i,
          ),
        }));
      })
      .catch((err: unknown) => set({ error: message(err, 'Failed to save the type') }));
  },

  confirm: async (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item || !item.category) return;

    set((state) => ({ savingIds: new Set(state.savingIds).add(id), error: null }));
    try {
      const saved = await ExtrasReviewService.update(id, { category: item.category, confirmed: true });
      if (saved.queueStatus === 'failed') {
        // Typed and confirmed, but filing it failed: it is in Queue & Review as a failed item now.
        set((state) => ({
          items: state.items.filter((i) => i.id !== id),
          savingIds: without(state.savingIds, id),
          error: `${item.fileName} could not be filed: ${saved.error || 'see Queue & Review'}`,
        }));
        return;
      }
      set((state) => ({
        items: state.items.filter((i) => i.id !== id),
        savingIds: without(state.savingIds, id),
      }));
    } catch (err: unknown) {
      set((state) => ({
        error: message(err, 'Failed to confirm extra'),
        savingIds: without(state.savingIds, id),
      }));
    }
  },
}));

export default useExtrasReviewStore;

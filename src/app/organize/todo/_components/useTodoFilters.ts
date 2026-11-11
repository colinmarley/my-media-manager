'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { isAttentionKind } from '@/service/attention/attentionModel';
import type { AttentionKind } from '@/types/attention/Attention.type';

export const DISMISSED_VIEW = 'dismissed';
export type TodoView = AttentionKind | typeof DISMISSED_VIEW;

/**
 * The To-Do page's URL state: `?kind=` (one kind, or "dismissed") and the optional title filter
 * `?mediaType=&mediaId=`. A missing or unknown kind is null: the page then picks the first kind
 * with items.
 */
export default function useTodoFilters() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const rawKind = params?.get('kind') ?? null;
  const view: TodoView | null = rawKind === DISMISSED_VIEW ? DISMISSED_VIEW : isAttentionKind(rawKind) ? rawKind : null;
  const mediaType = params?.get('mediaType') || null;
  const mediaId = params?.get('mediaId') || null;
  const titleFilter = mediaType && mediaId ? { mediaType, mediaId } : null;

  const update = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params?.toString() ?? '');
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const qs = next.toString();
      router.replace(`${pathname ?? ''}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const setView = useCallback((next: TodoView) => update({ kind: next }), [update]);
  const clearTitleFilter = useCallback(() => update({ mediaType: null, mediaId: null }), [update]);

  return { view, titleFilter, setView, clearTitleFilter };
}

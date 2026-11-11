'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import AttentionService, { isAttentionUnsupported } from '@/service/attention/AttentionService';
import type { AttentionItem, AttentionKind } from '@/types/attention/Attention.type';

export const ATTENTION_PAGE_SIZE = 100;

interface Params {
  kind?: AttentionKind | AttentionKind[] | null;
  /** With `mediaId`: only the items of that title. */
  mediaType?: string | null;
  mediaId?: string | null;
  pageSize?: number;
  /** False skips loading (e.g. while the page waits for the summary). */
  enabled?: boolean;
}

export interface UseAttentionItems {
  items: AttentionItem[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  unsupported: boolean;
  hasMore: boolean;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
}

const message = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Request failed');

/**
 * One page of To-Do items for a kind and / or a title, with "load more" paging. A refetch
 * reloads everything loaded so far (so a list that was paged stays paged after an action).
 */
export default function useAttentionItems({ kind, mediaType, mediaId, pageSize = ATTENTION_PAGE_SIZE, enabled = true }: Params): UseAttentionItems {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const requestId = useRef(0);
  const loadedRef = useRef(pageSize);

  const kindKey = Array.isArray(kind) ? kind.join(',') : kind ?? '';
  const titleType = mediaType && mediaId ? mediaType : undefined;
  const titleId = mediaType && mediaId ? mediaId : undefined;

  const fetchPage = useCallback(
    (limit: number, offset: number) =>
      AttentionService.getItems({
        kind: kindKey ? (kindKey.split(',') as AttentionKind[]) : undefined,
        mediaType: titleType,
        mediaId: titleId,
        limit: Math.min(limit, 500),
        offset,
      }),
    [kindKey, titleType, titleId],
  );

  const refetch = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const page = await fetchPage(Math.max(loadedRef.current, pageSize), 0);
      if (id !== requestId.current) return;
      setItems(page.items);
      setTotal(page.total);
      setError(null);
      setUnsupported(false);
    } catch (err) {
      if (id !== requestId.current) return;
      if (isAttentionUnsupported(err)) setUnsupported(true);
      else setError(message(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [fetchPage, pageSize]);

  useEffect(() => {
    if (!enabled) return;
    loadedRef.current = pageSize;
    setLoading(true);
    setItems([]);
    setTotal(0);
    void refetch();
    return () => {
      requestId.current += 1;
    };
  }, [enabled, refetch, pageSize]);

  const loadMore = useCallback(async () => {
    if (items.length >= total) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const page = await fetchPage(pageSize, items.length);
      if (id !== requestId.current) return;
      loadedRef.current = items.length + page.items.length;
      setItems((prev) => [...prev, ...page.items.filter((item) => !prev.some((p) => p.id === item.id))]);
      setTotal(page.total);
    } catch (err) {
      if (id === requestId.current) setError(message(err));
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, items.length, pageSize, total]);

  return { items, total, loading, loadingMore, error, unsupported, hasMore: items.length < total, refetch, loadMore };
}

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { IngressQueueItem } from '@/service/ingress/IngressAutomationService';
import {
  getQueueActionCounts,
  getSelectableQueueItemIds,
  isQueueItemSelectable,
} from '@/service/ingress/ingressQueueModel';

type Params = {
  queueItems: IngressQueueItem[];
  filteredQueueItems: IngressQueueItem[];
  selectedQueueItemIds: string[];
  setSelectedQueueItemIds: React.Dispatch<React.SetStateAction<string[]>>;
  lastSelectedQueueItemId: string | null;
  setLastSelectedQueueItemId: React.Dispatch<React.SetStateAction<string | null>>;
};

/**
 * Pagination + checkbox selection bookkeeping for the ingress queue table.
 */
export default function useIngressQueueSelection({
  queueItems,
  filteredQueueItems,
  selectedQueueItemIds,
  setSelectedQueueItemIds,
  lastSelectedQueueItemId,
  setLastSelectedQueueItemId,
}: Params) {
  const [queuePage, setQueuePage] = useState(0);
  const [queueRowsPerPage, setQueueRowsPerPage] = useState(10);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredQueueItems.length / queueRowsPerPage) - 1);
    if (queuePage > maxPage) {
      setQueuePage(maxPage);
    }
  }, [filteredQueueItems.length, queuePage, queueRowsPerPage]);

  const visibleQueueItems = useMemo(
    () => filteredQueueItems.slice(queuePage * queueRowsPerPage, queuePage * queueRowsPerPage + queueRowsPerPage),
    [filteredQueueItems, queuePage, queueRowsPerPage]
  );
  const selectableVisibleItems = useMemo(
    () => visibleQueueItems.filter((item) => isQueueItemSelectable(item)),
    [visibleQueueItems]
  );
  const selectedVisibleCount = useMemo(
    () => selectableVisibleItems.filter((item) => selectedQueueItemIds.includes(item.id)).length,
    [selectableVisibleItems, selectedQueueItemIds]
  );
  const selectedQueueItems = useMemo(
    () => queueItems.filter((item) => selectedQueueItemIds.includes(item.id)),
    [queueItems, selectedQueueItemIds]
  );
  const { acceptCount: selectedAcceptCount, rejectCount: selectedRejectCount, retryCount: selectedRetryCount } = useMemo(
    () => getQueueActionCounts(selectedQueueItems),
    [selectedQueueItems]
  );

  const toggleQueueItemSelection = (itemId: string, shiftKey = false) => {
    const selectableIds = getSelectableQueueItemIds(filteredQueueItems);

    setSelectedQueueItemIds((prev) => {
      const alreadySelected = prev.includes(itemId);

      if (shiftKey && lastSelectedQueueItemId && selectableIds.includes(lastSelectedQueueItemId)) {
        const startIndex = selectableIds.indexOf(lastSelectedQueueItemId);
        const endIndex = selectableIds.indexOf(itemId);

        if (startIndex !== -1 && endIndex !== -1) {
          const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
          const rangeIds = selectableIds.slice(from, to + 1);

          if (alreadySelected) {
            return prev.filter((id) => !rangeIds.includes(id));
          }

          return Array.from(new Set([...prev, ...rangeIds]));
        }
      }

      return alreadySelected
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId];
    });

    setLastSelectedQueueItemId(itemId);
  };

  const toggleSelectAllVisible = () => {
    const selectableIds = selectableVisibleItems.map((item) => item.id);
    if (selectableIds.length === 0) {
      return;
    }

    setSelectedQueueItemIds((prev) => {
      const allSelected = selectableIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !selectableIds.includes(id));
      }

      return Array.from(new Set([...prev, ...selectableIds]));
    });
  };

  return {
    queuePage,
    setQueuePage,
    queueRowsPerPage,
    setQueueRowsPerPage,
    visibleQueueItems,
    selectableVisibleItems,
    selectedVisibleCount,
    selectedQueueItems,
    selectedAcceptCount,
    selectedRejectCount,
    selectedRetryCount,
    toggleQueueItemSelection,
    toggleSelectAllVisible,
  };
}

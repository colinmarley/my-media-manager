'use client';

import React, { useEffect, useRef, useState } from 'react';

import IngressManualAssignDialog from '@/app/admin/_components/ingress/IngressManualAssignDialog';
import { useNotify } from '@/context/NotificationContext';
import useIngressAssignDialog from '@/hooks/ingress/useIngressAssignDialog';
import IngressAutomationService, { type IngressQueueItem } from '@/service/ingress/IngressAutomationService';
import { isQueueItemAssignable } from '@/service/ingress/ingressQueueModel';

interface Props {
  queueItemId: string;
  /** The item's queue status, to narrow the lookup; all items are searched otherwise. */
  queueStatus: string | null;
  onClose: () => void;
  /** After a successful assignment. */
  onAssigned: () => Promise<unknown> | void;
}

/**
 * Opens the Queue & Review manual-assign dialog for one ingest queue item. The dialog's hook
 * works on full queue items, so the item is looked up first (GET /queue/items?status=…).
 */
const QueueAssignLauncher = ({ queueItemId, queueStatus, onClose, onAssigned }: Props) => {
  const notify = useNotify();
  const [queueItems, setQueueItems] = useState<IngressQueueItem[]>([]);
  const opened = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const assign = useIngressAssignDialog({
    queueItems,
    refreshAll: async () => {
      notify('File assigned.', 'success');
      await onAssigned();
    },
    setError: (message) => {
      if (message) notify(message, 'error');
    },
    setSelectedQueueItemIds: () => {},
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let items = await IngressAutomationService.getQueueItems(queueStatus ?? undefined);
        if (queueStatus && !items.some((item) => item.id === queueItemId)) items = await IngressAutomationService.getQueueItems();
        if (cancelled) return;
        const item = items.find((candidate) => candidate.id === queueItemId);
        if (!item || !isQueueItemAssignable(item)) {
          notify('This file can no longer be assigned from here. Open it in Queue & Review.', 'info');
          onCloseRef.current();
          return;
        }
        setQueueItems([item]);
      } catch (error) {
        if (cancelled) return;
        notify(error instanceof Error ? error.message : 'Could not load the queue item.', 'error');
        onCloseRef.current();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify, queueItemId, queueStatus]);

  const { openAssignDialog, assignDialogOpen } = assign;

  // Open once the item is in state (the hook reads it from its props).
  useEffect(() => {
    if (queueItems.length > 0 && !opened.current) {
      opened.current = true;
      openAssignDialog([queueItemId]);
    }
  }, [queueItems, queueItemId, openAssignDialog]);

  useEffect(() => {
    if (opened.current && !assignDialogOpen) onCloseRef.current();
  }, [assignDialogOpen]);

  return (
    <IngressManualAssignDialog
      open={assign.assignDialogOpen}
      assigning={assign.assigning}
      assignSearching={assign.assignSearching}
      assignTargetCount={assign.assignTargetItemIds.length}
      assignMediaType={assign.assignMediaType}
      onAssignMediaTypeChange={assign.setAssignMediaType}
      assignSearchMode={assign.assignSearchMode}
      onAssignSearchModeChange={assign.handleAssignSearchModeChange}
      assignSearchSource={assign.assignSearchSource}
      onAssignSearchSourceChange={assign.handleAssignSearchSourceChange}
      assignSearchQuery={assign.assignSearchQuery}
      onAssignSearchQueryChange={assign.setAssignSearchQuery}
      assignImdbQuery={assign.assignImdbQuery}
      onAssignImdbQueryChange={assign.setAssignImdbQuery}
      assignSearchResults={assign.assignSearchResults}
      visibleAssignSearchResults={assign.visibleAssignSearchResults}
      selectedAssignResult={assign.selectedAssignResult}
      onSelectAssignResult={assign.setSelectedAssignResult}
      assignTargets={assign.assignTargets}
      episodeMapByItemId={assign.episodeMapByItemId}
      onEpisodeMappingChange={assign.updateEpisodeMapping}
      organizeAfterAssign={assign.organizeAfterAssign}
      onOrganizeAfterAssignChange={assign.setOrganizeAfterAssign}
      onSearch={assign.handleAssignSearch}
      onImdbSearch={assign.handleAssignImdbSearch}
      onResultsScroll={assign.handleAssignResultsScroll}
      onClose={assign.closeAssignDialog}
      onAssign={assign.handleManualAssign}
    />
  );
};

export default QueueAssignLauncher;

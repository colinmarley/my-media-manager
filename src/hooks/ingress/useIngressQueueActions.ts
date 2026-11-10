'use client';

import IngressAutomationService from '@/service/ingress/IngressAutomationService';
import type {
  IngressQueueItem,
  QueueClassificationOverride,
} from '@/service/ingress/IngressAutomationService';
import {
  getAcceptEligibleItems,
  getRejectEligibleItems,
  getRetryEligibleItems,
  isClassificationEditable,
  runQueueActionsSequentially,
} from '@/service/ingress/ingressQueueModel';

type Params = {
  queueItems: IngressQueueItem[];
  selectedQueueItems: IngressQueueItem[];
  refreshAll: () => Promise<void>;
  setError: (message: string | null) => void;
  setWorking: (value: boolean) => void;
};

/**
 * Single-row and bulk queue actions (retry / accept / reject / reclassify).
 */
export default function useIngressQueueActions({
  queueItems,
  selectedQueueItems,
  refreshAll,
  setError,
  setWorking,
}: Params) {
  const runBulkAction = async (
    actionLabel: string,
    eligibleItems: IngressQueueItem[],
    action: (item: IngressQueueItem) => Promise<unknown>
  ) => {
    if (eligibleItems.length === 0) {
      setError(`No selected items can be ${actionLabel.toLowerCase()}.`);
      return;
    }

    setWorking(true);
    setError(null);
    try {
      const results = await runQueueActionsSequentially(eligibleItems, action);
      const failedCount = results.filter((result) => result.status === 'rejected').length;

      if (failedCount > 0) {
        setError(`${actionLabel} completed with ${failedCount} failure${failedCount === 1 ? '' : 's'}.`);
      }

      await refreshAll();
    } catch (err: any) {
      setError(err?.message || `${actionLabel} failed`);
    } finally {
      setWorking(false);
    }
  };

  const handleRetry = async (itemId: string) => {
    setError(null);
    try {
      await IngressAutomationService.retryItem(itemId);
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Retry failed');
    }
  };

  const handleMarkDone = async (itemId: string) => {
    setError(null);
    try {
      await IngressAutomationService.markComplete(itemId);
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Mark complete failed');
    }
  };

  const handleMarkFailed = async (itemId: string) => {
    setError(null);
    try {
      await IngressAutomationService.markFailed(itemId, 'Manually dismissed');
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Mark failed action failed');
    }
  };

  const handleResetToEncoded = async (itemId: string) => {
    setError(null);
    try {
      await IngressAutomationService.resetToEncoded(itemId);
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Reset to encoded failed');
    }
  };

  const handleBulkAccept = async () => {
    await runBulkAction(
      'Accept',
      getAcceptEligibleItems(selectedQueueItems),
      (item) => IngressAutomationService.markComplete(item.id)
    );
  };

  const handleBulkReject = async () => {
    await runBulkAction(
      'Reject',
      getRejectEligibleItems(selectedQueueItems),
      (item) => IngressAutomationService.markFailed(item.id, 'Manually dismissed')
    );
  };

  const handleBulkRetry = async () => {
    await runBulkAction(
      'Retry',
      getRetryEligibleItems(selectedQueueItems),
      (item) => IngressAutomationService.retryItem(item.id)
    );
  };

  const handleUpdateClassification = async (
    itemIds: string[],
    classification: QueueClassificationOverride
  ) => {
    const eligibleItems = queueItems.filter(
      (item) => itemIds.includes(item.id) && isClassificationEditable(item)
    );

    if (eligibleItems.length === 0) {
      setError('No selected queue items can be reclassified.');
      return;
    }

    setWorking(true);
    setError(null);
    try {
      await Promise.all(
        eligibleItems.map((item) => IngressAutomationService.updateClassification(item.id, classification))
      );
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Updating classification failed');
    } finally {
      setWorking(false);
    }
  };

  return {
    runBulkAction,
    handleRetry,
    handleMarkDone,
    handleMarkFailed,
    handleResetToEncoded,
    handleBulkAccept,
    handleBulkReject,
    handleBulkRetry,
    handleUpdateClassification,
  };
}

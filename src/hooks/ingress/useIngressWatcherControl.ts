'use client';

import { useState } from 'react';
import IngressAutomationService from '@/service/ingress/IngressAutomationService';

type Params = {
  parsePathsInput: () => string[];
  refreshAll: () => Promise<void>;
  setError: (message: string | null) => void;
  setStatusMessage: (message: string | null) => void;
  setWorking: (value: boolean) => void;
};

/**
 * Watcher lifecycle controls: start / stop the filesystem watcher and drain the pending queue.
 */
export default function useIngressWatcherControl({
  parsePathsInput,
  refreshAll,
  setError,
  setStatusMessage,
  setWorking,
}: Params) {
  const [processExistingOnStart, setProcessExistingOnStart] = useState(false);
  const [resetCompletedOnStart, setResetCompletedOnStart] = useState(false);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);

  const handleStartWatcher = async () => {
    setWorking(true);
    setError(null);
    setStatusMessage(
      processExistingOnStart
        ? 'Starting watcher and queueing existing files in the background…'
        : 'Starting watcher…'
    );
    try {
      if (resetCompletedOnStart) {
        const resetSummary = await IngressAutomationService.resetCompletedToEncoded();
        if (resetSummary.errors.length > 0) {
          setError(
            `Reset before start had ${resetSummary.errors.length} issue${resetSummary.errors.length === 1 ? '' : 's'}.`
          );
        }
      }

      await IngressAutomationService.startWatcher(parsePathsInput(), {
        processExistingFiles: processExistingOnStart,
      });
      setStatusMessage(
        processExistingOnStart
          ? 'Watcher started. Existing files are being queued in the background.'
          : 'Watcher started.'
      );
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to start watcher');
    } finally {
      setWorking(false);
    }
  };

  const handleStopWatcher = async () => {
    setWorking(true);
    setError(null);
    setStatusMessage('Stopping watcher…');
    try {
      await IngressAutomationService.stopWatcher();
      setStatusMessage('Watcher stopped.');
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to stop watcher');
    } finally {
      setWorking(false);
    }
  };

  const handleProcessPending = async () => {
    setWorking(true);
    setError(null);
    try {
      await IngressAutomationService.processPending(50);
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to process pending queue items');
    } finally {
      setWorking(false);
    }
  };

  return {
    processExistingOnStart,
    setProcessExistingOnStart,
    resetCompletedOnStart,
    setResetCompletedOnStart,
    folderBrowserOpen,
    setFolderBrowserOpen,
    handleStartWatcher,
    handleStopWatcher,
    handleProcessPending,
  };
}

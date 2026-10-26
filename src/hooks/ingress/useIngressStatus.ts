'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import IngressAutomationService, {
  IngressConfig,
  IngressQueueItem,
  IngressQueueStatus,
  IngressWatcherStatus,
} from '@/service/ingress/IngressAutomationService';
import {
  appendIngressPath,
  filterSelectableQueueItemIds,
  isQueueItemSelectable,
  resolveIngressPaths,
  sortActiveQueueItems,
} from '@/service/ingress/ingressQueueModel';

const REFRESH_INTERVAL_MS = 4000;

export type IngressConfigFieldSetters = {
  setEditThreshold: React.Dispatch<React.SetStateAction<number>>;
  setEditAutoOrganize: React.Dispatch<React.SetStateAction<boolean>>;
  setEditAutoProcess: React.Dispatch<React.SetStateAction<boolean>>;
};

/**
 * Loads every piece of ingress automation state (config, watcher, queue, history, health)
 * on a shared 4s refresh tick and keeps the editable config copy in sync on first load.
 */
export default function useIngressStatus() {
  const [config, setConfig] = useState<IngressConfig | null>(null);
  const [watcher, setWatcher] = useState<IngressWatcherStatus | null>(null);
  const [queueStatus, setQueueStatus] = useState<IngressQueueStatus | null>(null);
  const [queueItems, setQueueItems] = useState<IngressQueueItem[]>([]);
  const [history, setHistory] = useState<Array<Record<string, any>>>([]);
  const [health, setHealth] = useState<Record<string, any> | null>(null);
  const [pathsInput, setPathsInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const refreshInFlightRef = useRef(false);
  // Editable config state
  const [editThreshold, setEditThreshold] = useState<number>(80);
  const [editAutoOrganize, setEditAutoOrganize] = useState<boolean>(true);
  const [editAutoProcess, setEditAutoProcess] = useState<boolean>(true);
  const [selectedQueueItemIds, setSelectedQueueItemIds] = useState<string[]>([]);
  const [lastSelectedQueueItemId, setLastSelectedQueueItemId] = useState<string | null>(null);

  const defaultPaths = useMemo(() => config?.defaultIngressPaths || [], [config]);
  const filteredQueueItems = useMemo(() => sortActiveQueueItems(queueItems), [queueItems]);

  const parsePathsInput = () => resolveIngressPaths(pathsInput, defaultPaths);

  const refreshAll = async () => {
    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    try {
      const [configData, watcherStatus, queueStatusData, items, historyItems, healthData] =
        await Promise.all([
          IngressAutomationService.getConfig(),
          IngressAutomationService.getWatcherStatus(),
          IngressAutomationService.getQueueStatus(),
          IngressAutomationService.getQueueItems(),
          IngressAutomationService.getHistory(25),
          IngressAutomationService.getHealth().catch(() => null),
        ]);

      setConfig(configData);
      setWatcher(watcherStatus);
      setQueueStatus(queueStatusData);
      setQueueItems(items);
      setSelectedQueueItemIds((prev) => filterSelectableQueueItemIds(prev, items));
      setLastSelectedQueueItemId((prev) => {
        if (!prev) {
          return null;
        }
        return items.some((item) => item.id === prev && isQueueItemSelectable(item)) ? prev : null;
      });
      setHistory(historyItems);
      if (healthData) setHealth(healthData);
      if (watcherStatus?.initial_queue?.in_progress) {
        setStatusMessage(
          `Queueing existing files: scanned ${watcherStatus.initial_queue.scanned_files}, queued ${watcherStatus.initial_queue.queued_files}.`
        );
      } else if (watcherStatus?.initial_queue?.completed_at) {
        if (watcherStatus.initial_queue.last_error) {
          setStatusMessage(`Existing file queueing completed with issues: ${watcherStatus.initial_queue.last_error}`);
        } else if (watcherStatus.initial_queue.queued_files > 0) {
          setStatusMessage(`Existing file queueing completed. ${watcherStatus.initial_queue.queued_files} files were queued.`);
        }
      }
      setPathsInput((prev) => {
        const hasUserInput = prev.trim().length > 0;
        if (hasUserInput || configData.defaultIngressPaths.length === 0) {
          return prev;
        }
        return configData.defaultIngressPaths.join('\n');
      });
      // Sync editable config fields only on first load
      setEditThreshold((prev) => (loading ? configData.autoAssignThreshold : prev));
      setEditAutoOrganize((prev) => (loading ? configData.autoOrganizeEnabled : prev));
      setEditAutoProcess((prev) => (loading ? configData.autoProcessEnabled : prev));
    } catch (err: any) {
      setError(err?.message || 'Failed to load ingress status');
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    const interval = window.setInterval(refreshAll, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddIngressPath = (path: string) => {
    setPathsInput((prev) => appendIngressPath(prev, path));
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setError(null);
    try {
      const updated = await IngressAutomationService.updateConfig({
        autoAssignThreshold: editThreshold,
        autoOrganizeEnabled: editAutoOrganize,
        autoProcessEnabled: editAutoProcess,
        defaultIngressPaths: parsePathsInput(),
      });
      setConfig(updated);
    } catch (err: any) {
      setError(err?.message || 'Failed to save config');
    } finally {
      setSavingConfig(false);
    }
  };

  return {
    config,
    watcher,
    queueStatus,
    queueItems,
    filteredQueueItems,
    history,
    health,
    pathsInput,
    setPathsInput,
    defaultPaths,
    parsePathsInput,
    handleAddIngressPath,
    loading,
    working,
    setWorking,
    savingConfig,
    error,
    setError,
    statusMessage,
    setStatusMessage,
    editThreshold,
    setEditThreshold,
    editAutoOrganize,
    setEditAutoOrganize,
    editAutoProcess,
    setEditAutoProcess,
    handleSaveConfig,
    refreshAll,
    selectedQueueItemIds,
    setSelectedQueueItemIds,
    lastSelectedQueueItemId,
    setLastSelectedQueueItemId,
  };
}

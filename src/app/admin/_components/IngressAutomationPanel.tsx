"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormControl,
  Grid,
  InputLabel,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Paper,
} from '@mui/material';
import {
  CheckCircle,
  Cancel,
  Edit,
  Replay,
  HealthAndSafety,
  RestartAlt,
} from '@mui/icons-material';
import IngressAutomationService, {
  IngressConfig,
  IngressQueueItem,
  IngressQueueStatus,
  IngressWatcherStatus,
  QueueClassificationOverride,
} from '@/service/ingress/IngressAutomationService';
import MediaAssignmentSearchService, { SearchResult } from '@/service/library/MediaAssignmentSearchService';
import FolderBrowser from '@/app/admin/library/_components/FolderBrowser';

const STATUS_COLORS: Record<string, 'default' | 'info' | 'warning' | 'error' | 'success'> = {
  pending: 'info',
  processing: 'info',
  auto_assigned: 'success',
  needs_review: 'warning',
  failed: 'error',
  completed: 'success',
};

const BULK_SELECTABLE_STATUSES = new Set(['needs_review', 'auto_assigned']);

const ACTIVE_QUEUE_STATUSES = new Set(['pending', 'processing', 'needs_review', 'auto_assigned']);
const ASSIGN_RESULTS_BATCH_SIZE = 10;

export function isQueueItemSelectable(item: IngressQueueItem): boolean {
  return ACTIVE_QUEUE_STATUSES.has(item.status) && BULK_SELECTABLE_STATUSES.has(item.status);
}

export function filterSelectableQueueItemIds(
  selectedIds: string[],
  items: IngressQueueItem[]
): string[] {
  const selectableIds = new Set(
    items
      .filter((item) => isQueueItemSelectable(item))
      .map((item) => item.id)
  );

  return selectedIds.filter((id) => selectableIds.has(id));
}

export async function runQueueActionsSequentially<T>(
  items: T[],
  action: (item: T) => Promise<unknown>
): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = [];

  for (const item of items) {
    try {
      const value = await action(item);
      results.push({ status: 'fulfilled', value });
    } catch (reason) {
      results.push({ status: 'rejected', reason });
    }
  }

  return results;
}

type EpisodeAssignmentMapping = {
  season?: number;
  episode?: number;
  unknown?: boolean;
};

export function isEpisodeMappingValid(mapping?: EpisodeAssignmentMapping): boolean {
  if (mapping?.unknown) {
    return true;
  }

  return Number.isInteger(mapping?.season) && Number.isInteger(mapping?.episode);
}
const CLASSIFICATION_OPTIONS: Array<{ value: QueueClassificationOverride; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'main_feature', label: 'Main Feature' },
  { value: 'special_feature', label: 'Special Feature' },
  { value: 'alternate_version', label: 'Alternate Version' },
];

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function getQueueClassificationBadges(item: IngressQueueItem): Array<{
  label: string;
  color: 'default' | 'info' | 'warning' | 'error' | 'success' | 'primary' | 'secondary';
  variant?: 'filled' | 'outlined';
}> {
  const badges: Array<{
    label: string;
    color: 'default' | 'info' | 'warning' | 'error' | 'success' | 'primary' | 'secondary';
    variant?: 'filled' | 'outlined';
  }> = [];

  const proposedPath = item.proposed_path || '';
  const filePath = item.file_path || '';
  const fileStem = (item.file_name || '').replace(/\.[^.]+$/, '');
  const parsedType = item.parsed_info?.media_type;
  const matchedType = item.best_match?.media_type;
  const mediaType = (parsedType && parsedType !== 'unknown' ? parsedType : matchedType) || 'unknown';
  const override = item.classification_override;
  const isCompanionHint = item.parsed_info?.classification_hint === 'special_feature' || Boolean(item.parsed_info?.is_companion);
  const isExtrasFolder = /(?:^|\/)(extras?|special features?|bonus|featurettes?|deleted scenes?)(?:\/|$)/i.test(filePath);
  const isMakemkvExtra = /^[A-Za-z]\d+[_-]t\d+$/i.test(fileStem);
  const season = item.parsed_info?.season ?? item.best_match?.season;
  const episode = item.parsed_info?.episode ?? item.best_match?.episode;
  const inferredMatch = Boolean(
    (item.best_match as Record<string, unknown> | undefined)?.inferred_from_source_root ||
    (item.best_match as Record<string, unknown> | undefined)?.inferred_from_ingress_folder
  );

  if (override === 'special_feature' || /special feature/i.test(proposedPath) || (!override && (isCompanionHint || isExtrasFolder || isMakemkvExtra))) {
    badges.push({ label: 'Special Feature', color: 'warning' });
  } else if (override === 'alternate_version' || /\s-\sVersion\s\d+/i.test(proposedPath)) {
    badges.push({ label: 'Alternate Version', color: 'info' });
  } else if (mediaType === 'episode' || mediaType === 'series') {
    if (typeof season === 'number' && typeof episode === 'number') {
      badges.push({ label: 'TV Episode', color: 'secondary' });
      badges.push({ label: `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`, color: 'secondary', variant: 'outlined' });
    } else {
      badges.push({ label: 'Unknown Episode', color: 'warning' });
    }
  } else if (mediaType === 'documentary') {
    badges.push({ label: 'Documentary', color: 'info' });
  } else if (mediaType === 'live_performance') {
    badges.push({ label: 'Live Performance', color: 'info' });
  } else if (override === 'main_feature' || mediaType === 'movie') {
    badges.push({ label: 'Main Feature', color: 'primary' });
  } else {
    badges.push({ label: 'Unclassified', color: 'default' });
  }

  if (item.parsed_info?.quality) {
    badges.push({ label: String(item.parsed_info.quality).toUpperCase(), color: 'default', variant: 'outlined' });
  }

  if (inferredMatch) {
    badges.push({ label: 'Parent Match', color: 'success', variant: 'outlined' });
  }

  if (override && override !== 'auto') {
    badges.push({ label: 'Override', color: 'primary', variant: 'outlined' });
  }

  return badges;
}

const IngressAutomationPanel: React.FC = () => {
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
  const [processExistingOnStart, setProcessExistingOnStart] = useState(false);
  const [resetCompletedOnStart, setResetCompletedOnStart] = useState(false);
  const [selectedQueueItemIds, setSelectedQueueItemIds] = useState<string[]>([]);
  const [lastSelectedQueueItemId, setLastSelectedQueueItemId] = useState<string | null>(null);
  // Editable config state
  const [editThreshold, setEditThreshold] = useState<number>(80);
  const [editAutoOrganize, setEditAutoOrganize] = useState<boolean>(true);
  const [editAutoProcess, setEditAutoProcess] = useState<boolean>(true);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignSearching, setAssignSearching] = useState(false);
  const [assignTargetItemIds, setAssignTargetItemIds] = useState<string[]>([]);
  const [assignMediaType, setAssignMediaType] = useState<'movie' | 'episode'>('movie');
  const [assignSearchQuery, setAssignSearchQuery] = useState('');
  const [assignSearchResults, setAssignSearchResults] = useState<SearchResult[]>([]);
  const [visibleAssignResultsCount, setVisibleAssignResultsCount] = useState(ASSIGN_RESULTS_BATCH_SIZE);
  const [selectedAssignResult, setSelectedAssignResult] = useState<SearchResult | null>(null);
  const [assignSearchMode, setAssignSearchMode] = useState<'title' | 'imdb_id'>('title');
  const [assignImdbQuery, setAssignImdbQuery] = useState('');
  const [assignSearchSource, setAssignSearchSource] = useState<'omdb' | 'tmdb'>('omdb');
  const [organizeAfterAssign, setOrganizeAfterAssign] = useState(false);
  const [episodeMapByItemId, setEpisodeMapByItemId] = useState<Record<string, EpisodeAssignmentMapping>>({});
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [queuePage, setQueuePage] = useState(0);
  const [queueRowsPerPage, setQueueRowsPerPage] = useState(10);

  const defaultPaths = useMemo(() => config?.defaultIngressPaths || [], [config]);
  const filteredQueueItems = useMemo(() => {
    const statusPriority: Record<string, number> = {
      needs_review: 0,
      pending: 1,
      processing: 2,
      auto_assigned: 3,
    };

    return queueItems
      .filter((item) => ACTIVE_QUEUE_STATUSES.has(item.status))
      .sort((a, b) => {
        const priorityDiff = (statusPriority[a.status] ?? 99) - (statusPriority[b.status] ?? 99);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        return a.queued_at - b.queued_at;
      });
  }, [queueItems]);

  const visibleQueueItems = useMemo(
    () => filteredQueueItems.slice(queuePage * queueRowsPerPage, queuePage * queueRowsPerPage + queueRowsPerPage),
    [filteredQueueItems, queuePage, queueRowsPerPage]
  );
  const selectableVisibleItems = useMemo(
    () => visibleQueueItems.filter((item) => BULK_SELECTABLE_STATUSES.has(item.status)),
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
  const selectedAcceptCount = useMemo(
    () => selectedQueueItems.filter((item) => item.status === 'needs_review' || item.status === 'auto_assigned').length,
    [selectedQueueItems]
  );
  const selectedRejectCount = useMemo(
    () => selectedQueueItems.filter((item) => item.status === 'needs_review').length,
    [selectedQueueItems]
  );
  const selectedRetryCount = useMemo(
    () => selectedQueueItems.filter((item) => item.status === 'needs_review' || item.status === 'failed').length,
    [selectedQueueItems]
  );

  const assignTargets = useMemo(
    () => queueItems.filter((item) => assignTargetItemIds.includes(item.id)),
    [queueItems, assignTargetItemIds]
  );

  const visibleAssignSearchResults = useMemo(
    () => assignSearchResults.slice(0, visibleAssignResultsCount),
    [assignSearchResults, visibleAssignResultsCount]
  );

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
    const interval = window.setInterval(refreshAll, 4000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsePathsInput = () => {
    const rows = pathsInput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return rows.length > 0 ? rows : defaultPaths;
  };

  const handleAddIngressPath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) {
      return;
    }

    setPathsInput((prev) => {
      const existing = prev
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      if (existing.includes(trimmed)) {
        return prev;
      }

      return existing.length > 0 ? `${prev.trim()}\n${trimmed}` : trimmed;
    });
  };

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredQueueItems.length / queueRowsPerPage) - 1);
    if (queuePage > maxPage) {
      setQueuePage(maxPage);
    }
  }, [filteredQueueItems.length, queuePage, queueRowsPerPage]);

  const isClassificationEditable = (item: IngressQueueItem) =>
    item.status === 'needs_review' || item.status === 'auto_assigned' || item.status === 'failed';

  const toggleQueueItemSelection = (itemId: string, shiftKey = false) => {
    const selectableIds = filteredQueueItems
      .filter((item) => isQueueItemSelectable(item))
      .map((item) => item.id);

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
      selectedQueueItems.filter((item) => item.status === 'needs_review' || item.status === 'auto_assigned'),
      (item) => IngressAutomationService.markComplete(item.id)
    );
  };

  const handleBulkReject = async () => {
    await runBulkAction(
      'Reject',
      selectedQueueItems.filter((item) => item.status === 'needs_review'),
      (item) => IngressAutomationService.markFailed(item.id, 'Manually dismissed')
    );
  };

  const handleBulkRetry = async () => {
    await runBulkAction(
      'Retry',
      selectedQueueItems.filter((item) => item.status === 'needs_review' || item.status === 'failed'),
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

  const openAssignDialog = (itemIds: string[]) => {
    const assignableItemIds = itemIds.filter((id) =>
      queueItems.some(
        (item) => item.id === id && (item.status === 'needs_review' || item.status === 'auto_assigned' || item.status === 'failed')
      )
    );
    const targets = queueItems.filter((item) => assignableItemIds.includes(item.id));
    if (targets.length === 0) {
      setError('Select one or more current queue items to assign.');
      return;
    }

    setSelectedQueueItemIds(filterSelectableQueueItemIds(assignableItemIds, queueItems));

    const shouldUseEpisode = targets.some((item) => {
      const mediaType = item.parsed_info?.media_type || item.best_match?.media_type;
      return mediaType === 'episode' || mediaType === 'series';
    });

    const defaultEpisodeMap: Record<string, EpisodeAssignmentMapping> = {};
    targets.forEach((item) => {
      const season = item.parsed_info?.season ?? item.best_match?.season;
      const episode = item.parsed_info?.episode ?? item.best_match?.episode;
      defaultEpisodeMap[item.id] = {
        season,
        episode,
        unknown: shouldUseEpisode && (!Number.isInteger(season) || !Number.isInteger(episode)),
      };
    });

    setAssignTargetItemIds(assignableItemIds);
    setAssignMediaType(shouldUseEpisode ? 'episode' : 'movie');
    setEpisodeMapByItemId(defaultEpisodeMap);
    setAssignSearchQuery('');
    setAssignSearchResults([]);
    setVisibleAssignResultsCount(ASSIGN_RESULTS_BATCH_SIZE);
    setSelectedAssignResult(null);
    setOrganizeAfterAssign(false);
    setAssignDialogOpen(true);
  };

  const closeAssignDialog = () => {
    if (assigning) {
      return;
    }

    setAssignDialogOpen(false);
    setAssignSearchMode('title');
    setAssignImdbQuery('');
    setAssignSearchSource('omdb');
  };

  const handleAssignImdbSearch = async () => {
    const trimmed = assignImdbQuery.trim();
    if (!trimmed) return;

    setAssignSearching(true);
    setSelectedAssignResult(null);
    try {
      const omdbData = await MediaAssignmentSearchService.getOMDBFullData(trimmed);
      const isEpisode = omdbData.Type === 'episode';
      const result: SearchResult = {
        id: omdbData.imdbID,
        title: omdbData.Title,
        year: omdbData.Year,
        type: isEpisode ? 'series' : omdbData.Type === 'series' ? 'series' : 'movie',
        poster: omdbData.Poster,
        imdbId: omdbData.imdbID,
        source: 'omdb',
        data: omdbData as unknown as Record<string, unknown>,
      };
      setAssignSearchResults([result]);
      setSelectedAssignResult(result);
      setVisibleAssignResultsCount(ASSIGN_RESULTS_BATCH_SIZE);

      if (isEpisode) {
        const season = omdbData.Season ? parseInt(omdbData.Season, 10) : undefined;
        const episode = omdbData.Episode ? parseInt(omdbData.Episode, 10) : undefined;
        const validSeason = Number.isFinite(season) ? season : undefined;
        const validEpisode = Number.isFinite(episode) ? episode : undefined;
        setAssignMediaType('episode');
        setEpisodeMapByItemId((prev) => {
          const next = { ...prev };
          for (const itemId of assignTargetItemIds) {
            next[itemId] = {
              season: validSeason,
              episode: validEpisode,
              unknown: validSeason === undefined || validEpisode === undefined,
            };
          }
          return next;
        });
      }
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'IMDb ID lookup failed');
      setAssignSearchResults([]);
    } finally {
      setAssignSearching(false);
    }
  };

  const handleAssignSearch = async () => {
    if (!assignSearchQuery.trim()) {
      setAssignSearchResults([]);
      return;
    }

    setAssignSearching(true);
    try {
      const mediaType = assignMediaType === 'movie' ? 'movie' : 'series';
      const results = assignSearchSource === 'tmdb'
        ? await MediaAssignmentSearchService.combinedSearchTmdb(assignSearchQuery.trim(), mediaType)
        : await MediaAssignmentSearchService.combinedSearch(assignSearchQuery.trim(), mediaType);
      setAssignSearchResults(results);
      setVisibleAssignResultsCount(ASSIGN_RESULTS_BATCH_SIZE);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Failed to search titles');
    } finally {
      setAssignSearching(false);
    }
  };

  const handleAssignResultsScroll = (event: React.UIEvent<HTMLUListElement>) => {
    const listbox = event.currentTarget;
    const isNearBottom = listbox.scrollTop + listbox.clientHeight >= listbox.scrollHeight - 8;

    if (isNearBottom && visibleAssignResultsCount < assignSearchResults.length) {
      setVisibleAssignResultsCount((prev) => prev + ASSIGN_RESULTS_BATCH_SIZE);
    }
  };

  const handleManualAssign = async () => {
    if (!selectedAssignResult) {
      setError('Select a title to assign.');
      return;
    }

    if (assignTargetItemIds.length === 0) {
      setError('No queue items selected for assignment.');
      return;
    }

    if (assignMediaType === 'episode') {
      const missingMapping = assignTargetItemIds.find((itemId) => {
        const mapping = episodeMapByItemId[itemId];
        return !isEpisodeMappingValid(mapping);
      });
      if (missingMapping) {
        setError('Each selected queue item needs season/episode values or must be marked as Unknown.');
        return;
      }
    }

    setAssigning(true);
    setError(null);
    try {
      for (const itemId of assignTargetItemIds) {
        const mapping = episodeMapByItemId[itemId] || {};
        await IngressAutomationService.manualAssign({
          itemId,
          mediaType: assignMediaType,
          title: selectedAssignResult.title,
          year: Number.isFinite(Number(selectedAssignResult.year)) ? Number(selectedAssignResult.year) : undefined,
          source: selectedAssignResult.source,
          imdbId: selectedAssignResult.imdbId || undefined,
          mediaId: selectedAssignResult.source === 'omdb'
            ? selectedAssignResult.imdbId
            : selectedAssignResult.source === 'tmdb'
              ? selectedAssignResult.id.replace(/^tmdb-/, '')
              : selectedAssignResult.id,
          firebaseMediaId: selectedAssignResult.source === 'catalog' ? selectedAssignResult.id : undefined,
          rawData: (selectedAssignResult.data as Record<string, unknown>) || undefined,
          posterUrl: selectedAssignResult.poster || undefined,
          season: assignMediaType === 'episode' && !mapping.unknown ? mapping.season : undefined,
          episode: assignMediaType === 'episode' && !mapping.unknown ? mapping.episode : undefined,
          unknownEpisode: assignMediaType === 'episode' ? Boolean(mapping.unknown) : undefined,
          organizeNow: organizeAfterAssign,
        });
      }

      setAssignDialogOpen(false);
      setSelectedQueueItemIds((prev) => prev.filter((id) => !assignTargetItemIds.includes(id)));
      await refreshAll();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Manual assignment failed');
    } finally {
      setAssigning(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const ingressPathsHealthy =
    !health || health.ingress_paths?.every((p: any) => p.exists && p.readable);
  const destHealthy = !health || health.destination?.exists;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Ingress Automation
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {statusMessage && (
        <Alert severity={watcher?.initial_queue?.last_error ? 'warning' : 'info'} sx={{ mb: 2 }}>
          {statusMessage}
        </Alert>
      )}

      {(!ingressPathsHealthy || !destHealthy) && (
        <Alert severity="warning" icon={<HealthAndSafety />} sx={{ mb: 2 }}>
          {!ingressPathsHealthy && 'One or more ingress paths are not accessible. '}
          {!destHealthy && 'Destination mount is not accessible — file organization will fail.'}
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 3 }}>
        High-confidence matches are auto-assigned and organized. Items below threshold appear as
        &ldquo;needs_review&rdquo; for manual action here.
      </Alert>

      {/* Status Summary */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Watcher</Typography>
              <Chip
                label={watcher?.is_running ? 'Running' : 'Stopped'}
                color={watcher?.is_running ? 'success' : 'default'}
                size="small"
                sx={{ mt: 1 }}
              />
              <Typography sx={{ mt: 1 }} variant="body2">
                Watching {watcher?.watched_paths?.length || 0} path(s)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Queue</Typography>
              <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {Object.entries(queueStatus?.counts || {})
                  .filter(([, count]) => (count as number) > 0)
                  .map(([status, count]) => (
                    <Chip
                      key={status}
                      label={`${status}: ${count}`}
                      size="small"
                      color={STATUS_COLORS[status] || 'default'}
                    />
                  ))}
                {!queueStatus?.total && (
                  <Typography variant="body2" color="text.secondary">Empty</Typography>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Paths</Typography>
              {health?.ingress_paths?.map((p: any) => (
                <Box key={p.path} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                  <Chip
                    label={p.exists ? 'OK' : 'Missing'}
                    color={p.exists ? 'success' : 'error'}
                    size="small"
                  />
                  <Typography variant="caption" noWrap title={p.path}>{p.path}</Typography>
                </Box>
              )) || (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Health not loaded
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Watcher Control */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Watcher Control</Typography>
          <TextField
            multiline
            minRows={2}
            label="Ingress Paths (one per line)"
            fullWidth
            value={pathsInput}
            onChange={(e) => setPathsInput(e.target.value)}
            sx={{ mb: 2 }}
          />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            <Button
              variant="outlined"
              onClick={() => setFolderBrowserOpen(true)}
              disabled={working}
            >
              Browse Folder
            </Button>
          </Box>
          <FormControlLabel
            control={
              <Switch
                checked={processExistingOnStart}
                onChange={(e) => setProcessExistingOnStart(e.target.checked)}
              />
            }
            label="Queue existing files in these paths before starting watcher"
            sx={{ mb: 1 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={resetCompletedOnStart}
                onChange={(e) => setResetCompletedOnStart(e.target.checked)}
              />
            }
            label="Move completed organized files back to encoded before starting watcher"
            sx={{ mb: 2 }}
          />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={handleStartWatcher} disabled={working}>
              {working
                ? 'Working…'
                : watcher?.initial_queue?.in_progress
                  ? 'Queueing Existing Files…'
                  : 'Start Watcher'}
            </Button>
            <Button variant="outlined" onClick={handleStopWatcher} disabled={working}>
              Stop Watcher
            </Button>
            <Button variant="outlined" onClick={handleProcessPending} disabled={working}>
              Process Pending Now
            </Button>
            <Button variant="text" onClick={refreshAll} disabled={working}>
              Refresh
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Config Editor */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Automation Settings</Typography>
          <Grid container spacing={2} alignItems="center">
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Auto-assign threshold (0–100)"
                type="number"
                fullWidth
                size="small"
                value={editThreshold}
                onChange={(e) => setEditThreshold(Number(e.target.value))}
                inputProps={{ min: 0, max: 100 }}
                helperText="Confidence score required for auto-assignment"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={editAutoOrganize}
                    onChange={(e) => setEditAutoOrganize(e.target.checked)}
                  />
                }
                label="Auto-organize files on assignment"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={editAutoProcess}
                    onChange={(e) => setEditAutoProcess(e.target.checked)}
                  />
                }
                label="Auto-process queue when watcher runs"
              />
            </Grid>
          </Grid>
          <Box sx={{ mt: 2 }}>
            <Button
              variant="contained"
              onClick={handleSaveConfig}
              disabled={savingConfig}
            >
              {savingConfig ? 'Saving…' : 'Save Config'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Queue */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                <Typography variant="h6">Queue Items</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="caption" color="text.secondary">
                    {selectedQueueItemIds.length > 0
                      ? `${selectedQueueItemIds.length} selected`
                      : `${selectableVisibleItems.length} selectable`}
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={handleBulkAccept}
                    disabled={working || selectedAcceptCount === 0}
                  >
                    Accept Selected
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => handleUpdateClassification(selectedQueueItemIds, 'auto')}
                    disabled={working || selectedQueueItemIds.length === 0}
                  >
                    Auto
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => handleUpdateClassification(selectedQueueItemIds, 'main_feature')}
                    disabled={working || selectedQueueItemIds.length === 0}
                  >
                    Set Main
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    color="warning"
                    onClick={() => handleUpdateClassification(selectedQueueItemIds, 'special_feature')}
                    disabled={working || selectedQueueItemIds.length === 0}
                  >
                    Set Special
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => handleUpdateClassification(selectedQueueItemIds, 'alternate_version')}
                    disabled={working || selectedQueueItemIds.length === 0}
                  >
                    Set Version
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={handleBulkReject}
                    disabled={working || selectedRejectCount === 0}
                  >
                    Reject Selected
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleBulkRetry}
                    disabled={working || selectedRetryCount === 0}
                  >
                    Retry Selected
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => openAssignDialog(selectedQueueItemIds)}
                    disabled={working || selectedQueueItemIds.length === 0}
                  >
                    Assign Selected
                  </Button>
                </Box>
              </Box>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          indeterminate={selectedVisibleCount > 0 && selectedVisibleCount < selectableVisibleItems.length}
                          checked={selectableVisibleItems.length > 0 && selectedVisibleCount === selectableVisibleItems.length}
                          disabled={selectableVisibleItems.length === 0}
                          onChange={toggleSelectAllVisible}
                          inputProps={{ 'aria-label': 'Select all queue items' }}
                        />
                      </TableCell>
                      <TableCell>File</TableCell>
                      <TableCell>Duration</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Classification</TableCell>
                      <TableCell>Match / Proposed Path</TableCell>
                      <TableCell>Conf.</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleQueueItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} sx={{ color: 'text.secondary' }}>
                          No active queue items.
                        </TableCell>
                      </TableRow>
                    ) : (
                      visibleQueueItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={selectedQueueItemIds.includes(item.id)}
                              disabled={!isQueueItemSelectable(item) || working}
                              onChange={(event) => toggleQueueItemSelection(item.id, event.nativeEvent instanceof MouseEvent ? event.nativeEvent.shiftKey : false)}
                              inputProps={{ 'aria-label': `Select ${item.file_name}` }}
                            />
                          </TableCell>
                          <TableCell sx={{ maxWidth: 240 }}>
                            <Typography variant="body2" noWrap title={item.file_path}>
                              {item.file_name}
                            </Typography>
                            {item.last_error && (
                              <Typography variant="caption" color="error" noWrap title={item.last_error}>
                                {item.last_error}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <Typography variant="body2">
                              {item.media_duration_ms != null ? formatDuration(item.media_duration_ms) : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={item.status}
                              size="small"
                              color={STATUS_COLORS[item.status] || 'default'}
                            />
                          </TableCell>
                          <TableCell sx={{ minWidth: 220 }}>
                            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                              {getQueueClassificationBadges(item).map((badge) => (
                                <Chip
                                  key={`${item.id}-${badge.label}`}
                                  label={badge.label}
                                  size="small"
                                  color={badge.color}
                                  variant={badge.variant || 'filled'}
                                />
                              ))}
                            </Stack>
                            <FormControl size="small" sx={{ mt: 1, minWidth: 170 }}>
                              <InputLabel id={`classification-override-${item.id}`}>Override</InputLabel>
                              <Select
                                labelId={`classification-override-${item.id}`}
                                value={item.classification_override || 'auto'}
                                label="Override"
                                disabled={!isClassificationEditable(item) || working}
                                onChange={(event) =>
                                  handleUpdateClassification([item.id], event.target.value as QueueClassificationOverride)
                                }
                              >
                                {CLASSIFICATION_OPTIONS.map((option) => (
                                  <MenuItem key={option.value} value={option.value}>
                                    {option.label}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </TableCell>
                          <TableCell sx={{ maxWidth: 200 }}>
                            <Typography variant="caption" noWrap title={item.best_match?.title}>
                              {item.best_match?.title || '—'}
                            </Typography>
                            {item.best_match?.year && (
                              <Typography variant="caption" color="text.secondary">
                                {' '}({item.best_match.year})
                              </Typography>
                            )}
                            {item.proposed_path && (
                              <Typography variant="caption" display="block" color="text.secondary" noWrap title={item.proposed_path} sx={{ fontStyle: 'italic' }}>
                                → {item.proposed_path}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>{item.confidence_score ?? '—'}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              {(item.status === 'failed' || item.status === 'needs_review') && (
                                <Tooltip title="Retry">
                                  <IconButton size="small" onClick={() => handleRetry(item.id)}>
                                    <Replay fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {(item.status === 'needs_review' || item.status === 'failed') && (
                                <Tooltip title="Assign manually">
                                  <IconButton size="small" onClick={() => openAssignDialog([item.id])}>
                                    <Edit fontSize="small" color="primary" />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {(item.status === 'needs_review' || item.status === 'auto_assigned') && (
                                <Tooltip title="Mark done">
                                  <IconButton size="small" onClick={() => handleMarkDone(item.id)}>
                                    <CheckCircle fontSize="small" color="success" />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {item.status === 'completed' && item.assignment_id && (
                                <Tooltip title="Reset files back to encoded for retest">
                                  <IconButton size="small" onClick={() => handleResetToEncoded(item.id)}>
                                    <RestartAlt fontSize="small" color="warning" />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {item.status === 'needs_review' && (
                                <Tooltip title="Dismiss / mark failed">
                                  <IconButton size="small" onClick={() => handleMarkFailed(item.id)}>
                                    <Cancel fontSize="small" color="error" />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={filteredQueueItems.length}
                page={queuePage}
                onPageChange={(_, newPage) => setQueuePage(newPage)}
                rowsPerPage={queueRowsPerPage}
                onRowsPerPageChange={(event) => {
                  setQueueRowsPerPage(parseInt(event.target.value, 10));
                  setQueuePage(0);
                }}
                rowsPerPageOptions={[10, 25, 50, 100]}
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Recent History</Typography>
              {history.length === 0 ? (
                <Typography color="text.secondary">No processing history yet.</Typography>
              ) : (
                history
                  .slice()
                  .reverse()
                  .slice(0, 10)
                  .map((item, index) => (
                    <Box key={`${item.item_id || index}-${index}`} sx={{ mb: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={item.status}
                          size="small"
                          color={STATUS_COLORS[item.status as string] || 'default'}
                        />
                        {item.confidence_score != null && (
                          <Typography variant="caption" color="text.secondary">
                            {item.confidence_score}%
                          </Typography>
                        )}
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ wordBreak: 'break-all' }}
                      >
                        {item.file_path || item.item_id}
                      </Typography>
                      {index < 9 && <Divider sx={{ mt: 1 }} />}
                    </Box>
                  ))
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Dialog open={assignDialogOpen} onClose={closeAssignDialog} maxWidth="md" fullWidth>
        <DialogTitle>Manual Assignment</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Assigning {assignTargetItemIds.length} queue item{assignTargetItemIds.length === 1 ? '' : 's'}.
            </Typography>

            <FormControl size="small" sx={{ maxWidth: 240 }}>
              <InputLabel id="assign-media-type-label">Assignment Type</InputLabel>
              <Select
                labelId="assign-media-type-label"
                label="Assignment Type"
                value={assignMediaType}
                onChange={(event) => setAssignMediaType(event.target.value as 'movie' | 'episode')}
              >
                <MenuItem value="movie">Movie</MenuItem>
                <MenuItem value="episode">TV Episode</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ maxWidth: 200 }}>
              <InputLabel id="assign-search-mode-label">Search by</InputLabel>
              <Select
                labelId="assign-search-mode-label"
                label="Search by"
                value={assignSearchMode}
                onChange={(event) => {
                  setAssignSearchMode(event.target.value as 'title' | 'imdb_id');
                  setAssignSearchResults([]);
                  setSelectedAssignResult(null);
                  setAssignSearchQuery('');
                  setAssignImdbQuery('');
                }}
              >
                <MenuItem value="title">Title</MenuItem>
                <MenuItem value="imdb_id">IMDb ID</MenuItem>
              </Select>
            </FormControl>

            {assignSearchMode === 'imdb_id' ? (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                  label="IMDb ID"
                  fullWidth
                  size="small"
                  value={assignImdbQuery}
                  placeholder="Example: tt1234567"
                  onChange={(event) => setAssignImdbQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && assignImdbQuery.trim()) handleAssignImdbSearch(); }}
                />
                <Button variant="contained" onClick={handleAssignImdbSearch} disabled={assignSearching || !assignImdbQuery.trim()}>
                  {assignSearching ? 'Searching…' : 'Lookup'}
                </Button>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <FormControl size="small" sx={{ minWidth: 110 }}>
                  <InputLabel id="assign-source-label">Source</InputLabel>
                  <Select
                    labelId="assign-source-label"
                    label="Source"
                    value={assignSearchSource}
                    onChange={(event) => {
                      setAssignSearchSource(event.target.value as 'omdb' | 'tmdb');
                      setAssignSearchResults([]);
                      setSelectedAssignResult(null);
                    }}
                  >
                    <MenuItem value="omdb">OMDB</MenuItem>
                    <MenuItem value="tmdb">TMDB</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  label={assignMediaType === 'movie' ? 'Search movie' : 'Search series'}
                  fullWidth
                  size="small"
                  value={assignSearchQuery}
                  onChange={(event) => setAssignSearchQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && assignSearchQuery.trim()) handleAssignSearch(); }}
                />
                <Button variant="contained" onClick={handleAssignSearch} disabled={assignSearching || !assignSearchQuery.trim()}>
                  {assignSearching ? 'Searching…' : 'Search'}
                </Button>
              </Box>
            )}

            <Autocomplete
              options={visibleAssignSearchResults}
              value={selectedAssignResult}
              onChange={(_, value) => setSelectedAssignResult(value)}
              getOptionLabel={(option) => `${option.title} (${option.year}) [${option.source}]`}
              isOptionEqualToValue={(option, value) => option.id === value.id && option.source === value.source}
              ListboxProps={{ onScroll: handleAssignResultsScroll }}
              renderInput={(params) => <TextField {...params} label="Select title" size="small" />}
            />

            {assignSearchResults.length > visibleAssignSearchResults.length && (
              <Typography variant="caption" color="text.secondary">
                Showing {visibleAssignSearchResults.length} of {assignSearchResults.length} results. Scroll to the bottom to load more.
              </Typography>
            )}

            {assignMediaType === 'episode' && assignTargets.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Episode Mapping
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  Mark an entry as Unknown to place it in Season 00 and keep the original filename.
                </Typography>
                <Stack spacing={1.2}>
                  {assignTargets.map((item) => {
                    const mapping = episodeMapByItemId[item.id] || {};
                    return (
                      <Box key={item.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="body2" sx={{ minWidth: 260 }} noWrap title={item.file_name}>
                          {item.file_name}
                        </Typography>
                        <FormControlLabel
                          control={
                            <Checkbox
                              size="small"
                              checked={Boolean(mapping.unknown)}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setEpisodeMapByItemId((prev) => ({
                                  ...prev,
                                  [item.id]: {
                                    ...prev[item.id],
                                    unknown: checked,
                                    season: checked ? undefined : prev[item.id]?.season,
                                    episode: checked ? undefined : prev[item.id]?.episode,
                                  },
                                }));
                              }}
                            />
                          }
                          label="Unknown"
                          sx={{ mr: 1 }}
                        />
                        <TextField
                          label="Season"
                          type="number"
                          size="small"
                          disabled={Boolean(mapping.unknown)}
                          value={mapping.season ?? ''}
                          onChange={(event) => {
                            const seasonValue = event.target.value ? Number(event.target.value) : undefined;
                            setEpisodeMapByItemId((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...prev[item.id],
                                season: seasonValue,
                                unknown: false,
                              },
                            }));
                          }}
                          sx={{ width: 120 }}
                        />
                        <TextField
                          label="Episode"
                          type="number"
                          size="small"
                          disabled={Boolean(mapping.unknown)}
                          value={mapping.episode ?? ''}
                          onChange={(event) => {
                            const episodeValue = event.target.value ? Number(event.target.value) : undefined;
                            setEpisodeMapByItemId((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...prev[item.id],
                                episode: episodeValue,
                                unknown: false,
                              },
                            }));
                          }}
                          sx={{ width: 120 }}
                        />
                      </Box>
                    );
                  })}
                </Stack>
              </Box>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={organizeAfterAssign}
                  onChange={(event) => setOrganizeAfterAssign(event.target.checked)}
                />
              }
              label="Organize files immediately"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAssignDialog} disabled={assigning}>Cancel</Button>
          <Button variant="contained" onClick={handleManualAssign} disabled={assigning || !selectedAssignResult}>
            {assigning ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogActions>
      </Dialog>

      <FolderBrowser
        open={folderBrowserOpen}
        onClose={() => setFolderBrowserOpen(false)}
        onSelect={(path) => {
          handleAddIngressPath(path);
          setFolderBrowserOpen(false);
        }}
      />
    </Box>
  );
};

export default IngressAutomationPanel;


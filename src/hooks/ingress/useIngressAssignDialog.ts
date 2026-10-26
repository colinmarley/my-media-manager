'use client';

import React, { useMemo, useState } from 'react';
import IngressAutomationService from '@/service/ingress/IngressAutomationService';
import type { IngressQueueItem } from '@/service/ingress/IngressAutomationService';
import MediaAssignmentSearchService, { SearchResult } from '@/service/library/MediaAssignmentSearchService';
import {
  ASSIGN_RESULTS_BATCH_SIZE,
  EpisodeAssignmentMapping,
  buildDefaultEpisodeAssignments,
  buildManualAssignPayload,
  buildOmdbImdbResult,
  filterSelectableQueueItemIds,
  isEpisodeMappingValid,
  isQueueItemAssignable,
} from '@/service/ingress/ingressQueueModel';

type Params = {
  queueItems: IngressQueueItem[];
  refreshAll: () => Promise<void>;
  setError: (message: string | null) => void;
  setSelectedQueueItemIds: React.Dispatch<React.SetStateAction<string[]>>;
};

/**
 * Manual assignment dialog: title lookup (OMDB/TMDB/IMDb id) plus per-item episode mapping.
 */
export default function useIngressAssignDialog({
  queueItems,
  refreshAll,
  setError,
  setSelectedQueueItemIds,
}: Params) {
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

  const assignTargets = useMemo(
    () => queueItems.filter((item) => assignTargetItemIds.includes(item.id)),
    [queueItems, assignTargetItemIds]
  );

  const visibleAssignSearchResults = useMemo(
    () => assignSearchResults.slice(0, visibleAssignResultsCount),
    [assignSearchResults, visibleAssignResultsCount]
  );

  const openAssignDialog = (itemIds: string[]) => {
    const assignableItemIds = itemIds.filter((id) =>
      queueItems.some((item) => item.id === id && isQueueItemAssignable(item))
    );
    const targets = queueItems.filter((item) => assignableItemIds.includes(item.id));
    if (targets.length === 0) {
      setError('Select one or more current queue items to assign.');
      return;
    }

    setSelectedQueueItemIds(filterSelectableQueueItemIds(assignableItemIds, queueItems));

    const { shouldUseEpisode, episodeMap: defaultEpisodeMap } = buildDefaultEpisodeAssignments(targets);

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
      const result = buildOmdbImdbResult(omdbData);
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

  const handleAssignSearchModeChange = (mode: 'title' | 'imdb_id') => {
    setAssignSearchMode(mode);
    setAssignSearchResults([]);
    setSelectedAssignResult(null);
    setAssignSearchQuery('');
    setAssignImdbQuery('');
  };

  const handleAssignSearchSourceChange = (source: 'omdb' | 'tmdb') => {
    setAssignSearchSource(source);
    setAssignSearchResults([]);
    setSelectedAssignResult(null);
  };

  const handleAssignResultsScroll = (event: React.UIEvent<HTMLUListElement>) => {
    const listbox = event.currentTarget;
    const isNearBottom = listbox.scrollTop + listbox.clientHeight >= listbox.scrollHeight - 8;

    if (isNearBottom && visibleAssignResultsCount < assignSearchResults.length) {
      setVisibleAssignResultsCount((prev) => prev + ASSIGN_RESULTS_BATCH_SIZE);
    }
  };

  const updateEpisodeMapping = (itemId: string, mapping: EpisodeAssignmentMapping) => {
    setEpisodeMapByItemId((prev) => ({ ...prev, [itemId]: mapping }));
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
        const payload = buildManualAssignPayload({
          itemId,
          mediaType: assignMediaType,
          result: selectedAssignResult,
          mapping: episodeMapByItemId[itemId],
          organizeAfterAssign,
        });
        await IngressAutomationService.manualAssign(payload);
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

  return {
    assignDialogOpen,
    assigning,
    assignSearching,
    assignTargetItemIds,
    assignMediaType,
    setAssignMediaType,
    assignSearchQuery,
    setAssignSearchQuery,
    assignSearchResults,
    visibleAssignSearchResults,
    selectedAssignResult,
    setSelectedAssignResult,
    assignSearchMode,
    setAssignSearchMode,
    handleAssignSearchModeChange,
    assignImdbQuery,
    setAssignImdbQuery,
    assignSearchSource,
    setAssignSearchSource,
    handleAssignSearchSourceChange,
    organizeAfterAssign,
    setOrganizeAfterAssign,
    episodeMapByItemId,
    setEpisodeMapByItemId,
    assignTargets,
    openAssignDialog,
    closeAssignDialog,
    handleAssignImdbSearch,
    handleAssignSearch,
    handleAssignResultsScroll,
    updateEpisodeMapping,
    handleManualAssign,
  };
}

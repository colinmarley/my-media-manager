import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getExternalIds,
  getFolderPath,
  getNfoMetadata,
  getProcessingSummary,
  LibraryMedia,
  LibraryProcessingSummary,
  toComputedMedia,
} from '@/app/dashboard/my-library/_components/libraryHelpers';
import {
  getEffectiveFolderPath,
  getLegacyOmdbData,
  getPosterSourceFromMedia,
  getSeriesEpisodeOptions,
  LegacyOmdbData,
  SeriesEpisodeOption,
} from '@/service/library/mediaDetailModel';
import {
  EMPTY_FILE_GROUPS,
  EMPTY_FILE_SUMMARY,
  flattenFileGroups,
  getMediaDetail,
  isEndpointUnavailable,
} from '@/service/library/MediaFilesService';
import { loadLegacyMediaDetail } from '@/service/library/legacyMediaDetail';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { CatalogTape } from '@/types/catalog/Tape.type';
import { MediaDetailResponse } from '@/types/library/MediaFile.type';

interface Params {
  mediaTypeFromRoute?: string;
  mediaIdFromRoute: string;
}

/** `detail`: one GET .../detail. `legacy`: the backend has no /detail, so the catalogs were searched. */
export type MediaDetailSource = 'detail' | 'legacy';

/**
 * Loads one library title with `GET /api/catalog/media/{type}/{id}/detail` — the catalog record,
 * its discs and tapes and its file inventory in one request — and derives what the page shows
 * from it: computed library state, NFO metadata, the processing summary, the effective (show
 * root) folder path, episode options and the poster source.
 *
 * A 404 / 405 from /detail is either "no such title" or "this backend predates /detail"; both
 * fall back to the old client-side search over the whole catalog, which settles which it was.
 * `refetch` reloads in place (the page keeps rendering) after every mutation.
 */
const useMediaDetailRecord = ({ mediaTypeFromRoute, mediaIdFromRoute }: Params) => {
  const [detail, setDetail] = useState<MediaDetailResponse | null>(null);
  const [source, setSource] = useState<MediaDetailSource>('detail');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    const request = ++requestRef.current;
    const current = () => request === requestRef.current;
    if (!mediaTypeFromRoute || !mediaIdFromRoute) {
      setDetail(null);
      setLoading(false);
      return;
    }
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      let next: MediaDetailResponse | null;
      let nextSource: MediaDetailSource = 'detail';
      try {
        next = await getMediaDetail(mediaTypeFromRoute, mediaIdFromRoute);
      } catch (err) {
        if (!isEndpointUnavailable(err)) throw err;
        nextSource = 'legacy';
        next = await loadLegacyMediaDetail(mediaTypeFromRoute, mediaIdFromRoute);
      }
      if (!current()) return;
      setDetail(next);
      setSource(nextSource);
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : 'Failed to load this title.');
    } finally {
      if (current()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [mediaTypeFromRoute, mediaIdFromRoute]);

  useEffect(() => {
    void load('initial');
  }, [load]);

  const refetch = useCallback(() => load('refresh'), [load]);

  const matchedMedia = (detail?.record ?? null) as LibraryMedia | null;
  const associatedDiscs = useMemo(() => (detail?.discs ?? []) as CatalogDisc[], [detail]);
  const associatedTapes = useMemo(() => (detail?.tapes ?? []) as CatalogTape[], [detail]);
  const files = detail?.files ?? EMPTY_FILE_GROUPS;
  const summary = detail?.summary ?? EMPTY_FILE_SUMMARY;
  const allFiles = useMemo(() => flattenFileGroups(detail?.files), [detail]);

  const computed = useMemo(() => {
    if (!matchedMedia) {
      return null;
    }
    const discMap = new Map(associatedDiscs.map((disc) => [disc.id, disc]));
    return toComputedMedia(matchedMedia, discMap);
  }, [matchedMedia, associatedDiscs]);

  const nfoMetadata = useMemo(() => (matchedMedia ? getNfoMetadata(matchedMedia) : null), [matchedMedia]);

  const processingSummary: LibraryProcessingSummary | null = useMemo(() => {
    if (!matchedMedia || !computed) {
      return null;
    }
    return getProcessingSummary(matchedMedia, computed.fileCount);
  }, [matchedMedia, computed]);

  const legacyOmdbData: LegacyOmdbData | undefined = useMemo(() => getLegacyOmdbData(matchedMedia), [matchedMedia]);

  const currentPosterSource = useMemo(
    () => getPosterSourceFromMedia(matchedMedia, legacyOmdbData),
    [matchedMedia, legacyOmdbData],
  );

  const externalIds = matchedMedia ? getExternalIds(matchedMedia) : null;
  const folderPath = matchedMedia ? getFolderPath(matchedMedia) : null;
  const isSeries = detail ? detail.catalogType === 'series' || computed?.mediaType === 'series' : false;

  const effectiveFolderPath = useMemo(() => {
    if (!folderPath) {
      return folderPath;
    }
    return getEffectiveFolderPath(folderPath, isSeries);
  }, [folderPath, isSeries]);

  const seriesEpisodeOptions: SeriesEpisodeOption[] = useMemo(() => {
    if (!isSeries || !matchedMedia) {
      return [];
    }
    return getSeriesEpisodeOptions(matchedMedia);
  }, [isSeries, matchedMedia]);

  return {
    loading,
    refreshing,
    error,
    refetch,
    source,
    detail,
    matchedMedia,
    computed,
    nfoMetadata,
    associatedDiscs,
    associatedTapes,
    /** Kept for callers of the old shape; the links arrive with the record now. */
    mediaLinksLoading: false,
    files,
    allFiles,
    summary,
    catalogType: detail?.catalogType ?? null,
    detailMediaType: detail?.mediaType ?? null,
    processingSummary,
    externalIds,
    folderPath,
    isSeries,
    effectiveFolderPath,
    seriesEpisodeOptions,
    legacyOmdbData,
    currentPosterSource,
  };
};

export type MediaDetailRecord = ReturnType<typeof useMediaDetailRecord>;

export default useMediaDetailRecord;

import { useMemo } from 'react';

import useDiscs from '@/hooks/catalog/useDiscs';
import useMediaDiscsAndTapes from '@/hooks/catalog/useMediaDiscsAndTapes';
import useMovies from '@/hooks/catalog/useMovies';
import useSeries from '@/hooks/catalog/useSeries';
import {
  getDiscIdsForMedia,
  getExternalIds,
  getFolderPath,
  getMediaId,
  getMediaType,
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
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { CatalogTape } from '@/types/catalog/Tape.type';

interface Params {
  mediaTypeFromRoute?: string;
  mediaIdFromRoute: string;
}

/**
 * Loads the catalog record for one library title and everything derived from it:
 * computed library state, NFO metadata, associated discs/tapes, processing summary,
 * the effective (series root) folder path and the poster source URL.
 */
const useMediaDetailRecord = ({ mediaTypeFromRoute, mediaIdFromRoute }: Params) => {
  const { movies, loading: moviesLoading, error: moviesError } = useMovies();
  const { series, loading: seriesLoading, error: seriesError } = useSeries();
  const { discs, loading: discsLoading } = useDiscs();

  const loading = moviesLoading || seriesLoading || discsLoading;
  const error = moviesError || seriesError;

  const discMap = useMemo(() => {
    return new Map(discs.map((disc) => [disc.id, disc]));
  }, [discs]);

  const matchedMedia = useMemo(() => {
    const allMedia: LibraryMedia[] = [...movies, ...series];

    return allMedia.find((entry) => {
      const entryId = getMediaId(entry);
      const entryType = getMediaType(entry);
      const entryRecord = entry as unknown as Record<string, unknown>;
      const externalIds = (entryRecord.externalIds as Record<string, unknown> | undefined) || {};
      const externalImdbId = typeof externalIds.imdbId === 'string' ? externalIds.imdbId : undefined;
      const legacyImdbId = typeof entryRecord.imdbID === 'string' ? entryRecord.imdbID : undefined;
      const directImdbId = typeof entryRecord.imdbId === 'string' ? entryRecord.imdbId : undefined;
      const routeMatchesImdb =
        mediaIdFromRoute === externalImdbId ||
        mediaIdFromRoute === legacyImdbId ||
        mediaIdFromRoute === directImdbId;

      return entryType === mediaTypeFromRoute && (entryId === mediaIdFromRoute || routeMatchesImdb);
    }) || null;
  }, [movies, series, mediaIdFromRoute, mediaTypeFromRoute]);

  const resolvedMediaId = matchedMedia ? getMediaId(matchedMedia) : undefined;
  const reverseLookupMediaType = mediaTypeFromRoute === 'movie' || mediaTypeFromRoute === 'series'
    ? mediaTypeFromRoute
    : undefined;
  const {
    discs: linkedDiscs,
    tapes: linkedTapes,
    loading: mediaLinksLoading,
  } = useMediaDiscsAndTapes(reverseLookupMediaType, resolvedMediaId);

  const computed = useMemo(() => {
    if (!matchedMedia) {
      return null;
    }

    return toComputedMedia(matchedMedia, discMap);
  }, [matchedMedia, discMap]);

  const nfoMetadata = useMemo(() => {
    if (!matchedMedia) {
      return null;
    }

    return getNfoMetadata(matchedMedia);
  }, [matchedMedia]);

  const associatedDiscs = useMemo(() => {
    if (!matchedMedia) {
      return [];
    }

    // Forward lookup: discs referenced by the movie's legacy
    // releases[].discIds (pre-dates disc_media_links, kept for old
    // Firebase-migrated data).
    const discIds = getDiscIdsForMedia(matchedMedia);
    const forwardDiscs = discIds
      .map((discId) => discMap.get(discId))
      .filter((disc): disc is NonNullable<typeof disc> => Boolean(disc));

    // Reverse lookup: server-computed via disc_media_links + the legacy
    // disc.raw_data.mediaId scalar (GET /api/catalog/media/{type}/{id}/discs).
    const byId = new Map(forwardDiscs.map((disc) => [disc.id, disc]));
    for (const disc of linkedDiscs) byId.set(disc.id, disc);

    return Array.from(byId.values());
  }, [matchedMedia, discMap, linkedDiscs]);

  const associatedTapes: CatalogTape[] = linkedTapes;

  const processingSummary: LibraryProcessingSummary | null = useMemo(() => {
    if (!matchedMedia || !computed) {
      return null;
    }

    return getProcessingSummary(matchedMedia, computed.fileCount);
  }, [matchedMedia, computed]);

  const legacyOmdbData: LegacyOmdbData | undefined = useMemo(() => getLegacyOmdbData(matchedMedia), [matchedMedia]);

  const currentPosterSource = useMemo(() => getPosterSourceFromMedia(matchedMedia, legacyOmdbData), [matchedMedia, legacyOmdbData]);

  const externalIds = matchedMedia ? getExternalIds(matchedMedia) : null;
  const folderPath = matchedMedia ? getFolderPath(matchedMedia) : null;
  const isSeries = computed?.mediaType === 'series';

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
    error,
    matchedMedia,
    computed,
    nfoMetadata,
    associatedDiscs,
    associatedTapes,
    mediaLinksLoading,
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

export default useMediaDetailRecord;

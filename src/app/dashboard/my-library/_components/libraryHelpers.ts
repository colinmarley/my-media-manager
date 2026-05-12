import { CatalogDisc } from '@/types/catalog/Disc.type';
import { CatalogMovie } from '@/types/catalog/Movie.type';
import { CatalogRelease } from '@/types/catalog/Release.type';
import { CatalogSeries } from '@/types/catalog/Series.type';

export type LibraryMedia = CatalogMovie | CatalogSeries;

export type LibraryMediaType = 'movie' | 'series' | 'documentary' | 'live_performance' | 'home_video' | 'needs_review';

export interface LibraryMediaWithComputed {
  media: LibraryMedia;
  mediaType: LibraryMediaType;
  mediaId: string;
  fileCount: number;
  hasLocalFolder: boolean;
  inLibrary: boolean;
}

export interface LibraryProcessingSummary {
  mediaType: LibraryMediaType;
  hasAssignmentSummary: boolean;
  totalFiles: number;
  assignedFiles: number;
  unassignedFiles: number;
  totalFileSize?: number;
  totalFileSizeFormatted?: string;
  completionPercent: number;
  seasonsWithFiles?: number;
  totalSeasons?: number;
  episodesWithFiles?: number;
  totalEpisodes?: number;
}

interface ExternalIdsLike {
  imdbId?: string;
  tmdbId?: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return isObject(value) ? value : {};
};

const getStringField = (obj: Record<string, unknown>, key: string): string | undefined => {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
};

const getNumberField = (obj: Record<string, unknown>, key: string): number | undefined => {
  const value = obj[key];
  return typeof value === 'number' ? value : undefined;
};

const getObjectField = (obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined => {
  const value = obj[key];
  return isObject(value) ? value : undefined;
};

export const isSeriesMedia = (media: LibraryMedia): media is CatalogSeries => {
  return Array.isArray((media as CatalogSeries).seasons);
};

export const getMediaType = (media: LibraryMedia): LibraryMediaType => {
  const mediaRecord = asRecord(media);

  const explicitMediaType = getStringField(mediaRecord, 'mediaType');
  if (explicitMediaType === 'series' || explicitMediaType === 'episode' || explicitMediaType === 'tv') {
    return 'series';
  }

  // Explicit subtype field written by backend pipeline
  const subType = getStringField(mediaRecord, 'mediaSubType') || getStringField(mediaRecord, 'subType');
  if (subType === 'documentary') return 'documentary';
  if (subType === 'live_performance') return 'live_performance';
  if (subType === 'home_video') return 'home_video';

  const detectTypeFromFolderPath = (folderPath?: string): LibraryMediaType | null => {
    if (!folderPath) {
      return null;
    }

    const normalised = folderPath.replace(/\\/g, '/');
    if (normalised.includes('_NeedsReview')) return 'needs_review';
    if (normalised.includes('Documentaries/')) return 'documentary';
    if (normalised.includes('Live Performances/')) return 'live_performance';
    if (normalised.includes('Home Videos/')) return 'home_video';
    if (normalised.includes('/TV Shows/') || normalised.includes('/Shows/')) return 'series';
    return null;
  };

  const directFolderPath = getStringField(mediaRecord, 'folderPath');
  const directType = detectTypeFromFolderPath(directFolderPath);
  if (directType) {
    return directType;
  }

  // Derive type from the organised Jellyfin folder path written back by FileOrganizationService
  const jellyfinInfo = getObjectField(mediaRecord, 'jellyfinInfo');
  const jellyfinFolderPath = jellyfinInfo ? getStringField(jellyfinInfo, 'folderPath') : undefined;
  const jellyfinType = detectTypeFromFolderPath(jellyfinFolderPath);
  if (jellyfinType) {
    return jellyfinType;
  }

  return isSeriesMedia(media) ? 'series' : 'movie';
};

export const getMediaId = (media: LibraryMedia): string => {
  const mediaRecord = asRecord(media);
  const externalIds = getObjectField(mediaRecord, 'externalIds');
  const externalImdbId = externalIds ? getStringField(externalIds, 'imdbId') : undefined;

  const candidate = [
    getStringField(mediaRecord, 'id'),
    getStringField(mediaRecord, 'imdbID'),
    externalImdbId,
    getStringField(mediaRecord, 'titleLower'),
    media.title
  ].find((value) => typeof value === 'string' && value.trim().length > 0);

  return (candidate as string) ?? 'unknown-media';
};

export const getTitleYearLabel = (media: LibraryMedia): string => {
  const mediaRecord = asRecord(media);
  const legacyOmdbData = getObjectField(mediaRecord, 'omdbData');
  const legacyYear = legacyOmdbData ? getStringField(legacyOmdbData, 'Year') : undefined;

  if (isSeriesMedia(media)) {
    return media.runningDates || legacyYear || 'N/A';
  }

  return media.releaseDate || legacyYear || 'N/A';
};

const getDiscIdsFromReleases = (releases: CatalogRelease[] | undefined): string[] => {
  if (!Array.isArray(releases)) {
    return [];
  }

  return releases.flatMap((release) => {
    if (!Array.isArray(release.discIds)) {
      return [];
    }

    return release.discIds.filter((discId) => typeof discId === 'string' && discId.trim().length > 0);
  });
};

const getFileCountFromDiscIds = (discIds: string[], discMap: Map<string, CatalogDisc>): number => {
  if (discIds.length === 0) {
    return 0;
  }

  return discIds.reduce((count, discId) => {
    const disc = discMap.get(discId);

    if (!disc) {
      // Fallback: count the disc itself when there are no file details loaded.
      return count + 1;
    }

    const videoCount = Array.isArray(disc.videoFiles) ? disc.videoFiles.length : 0;

    return count + (videoCount > 0 ? videoCount : 1);
  }, 0);
};

export const getFileCount = (media: LibraryMedia, discMap: Map<string, CatalogDisc>): number => {
  const mediaRecord = asRecord(media);
  const assignmentSummary = getObjectField(mediaRecord, 'assignmentSummary');
  const assignmentSummaryTotal = assignmentSummary ? getNumberField(assignmentSummary, 'totalFiles') : undefined;
  if (typeof assignmentSummaryTotal === 'number' && assignmentSummaryTotal >= 0) {
    return assignmentSummaryTotal;
  }

  const deprecatedLibraryFiles = mediaRecord.libraryFiles;
  if (Array.isArray(deprecatedLibraryFiles)) {
    return deprecatedLibraryFiles.length;
  }

  const explicitCount = getNumberField(mediaRecord, 'fileCount');
  if (typeof explicitCount === 'number' && explicitCount >= 0) {
    return explicitCount;
  }

  const legacyReleases = (mediaRecord.releases as CatalogRelease[] | undefined);
  const discIdsFromLegacyReleases = getDiscIdsFromReleases(legacyReleases);
  if (discIdsFromLegacyReleases.length > 0) {
    return getFileCountFromDiscIds(discIdsFromLegacyReleases, discMap);
  }

  return 0;
};

export const hasLocalFolder = (media: LibraryMedia): boolean => {
  const mediaRecord = asRecord(media);

  const directFolderPath = getStringField(mediaRecord, 'folderPath');
  if (typeof directFolderPath === 'string' && directFolderPath.trim().length > 0) {
    return true;
  }

  const jellyfinInfo = getObjectField(mediaRecord, 'jellyfinInfo');
  const jellyfinFolderPath = jellyfinInfo ? getStringField(jellyfinInfo, 'folderPath') : undefined;
  if (typeof jellyfinFolderPath === 'string' && jellyfinFolderPath.trim().length > 0) {
    return true;
  }

  return false;
};

export const isInLibrary = (media: LibraryMedia, fileCount: number): boolean => {
  if (hasLocalFolder(media) && fileCount > 0) {
    return true;
  }

  const mediaRecord = asRecord(media);
  const status = getStringField(mediaRecord, 'libraryStatus');
  if (status === 'available' && fileCount > 0) {
    return true;
  }

  return false;
};

export const toComputedMedia = (media: LibraryMedia, discMap: Map<string, CatalogDisc>): LibraryMediaWithComputed => {
  const fileCount = getFileCount(media, discMap);
  const mediaType = getMediaType(media);

  return {
    media,
    mediaType,
    mediaId: getMediaId(media),
    fileCount,
    hasLocalFolder: hasLocalFolder(media),
    inLibrary: isInLibrary(media, fileCount)
  };
};

export const getNfoMetadata = (media: LibraryMedia): Record<string, unknown> | null => {
  const mediaRecord = asRecord(media);

  const nfoCandidates = [
    mediaRecord.nfoData,
    mediaRecord.nfo,
    mediaRecord.nfoMetadata,
    mediaRecord.metadataFromNfo,
    mediaRecord.nfo_data
  ];

  const nfoValue = nfoCandidates.find((entry) => entry !== null && entry !== undefined);

  if (isObject(nfoValue)) {
    return nfoValue;
  }

  if (typeof nfoValue === 'string' && nfoValue.trim().length > 0) {
    return { raw: nfoValue };
  }

  return null;
};

export const getDiscIdsForMedia = (media: LibraryMedia): string[] => {
  const mediaRecord = asRecord(media);
  const releases = mediaRecord.releases as CatalogRelease[] | undefined;
  return getDiscIdsFromReleases(releases);
};

export const getDirectorsDisplay = (media: LibraryMedia): string => {
  if (!Array.isArray(media.directors) || media.directors.length === 0) {
    return 'N/A';
  }

  return media.directors
    .map((director) => {
      const directorRecord = asRecord(director);
      return (
        getStringField(directorRecord, 'fullName') ||
        getStringField(directorRecord, 'name') ||
        getStringField(directorRecord, 'title') ||
        ''
      );
    })
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(', ');
};

export const getCastDisplay = (media: LibraryMedia): string => {
  if (!Array.isArray(media.topCast) || media.topCast.length === 0) {
    return 'N/A';
  }

  return media.topCast
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      if (isObject(entry)) {
        const entryRecord = asRecord(entry);
        const legacyActor = entryRecord.actor;
        if (typeof legacyActor === 'string') {
          return legacyActor;
        }

        const actorName = entryRecord.actorName;
        if (typeof actorName === 'string') {
          return actorName;
        }

        const fullName = entryRecord.fullName;
        if (typeof fullName === 'string') {
          return fullName;
        }

        const name = entryRecord.name;
        if (typeof name === 'string') {
          return name;
        }
      }

      return '';
    })
    .filter((value) => value.length > 0)
    .join(', ');
};

export const getFolderPath = (media: LibraryMedia): string | null => {
  const mediaRecord = asRecord(media);
  const directFolderPath = getStringField(mediaRecord, 'folderPath');

  if (directFolderPath && directFolderPath.trim().length > 0) {
    return directFolderPath;
  }

  const jellyfinInfo = getObjectField(mediaRecord, 'jellyfinInfo');
  const jellyfinFolderPath = jellyfinInfo ? getStringField(jellyfinInfo, 'folderPath') : undefined;

  if (jellyfinFolderPath && jellyfinFolderPath.trim().length > 0) {
    return jellyfinFolderPath;
  }

  return null;
};

export const getExternalIds = (media: LibraryMedia): ExternalIdsLike | null => {
  const mediaRecord = asRecord(media);
  const ids = getObjectField(mediaRecord, 'externalIds');

  if (!ids) {
    return null;
  }

  const imdbId = getStringField(ids, 'imdbId');
  const tmdbId = getNumberField(ids, 'tmdbId');

  if (!imdbId && typeof tmdbId !== 'number') {
    return null;
  }

  return {
    imdbId,
    tmdbId
  };
};

const getSeriesEpisodeTotals = (media: CatalogSeries): { totalSeasons: number; totalEpisodes: number } => {
  const mediaRecord = asRecord(media);
  const seriesSummary = getObjectField(mediaRecord, 'seriesSummary');

  const summarySeasons = seriesSummary ? getNumberField(seriesSummary, 'totalSeasons') : undefined;
  const summaryEpisodes = seriesSummary ? getNumberField(seriesSummary, 'totalEpisodes') : undefined;

  const totalSeasonsFromArray = Array.isArray(media.seasons) ? media.seasons.length : 0;
  const totalEpisodesFromArray = Array.isArray(media.seasons)
    ? media.seasons.reduce((count, season) => {
        const seasonRecord = asRecord(season);
        const seasonEpisodeTotal = getNumberField(seasonRecord, 'totalEpisodes');
        if (typeof seasonEpisodeTotal === 'number' && seasonEpisodeTotal > 0) {
          return count + seasonEpisodeTotal;
        }

        const seasonEpisodes = seasonRecord.episodes;
        if (Array.isArray(seasonEpisodes)) {
          return count + seasonEpisodes.length;
        }

        return count;
      }, 0)
    : 0;

  return {
    totalSeasons: typeof summarySeasons === 'number' && summarySeasons > 0 ? summarySeasons : totalSeasonsFromArray,
    totalEpisodes: typeof summaryEpisodes === 'number' && summaryEpisodes > 0 ? summaryEpisodes : totalEpisodesFromArray,
  };
};

export const getProcessingSummary = (
  media: LibraryMedia,
  fallbackTotalFiles: number,
): LibraryProcessingSummary => {
  const mediaType = getMediaType(media);
  const mediaRecord = asRecord(media);
  const assignmentSummary = getObjectField(mediaRecord, 'assignmentSummary');

  const totalFilesFromSummary = assignmentSummary ? getNumberField(assignmentSummary, 'totalFiles') : undefined;
  const assignedFilesFromSummary = assignmentSummary ? getNumberField(assignmentSummary, 'assignedFiles') : undefined;
  const unassignedFilesFromSummary = assignmentSummary ? getNumberField(assignmentSummary, 'unassignedFiles') : undefined;
  const totalFileSize = assignmentSummary ? getNumberField(assignmentSummary, 'totalFileSize') : undefined;
  const totalFileSizeFormatted = assignmentSummary ? getStringField(assignmentSummary, 'totalFileSizeFormatted') : undefined;

  const totalFiles = typeof totalFilesFromSummary === 'number' && totalFilesFromSummary >= 0
    ? totalFilesFromSummary
    : Math.max(fallbackTotalFiles, 0);

  let assignedFiles = typeof assignedFilesFromSummary === 'number' && assignedFilesFromSummary >= 0
    ? assignedFilesFromSummary
    : totalFiles;

  let unassignedFiles = typeof unassignedFilesFromSummary === 'number' && unassignedFilesFromSummary >= 0
    ? unassignedFilesFromSummary
    : Math.max(totalFiles - assignedFiles, 0);

  if (assignedFiles + unassignedFiles !== totalFiles) {
    if (assignedFiles > totalFiles) {
      assignedFiles = totalFiles;
      unassignedFiles = 0;
    } else {
      unassignedFiles = Math.max(totalFiles - assignedFiles, 0);
    }
  }

  const summary: LibraryProcessingSummary = {
    mediaType,
    hasAssignmentSummary: Boolean(assignmentSummary),
    totalFiles,
    assignedFiles,
    unassignedFiles,
    totalFileSize,
    totalFileSizeFormatted,
    completionPercent: totalFiles > 0 ? Math.round((assignedFiles / totalFiles) * 100) : 0,
  };

  if (mediaType === 'series') {
    const totals = getSeriesEpisodeTotals(media as CatalogSeries);
    const seasonsWithFiles = assignmentSummary ? getNumberField(assignmentSummary, 'seasonsWithFiles') : undefined;
    const episodesWithFiles = assignmentSummary ? getNumberField(assignmentSummary, 'episodesWithFiles') : undefined;

    summary.totalSeasons = totals.totalSeasons;
    summary.totalEpisodes = totals.totalEpisodes;
    summary.seasonsWithFiles = typeof seasonsWithFiles === 'number' && seasonsWithFiles >= 0
      ? seasonsWithFiles
      : undefined;
    summary.episodesWithFiles = typeof episodesWithFiles === 'number' && episodesWithFiles >= 0
      ? episodesWithFiles
      : undefined;

    if (typeof summary.episodesWithFiles === 'number' && totals.totalEpisodes > 0) {
      summary.completionPercent = Math.round((summary.episodesWithFiles / totals.totalEpisodes) * 100);
    }
  }

  return summary;
};

/**
 * Pure derivation helpers for the library media details screen.
 *
 * Extracted from the (previously 1,400+ line) details page so the rules the page depends on
 * can be unit tested without rendering anything.
 */

export const PLACEHOLDER_POSTER = 'https://placehold.co/500x750/111111/f4f4f4?text=No+Poster';

const HTTP_URL = /^https?:\/\//i;
const SEASON_FOLDER_LEAF = /^Season\s+\d+$/i;
const EPISODE_FILE_NAME = /[Ss](\d{1,2})[Ee](\d{1,3})/;
const SEASON_PATH_NUMBER = /Season\s+(\d+)/i;

export interface LegacyOmdbData {
  Poster?: string;
  imdbID?: string;
}

export interface SeriesEpisodeOption {
  seasonNumber: number;
  seasonTitle: string;
  episodes: { episodeNumber: number; title: string }[];
}

export interface ProcessingSummaryFallbackShape {
  hasAssignmentSummary: boolean;
  totalFiles: number;
  assignedFiles: number;
  unassignedFiles: number;
  completionPercent: number;
}

/**
 * A series folderPath may point at a `Season NN` leaf. Folder browsing and reassignment both
 * need the series root instead, so strip the season leaf when present.
 */
export function getEffectiveFolderPath(folderPath: string, isSeries: boolean): string {
  if (!folderPath || !isSeries) {
    return folderPath;
  }

  const normalized = folderPath.replace(/\\/g, '/');
  const leaf = normalized.split('/').pop() || '';
  if (SEASON_FOLDER_LEAF.test(leaf)) {
    return normalized.split('/').slice(0, -1).join('/');
  }

  return folderPath;
}

export function getLegacyOmdbData(media: unknown): LegacyOmdbData | undefined {
  return media && typeof media === 'object' && 'omdbData' in media
    ? (media as { omdbData?: LegacyOmdbData }).omdbData
    : undefined;
}

/**
 * The poster source shown in Poster Tools: catalog image files first, then the legacy
 * posterUrl/Poster fields, then the legacy OMDB poster as a last resort.
 */
export function getPosterSourceFromMedia(
  media: unknown,
  legacyOmdbData?: LegacyOmdbData,
): string {
  if (!media) {
    return '';
  }

  const raw = media as unknown as Record<string, unknown>;
  const imageFiles = Array.isArray(raw.imageFiles) ? raw.imageFiles : [];
  const imagePoster = imageFiles.find(
    (img) => typeof img === 'object' && img !== null && typeof (img as { fileName?: unknown }).fileName === 'string'
  ) as { fileName?: string } | undefined;

  if (imagePoster?.fileName && HTTP_URL.test(imagePoster.fileName)) {
    return imagePoster.fileName;
  }

  const rawPoster = typeof raw.posterUrl === 'string' ? raw.posterUrl : typeof raw.Poster === 'string' ? raw.Poster : '';
  if (rawPoster && HTTP_URL.test(rawPoster)) {
    return rawPoster;
  }

  return legacyOmdbData?.Poster && legacyOmdbData.Poster !== 'N/A' ? legacyOmdbData.Poster : '';
}

export function getSeriesEpisodeOptions(matchedMedia: unknown): SeriesEpisodeOption[] {
  const mediaRecord = matchedMedia as unknown as Record<string, unknown>;
  const seasons = Array.isArray(mediaRecord.seasons) ? mediaRecord.seasons : [];

  return seasons
    .map((season, index) => {
      const seasonRecord = season as Record<string, unknown>;
      const rawSeasonNumber = seasonRecord.number ?? seasonRecord.seasonNumber ?? index + 1;
      const seasonNumber = typeof rawSeasonNumber === 'number' ? rawSeasonNumber : Number(rawSeasonNumber);
      const episodes = Array.isArray(seasonRecord.episodes) ? seasonRecord.episodes : [];

      return {
        seasonNumber,
        seasonTitle:
          typeof seasonRecord.title === 'string' && seasonRecord.title.trim().length > 0
            ? seasonRecord.title
            : `Season ${seasonNumber}`,
        episodes: episodes
          .map((episode) => {
            const episodeRecord = episode as Record<string, unknown>;
            const rawEpisodeNumber = episodeRecord.number ?? episodeRecord.episodeNumber;
            const episodeNumber = typeof rawEpisodeNumber === 'number' ? rawEpisodeNumber : Number(rawEpisodeNumber);
            return {
              episodeNumber,
              title:
                typeof episodeRecord.title === 'string' && episodeRecord.title.trim().length > 0
                  ? episodeRecord.title
                  : `Episode ${episodeNumber}`,
            };
          })
          .filter((episode) => Number.isFinite(episode.episodeNumber) && episode.episodeNumber > 0)
          .sort((a, b) => a.episodeNumber - b.episodeNumber),
      };
    })
    .filter((season) => Number.isFinite(season.seasonNumber) && season.seasonNumber >= 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
}

/**
 * When the catalog record has no assignment summary but files do exist on disk, show those
 * files as fully processed rather than an empty 0/0 summary.
 */
export function withFallbackFileCounts<T extends ProcessingSummaryFallbackShape>(
  summary: T,
  effectiveFileCount: number,
): T {
  if (summary.totalFiles === 0 && effectiveFileCount > 0) {
    return {
      ...summary,
      hasAssignmentSummary: false,
      totalFiles: effectiveFileCount,
      assignedFiles: effectiveFileCount,
      unassignedFiles: 0,
      completionPercent: 100,
    } as T;
  }

  return summary;
}

/** Pre-fills the episode assign dialog from an `S01E02`-style filename (empty when unmatched). */
export function getEpisodeHintFromFileName(name: string): { season: string; episode: string } {
  const match = EPISODE_FILE_NAME.exec(name);
  return { season: match?.[1] ?? '', episode: match?.[2] ?? '' };
}

export function getSeasonNumberFromFolderPath(path: string): string | undefined {
  return SEASON_PATH_NUMBER.exec(path)?.[1];
}

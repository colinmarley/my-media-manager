/**
 * The title detail page's pre-/detail resolution, kept only as a fallback for a backend that
 * has no `GET /api/catalog/media/{type}/{id}/detail` yet: load the whole movie, series and disc
 * catalogs, find the title client-side, then merge its forward (legacy releases[].discIds) and
 * reverse (/media/{type}/{id}/discs) disc links. No file inventory exists on such a backend.
 */
import { api } from '@/service/api/apiClient';
import { getDiscsAndTapesForMedia } from '@/service/catalog/MediaLinksService';
import {
  getDiscIdsForMedia,
  getMediaId,
  getMediaType,
  LibraryMedia,
} from '@/app/dashboard/my-library/_components/libraryHelpers';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { CatalogMovie } from '@/types/catalog/Movie.type';
import { CatalogSeries } from '@/types/catalog/Series.type';
import { CatalogTape } from '@/types/catalog/Tape.type';
import { DetailMediaType, MediaDetailResponse } from '@/types/library/MediaFile.type';
import { EMPTY_FILE_GROUPS, EMPTY_FILE_SUMMARY } from './MediaFilesService';

/** The old route match: same derived type, and the record id or any IMDb id equals the route id. */
export function findLegacyRecord(
  candidates: LibraryMedia[],
  mediaType: string | undefined,
  mediaId: string,
): LibraryMedia | null {
  return candidates.find((entry) => {
    const record = entry as unknown as Record<string, unknown>;
    const externalIds = (record.externalIds as Record<string, unknown> | undefined) || {};
    const imdbIds = [externalIds.imdbId, record.imdbID, record.imdbId].filter((v) => typeof v === 'string');
    return getMediaType(entry) === mediaType && (getMediaId(entry) === mediaId || imdbIds.includes(mediaId));
  }) ?? null;
}

/** Builds a /detail-shaped payload the old way, or null when the title does not exist. */
export async function loadLegacyMediaDetail(
  mediaType: string | undefined,
  mediaId: string,
): Promise<MediaDetailResponse | null> {
  const [movies, series, discs] = await Promise.all([
    api.get<CatalogMovie[]>('/api/catalog/movies'),
    api.get<CatalogSeries[]>('/api/catalog/series'),
    api.get<CatalogDisc[]>('/api/catalog/discs').catch(() => [] as CatalogDisc[]),
  ]);

  const media = findLegacyRecord([...(movies ?? []), ...(series ?? [])], mediaType, mediaId);
  if (!media) return null;

  const catalogType = (series ?? []).includes(media as CatalogSeries) ? 'series' : 'movie';
  const resolvedId = getMediaId(media);

  let linked: { discs: CatalogDisc[]; tapes: CatalogTape[] } = { discs: [], tapes: [] };
  try {
    linked = await getDiscsAndTapesForMedia(catalogType, resolvedId);
  } catch {
    // Older still: no reverse lookup either. The forward links below are all there is.
  }

  const discMap = new Map((discs ?? []).map((disc) => [disc.id, disc]));
  const byId = new Map<string, CatalogDisc>();
  for (const discId of getDiscIdsForMedia(media)) {
    const disc = discMap.get(discId);
    if (disc) byId.set(disc.id, disc);
  }
  for (const disc of linked.discs ?? []) byId.set(disc.id, disc);

  return {
    record: media as unknown as MediaDetailResponse['record'],
    mediaType: getMediaType(media) as DetailMediaType,
    catalogType,
    discs: Array.from(byId.values()),
    tapes: linked.tapes ?? [],
    files: EMPTY_FILE_GROUPS,
    summary: EMPTY_FILE_SUMMARY,
  };
}

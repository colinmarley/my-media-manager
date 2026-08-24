import { api } from '../api/apiClient';
import { retrieveMediaDataById, retrieveMovieDataByTitle, retrieveShowDataByTitle, searchByText } from '@/service/omdb/OmdbService';
import TmdbService from '@/service/tmdb/TmdbService';
import { OmdbResponseFull } from '@/types/OmdbResponse.type';

export type ImportMediaType = 'movie' | 'series';
export type ImportSource = 'omdb' | 'tmdb';

export interface ExternalSearchResult {
  source: ImportSource;
  mediaType: ImportMediaType;
  title: string;
  year?: number;
  posterUrl?: string;
  imdbId?: string;
  tmdbId?: number;
  overview?: string;
  raw: Record<string, unknown>;
}

export interface SaveMetadataResult {
  status: 'created' | 'updated' | 'conflicts' | 'error';
  message: string;
  collection: 'movies' | 'series';
  documentId?: string;
  document?: Record<string, unknown>;
  conflicts?: FieldConflict[];
  autoFilledCount?: number;
}

export interface FieldConflict {
  field: string;
  label: string;
  existing: unknown;
  incoming: unknown;
}

export type ConflictResolution = Record<string, 'existing' | 'incoming'>;

const normalizeType = (value: string | undefined): ImportMediaType => {
  if (!value) {
    return 'movie';
  }

  return value.toLowerCase() === 'series' ? 'series' : 'movie';
};

const parseYear = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const match = value.match(/\d{4}/);
  if (!match) {
    return undefined;
  }

  return Number(match[0]);
};

const splitAndClean = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const stripUndefinedDeep = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }

  if (value && typeof value === 'object') {
    const cleanedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefinedDeep(entry)]);

    return Object.fromEntries(cleanedEntries) as T;
  }

  return value;
};

const toTmdbPosterUrl = (posterPath: string | undefined): string | undefined => {
  if (!posterPath) {
    return undefined;
  }

  return `https://image.tmdb.org/t/p/w500${posterPath}`;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }

  return {};
};

const toStringValue = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
};

const toNumberValue = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
};

const getCollectionName = (mediaType: ImportMediaType): 'movies' | 'series' => {
  return mediaType === 'movie' ? 'movies' : 'series';
};

// ---------------------------------------------------------------------------
// Conflict detection helpers
// ---------------------------------------------------------------------------

const COMPARABLE_FIELDS: Array<{ field: string; label: string }> = [
  { field: 'title',         label: 'Title' },
  { field: 'releaseDate',   label: 'Release Date' },
  { field: 'runtime',       label: 'Runtime' },
  { field: 'language',      label: 'Language' },
  { field: 'countryOfOrigin', label: 'Country' },
  { field: 'contentRating', label: 'Content Rating' },
  { field: 'imdbRating',    label: 'IMDB Rating' },
  { field: 'imdbVotes',     label: 'IMDB Votes' },
  { field: 'metascore',     label: 'Metascore' },
  { field: 'awards',        label: 'Awards' },
  { field: 'boxOffice',     label: 'Box Office' },
  { field: 'tagline',       label: 'Tagline' },
  { field: 'plot',          label: 'Plot' },
  { field: 'genres',        label: 'Genres' },
  { field: 'totalSeasons',  label: 'Total Seasons' },
  { field: 'status',        label: 'Status' },
  { field: 'network',       label: 'Network' },
];

const isFieldEmpty = (val: unknown): boolean => {
  if (val === null || val === undefined || val === '') return true;
  if (Array.isArray(val) && val.length === 0) return true;
  return false;
};

const fieldValuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      JSON.stringify([...a].map(String).sort()) ===
      JSON.stringify([...b].map(String).sort())
    );
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
};

interface DocumentCompareResult {
  conflicts: FieldConflict[];
  autoFilledCount: number;
  merged: Record<string, unknown>;
}

const compareDocuments = (
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): DocumentCompareResult => {
  const conflicts: FieldConflict[] = [];
  let autoFilledCount = 0;
  const merged: Record<string, unknown> = { ...existing };

  for (const { field, label } of COMPARABLE_FIELDS) {
    const existingVal = existing[field];
    const incomingVal = incoming[field];

    if (isFieldEmpty(incomingVal)) continue;
    if (isFieldEmpty(existingVal)) {
      merged[field] = incomingVal;
      autoFilledCount++;
      continue;
    }
    if (!fieldValuesEqual(existingVal, incomingVal)) {
      conflicts.push({ field, label, existing: existingVal, incoming: incomingVal });
    }
  }

  // Always refresh the raw metadata blobs
  if (incoming.omdbData) merged.omdbData = incoming.omdbData;
  if (incoming.tmdbData) merged.tmdbData = incoming.tmdbData;

  return { conflicts, autoFilledCount, merged };
};

const mapOmdbResult = (raw: Record<string, unknown>): ExternalSearchResult => {
  const mediaType = normalizeType(toStringValue(raw, 'Type'));

  return {
    source: 'omdb',
    mediaType,
    title: toStringValue(raw, 'Title') || 'Unknown Title',
    year: parseYear(toStringValue(raw, 'Year')),
    posterUrl: toStringValue(raw, 'Poster'),
    imdbId: toStringValue(raw, 'imdbID'),
    raw
  };
};

const mapTmdbResult = (raw: Record<string, unknown>, mediaType: ImportMediaType): ExternalSearchResult => {
  const title = mediaType === 'movie'
    ? toStringValue(raw, 'title') || toStringValue(raw, 'original_title')
    : toStringValue(raw, 'name') || toStringValue(raw, 'original_name');

  const dateValue = mediaType === 'movie'
    ? toStringValue(raw, 'release_date')
    : toStringValue(raw, 'first_air_date');

  return {
    source: 'tmdb',
    mediaType,
    title: title || 'Unknown Title',
    year: parseYear(dateValue),
    posterUrl: toTmdbPosterUrl(toStringValue(raw, 'poster_path')),
    tmdbId: toNumberValue(raw, 'id'),
    overview: toStringValue(raw, 'overview'),
    raw
  };
};

const createFallbackOmdbData = (
  result: ExternalSearchResult,
  runtimeValue?: string,
  genreValue?: string,
  languageValue?: string,
  countryValue?: string
): OmdbResponseFull => {
  return {
    Title: result.title,
    Year: result.year ? String(result.year) : 'N/A',
    Rated: 'N/A',
    Released: result.year ? `01 Jan ${result.year}` : 'N/A',
    Runtime: runtimeValue || 'N/A',
    Genre: genreValue || 'N/A',
    Director: 'N/A',
    Writer: 'N/A',
    Actors: 'N/A',
    Plot: result.overview || 'N/A',
    Language: languageValue || 'N/A',
    Country: countryValue || 'N/A',
    Awards: 'N/A',
    Poster: result.posterUrl || 'N/A',
    Ratings: [],
    Metascore: 'N/A',
    imdbRating: 'N/A',
    imdbVotes: 'N/A',
    imdbID: result.imdbId || 'N/A',
    Type: result.mediaType,
    Response: 'True'
  };
};

const findExistingDocument = async (
  collectionName: 'movies' | 'series',
  imdbId: string | undefined,
  titleLower: string
): Promise<string | null> => {
  try {
    const params = new URLSearchParams();
    if (imdbId) params.set('imdbId', imdbId);
    else params.set('titleLower', titleLower);
    const result = await api.get<{ id: string } | null>(
      `/api/catalog/${collectionName}/lookup?${params.toString()}`
    );
    return result?.id ?? null;
  } catch {
    return null;
  }
};

const buildMovieDocument = (
  id: string,
  omdbData: OmdbResponseFull,
  tmdbId?: number,
  tmdbData?: Record<string, unknown>,
  mediaSubType?: string
): Record<string, unknown> => {
  const directors = splitAndClean(omdbData.Director).map((fullName) => ({
    fullName,
    title: 'Director'
  }));

  const topCast = splitAndClean(omdbData.Actors).map((actor) => ({
    actor,
    characters: [] as string[]
  }));

  const externalIds: Record<string, unknown> = {};
  if (omdbData.imdbID && omdbData.imdbID !== 'N/A') {
    externalIds.imdbId = omdbData.imdbID;
  }
  if (typeof tmdbId === 'number') {
    externalIds.tmdbId = tmdbId;
  }

  return {
    id,
    title: omdbData.Title,
    titleLower: omdbData.Title.toLowerCase(),
    countryOfOrigin: omdbData.Country || '',
    directors,
    imageFiles: [],
    omdbData,
    releaseDate: omdbData.Released || omdbData.Year || '',
    releases: [],
    runtime: omdbData.Runtime || '',
    topCast,
    writers: splitAndClean(omdbData.Writer),
    isPartOfCollection: false,
    genres: splitAndClean(omdbData.Genre),
    language: omdbData.Language || '',
    externalIds,
    awards: omdbData.Awards !== 'N/A' ? omdbData.Awards : undefined,
    imdbRating: omdbData.imdbRating !== 'N/A' ? omdbData.imdbRating : undefined,
    imdbVotes: omdbData.imdbVotes !== 'N/A' ? omdbData.imdbVotes : undefined,
    metascore: omdbData.Metascore !== 'N/A' ? omdbData.Metascore : undefined,
    contentRating: omdbData.Rated !== 'N/A' ? omdbData.Rated : undefined,
    boxOffice: omdbData.BoxOffice && omdbData.BoxOffice !== 'N/A' ? omdbData.BoxOffice : undefined,
    plot: omdbData.Plot !== 'N/A' ? omdbData.Plot : undefined,
    tmdbData: tmdbData || undefined,
    assignmentSummary: {
      totalFiles: 0,
      assignedFiles: 0,
      unassignedFiles: 0,
      versions: [],
      hasPhysicalCopy: false,
      totalFileSize: 0,
      totalFileSizeFormatted: '0 B',
    },
    ...(mediaSubType ? { mediaSubType } : {}),
  };
};

const buildSeriesDocument = (
  id: string,
  omdbData: OmdbResponseFull,
  tmdbId?: number,
  tmdbData?: Record<string, unknown>
): Record<string, unknown> => {
  const directors = splitAndClean(omdbData.Director).map((fullName) => ({
    fullName,
    title: 'Director'
  }));

  const externalIds: Record<string, unknown> = {};
  if (omdbData.imdbID && omdbData.imdbID !== 'N/A') {
    externalIds.imdbId = omdbData.imdbID;
  }
  if (typeof tmdbId === 'number') {
    externalIds.tmdbId = tmdbId;
  }

  return {
    id,
    title: omdbData.Title,
    titleLower: omdbData.Title.toLowerCase(),
    countryOfOrigin: omdbData.Country || '',
    directors,
    imageFiles: [],
    omdbData,
    runningDates: omdbData.Year || '',
    releases: [],
    runtime: omdbData.Runtime || '',
    topCast: splitAndClean(omdbData.Actors),
    writers: splitAndClean(omdbData.Writer),
    isPartOfCollection: false,
    seasons: [],
    imdbID: omdbData.imdbID,
    genres: splitAndClean(omdbData.Genre),
    language: omdbData.Language || '',
    externalIds,
    awards: omdbData.Awards !== 'N/A' ? omdbData.Awards : undefined,
    imdbRating: omdbData.imdbRating !== 'N/A' ? omdbData.imdbRating : undefined,
    imdbVotes: omdbData.imdbVotes !== 'N/A' ? omdbData.imdbVotes : undefined,
    metascore: omdbData.Metascore !== 'N/A' ? omdbData.Metascore : undefined,
    contentRating: omdbData.Rated !== 'N/A' ? omdbData.Rated : undefined,
    plot: omdbData.Plot !== 'N/A' ? omdbData.Plot : undefined,
    totalSeasons: omdbData.TotalSeasons && omdbData.TotalSeasons !== 'N/A' ? Number(omdbData.TotalSeasons) : undefined,
    status: tmdbData?.['status'] && tmdbData['status'] !== 'N/A' ? tmdbData['status'] : undefined,
    network: Array.isArray(tmdbData?.['networks']) && (tmdbData['networks'] as Record<string, unknown>[])[0]
      ? ((tmdbData['networks'] as Record<string, unknown>[])[0] as Record<string, unknown>)['name']
      : undefined,
    tagline: tmdbData?.['tagline'] && tmdbData['tagline'] !== 'N/A' ? tmdbData['tagline'] : undefined,
    tmdbData: tmdbData || undefined,
    assignmentSummary: {
      seasonsWithFiles: 0,
      episodesWithFiles: 0,
      totalFiles: 0,
      totalFileSize: 0,
      totalFileSizeFormatted: '0 B',
    }
  };
};

const fetchBestOmdbData = async (result: ExternalSearchResult): Promise<{ omdbData: OmdbResponseFull; tmdbId?: number; imdbId?: string; tmdbData?: Record<string, unknown> }> => {
  let tmdbId = result.tmdbId;
  let imdbId = result.imdbId;

  if (result.source === 'tmdb' && tmdbId) {
    const detailRecord = result.mediaType === 'movie'
      ? asRecord(await TmdbService.getMovieDetails(tmdbId))
      : asRecord(await TmdbService.getTVSeriesDetails(tmdbId));

    if (!imdbId && result.mediaType === 'movie') {
      imdbId = toStringValue(detailRecord, 'imdb_id');
    }

    if (!imdbId && result.mediaType === 'series') {
      const externalIds = asRecord(await TmdbService.getTVSeriesExternalIds(tmdbId));
      imdbId = toStringValue(externalIds, 'imdb_id');
    }

    const runtime = result.mediaType === 'movie'
      ? (toNumberValue(detailRecord, 'runtime') ? `${toNumberValue(detailRecord, 'runtime')} min` : undefined)
      : undefined;

    const genresRaw = detailRecord['genres'];
    const genres = Array.isArray(genresRaw)
      ? genresRaw
          .map((item) => asRecord(item))
          .map((item) => toStringValue(item, 'name'))
          .filter((entry): entry is string => Boolean(entry))
          .join(', ')
      : undefined;

    const language = toStringValue(detailRecord, 'original_language');
    const countryItems = detailRecord['origin_country'];
    const country = Array.isArray(countryItems)
      ? countryItems.map((item) => String(item)).join(', ')
      : undefined;

    if (imdbId) {
      try {
        const omdbData = await retrieveMediaDataById(imdbId);
        return { omdbData, tmdbId, imdbId, tmdbData: detailRecord };
      } catch {
        const fallback = createFallbackOmdbData(result, runtime, genres, language, country);
        fallback.imdbID = imdbId;
        return { omdbData: fallback, tmdbId, imdbId, tmdbData: detailRecord };
      }
    }

    return {
      omdbData: createFallbackOmdbData(result, runtime, genres, language, country),
      tmdbId,
      imdbId,
      tmdbData: detailRecord,
    };
  }

  if (imdbId) {
    const omdbData = await retrieveMediaDataById(imdbId);
    return { omdbData, tmdbId, imdbId };
  }

  if (result.mediaType === 'movie') {
    const omdbData = await retrieveMovieDataByTitle(result.title);
    return { omdbData, tmdbId, imdbId: omdbData.imdbID };
  }

  const omdbData = await retrieveShowDataByTitle(result.title);
  return { omdbData, tmdbId, imdbId: omdbData.imdbID };
};

export const searchExternalMetadataByImdbId = async (
  imdbId: string,
  mediaType: ImportMediaType
): Promise<ExternalSearchResult[]> => {
  const trimmed = imdbId.trim();
  if (!trimmed) {
    return [];
  }

  const omdbData = await retrieveMediaDataById(trimmed);
  const result = mapOmdbResult(omdbData as unknown as Record<string, unknown>);
  // Override mediaType with the caller's selection since OMDB may return 'game' etc.
  result.mediaType = mediaType;
  return [result];
};

export const searchExternalMetadata = async (
  queryText: string,
  mediaType: ImportMediaType,
  source: ImportSource
): Promise<ExternalSearchResult[]> => {
  const trimmed = queryText.trim();
  if (!trimmed) {
    return [];
  }

  if (source === 'omdb') {
    const results = await searchByText(trimmed);
    return results
      .map((entry) => mapOmdbResult(asRecord(entry)))
      .filter((entry) => entry.mediaType === mediaType);
  }

  const tmdbPayload = mediaType === 'movie'
    ? asRecord(await TmdbService.searchMovies(trimmed))
    : asRecord(await TmdbService.searchTV(trimmed));

  const tmdbResultsRaw = tmdbPayload['results'];
  const tmdbResults = Array.isArray(tmdbResultsRaw) ? tmdbResultsRaw : [];

  return tmdbResults.map((entry) => mapTmdbResult(asRecord(entry), mediaType));
};

export const saveExternalMetadataToCatalog = async (
  result: ExternalSearchResult,
  mediaSubType?: string
): Promise<SaveMetadataResult> => {
  try {
    const collectionName = getCollectionName(result.mediaType);
    const titleLower = result.title.toLowerCase();

    const resolved = await fetchBestOmdbData(result);
    const imdbId = resolved.imdbId || (resolved.omdbData.imdbID !== 'N/A' ? resolved.omdbData.imdbID : undefined);

    const existingId = await findExistingDocument(collectionName, imdbId, titleLower);

    const id = existingId ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${collectionName}-${Date.now()}`);

    const document = result.mediaType === 'movie'
      ? buildMovieDocument(id, resolved.omdbData, resolved.tmdbId, resolved.tmdbData, mediaSubType)
      : buildSeriesDocument(id, resolved.omdbData, resolved.tmdbId, resolved.tmdbData);

    if (!existingId) {
      const sanitizedDocument = stripUndefinedDeep(document);
      await api.put(`/api/catalog/${collectionName}/${id}`, sanitizedDocument);
      return {
        status: 'created',
        message: 'Metadata saved to catalog.',
        collection: collectionName,
        documentId: id,
        document: sanitizedDocument,
      };
    }

    // Existing record — compare and handle conflicts
    const existingDoc = await api.get<Record<string, unknown>>(
      `/api/catalog/${collectionName}/${existingId}`
    );
    const { conflicts, autoFilledCount, merged } = compareDocuments(existingDoc ?? {}, document);

    if (conflicts.length === 0) {
      const sanitized = stripUndefinedDeep(merged);
      await api.put(`/api/catalog/${collectionName}/${existingId}`, sanitized);
      return {
        status: 'updated',
        message: autoFilledCount > 0
          ? `Updated ${autoFilledCount} empty field${autoFilledCount !== 1 ? 's' : ''} with retrieved data.`
          : 'Record is already up to date.',
        collection: collectionName,
        documentId: existingId,
        document: sanitized,
        autoFilledCount,
      };
    }

    return {
      status: 'conflicts',
      message: `${conflicts.length} field${conflicts.length !== 1 ? 's differ' : ' differs'} from the retrieved data.`,
      collection: collectionName,
      documentId: existingId,
      document: stripUndefinedDeep(merged),
      conflicts,
      autoFilledCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save metadata.';
    return {
      status: 'error',
      message,
      collection: getCollectionName(result.mediaType),
    };
  }
};

export const saveManualMovieTitle = async (
  title: string,
  year: string,
  mediaSubType: string
): Promise<SaveMetadataResult> => {
  const collection = 'movies';
  try {
    const titleTrimmed = title.trim();
    const titleLower = titleTrimmed.toLowerCase();

    const existingId = await findExistingDocument(collection, undefined, titleLower);

    const id = existingId ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `movies-${Date.now()}`);

    const fallbackOmdb: OmdbResponseFull = {
      Title: titleTrimmed,
      Year: year || 'N/A',
      Rated: 'N/A',
      Released: year ? `01 Jan ${year}` : 'N/A',
      Runtime: 'N/A',
      Genre: 'N/A',
      Director: 'N/A',
      Writer: 'N/A',
      Actors: 'N/A',
      Plot: 'N/A',
      Language: 'N/A',
      Country: 'N/A',
      Awards: 'N/A',
      Poster: 'N/A',
      Ratings: [],
      Metascore: 'N/A',
      imdbRating: 'N/A',
      imdbVotes: 'N/A',
      imdbID: 'N/A',
      Type: 'movie',
      Response: 'True',
    };

    const document = stripUndefinedDeep(buildMovieDocument(id, fallbackOmdb, undefined, undefined, mediaSubType));

    if (existingId) {
      return {
        status: 'updated',
        message: 'A title with that name already exists in your catalog.',
        collection,
        documentId: existingId,
        document,
      };
    }

    await api.put(`/api/catalog/${collection}/${id}`, document);
    return {
      status: 'created',
      message: `"${titleTrimmed}" added to your library.`,
      collection,
      documentId: id,
      document,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save entry.';
    return { status: 'error', message, collection };
  }
};

export const applyConflictResolution = async (
  documentId: string,
  collection: 'movies' | 'series',
  pendingDocument: Record<string, unknown>,
  conflicts: FieldConflict[],
  resolution: ConflictResolution
): Promise<SaveMetadataResult> => {
  try {
    const finalDoc: Record<string, unknown> = { ...pendingDocument };
    for (const conflict of conflicts) {
      const choice = resolution[conflict.field] ?? 'existing';
      finalDoc[conflict.field] = choice === 'incoming' ? conflict.incoming : conflict.existing;
    }
    const sanitized = stripUndefinedDeep(finalDoc);
    await api.put(`/api/catalog/${collection}/${documentId}`, sanitized);
    return {
      status: 'updated',
      message: 'Catalog entry updated with your selections.',
      collection,
      documentId,
      document: sanitized,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply updates.';
    return { status: 'error', message, collection };
  }
};

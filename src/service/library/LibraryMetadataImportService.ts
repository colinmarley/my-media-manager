import { collection, doc, getDocs, limit, query, setDoc, where } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
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
  status: 'created' | 'exists' | 'error';
  message: string;
  collection: 'movies' | 'series';
  documentId?: string;
  document?: Record<string, unknown>;
}

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

const getDbOrThrow = () => {
  if (!db) {
    throw new Error('Firebase is not configured. Check .env.local and restart the app.');
  }

  return db;
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
  const activeDb = getDbOrThrow();

  if (imdbId) {
    const externalIdQuery = query(
      collection(activeDb, collectionName),
      where('externalIds.imdbId', '==', imdbId),
      limit(1)
    );
    const externalIdDocs = await getDocs(externalIdQuery);
    if (!externalIdDocs.empty) {
      return externalIdDocs.docs[0].id;
    }

    const legacyOmdbQuery = query(
      collection(activeDb, collectionName),
      where('omdbData.imdbID', '==', imdbId),
      limit(1)
    );
    const legacyOmdbDocs = await getDocs(legacyOmdbQuery);
    if (!legacyOmdbDocs.empty) {
      return legacyOmdbDocs.docs[0].id;
    }
  }

  const titleQuery = query(
    collection(activeDb, collectionName),
    where('titleLower', '==', titleLower),
    limit(1)
  );
  const titleDocs = await getDocs(titleQuery);
  if (!titleDocs.empty) {
    return titleDocs.docs[0].id;
  }

  return null;
};

const buildMovieDocument = (
  id: string,
  omdbData: OmdbResponseFull,
  tmdbId?: number
): Record<string, unknown> => {
  const directors = splitAndClean(omdbData.Director).map((fullName) => ({
    fullName,
    title: 'Director'
  }));

  const topCast = splitAndClean(omdbData.Actors).map((actor) => ({
    actor,
    characters: [] as string[]
  }));

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
    externalIds: {
      imdbId: omdbData.imdbID !== 'N/A' ? omdbData.imdbID : undefined,
      tmdbId,
    },
    assignmentSummary: {
      totalFiles: 0,
      assignedFiles: 0,
      unassignedFiles: 0,
      versions: [],
      hasPhysicalCopy: false,
      totalFileSize: 0,
      totalFileSizeFormatted: '0 B',
    }
  };
};

const buildSeriesDocument = (
  id: string,
  omdbData: OmdbResponseFull,
  tmdbId?: number
): Record<string, unknown> => {
  const directors = splitAndClean(omdbData.Director).map((fullName) => ({
    fullName,
    title: 'Director'
  }));

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
    externalIds: {
      imdbId: omdbData.imdbID !== 'N/A' ? omdbData.imdbID : undefined,
      tmdbId,
    },
    assignmentSummary: {
      seasonsWithFiles: 0,
      episodesWithFiles: 0,
      totalFiles: 0,
      totalFileSize: 0,
      totalFileSizeFormatted: '0 B',
    }
  };
};

const fetchBestOmdbData = async (result: ExternalSearchResult): Promise<{ omdbData: OmdbResponseFull; tmdbId?: number; imdbId?: string }> => {
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
        return { omdbData, tmdbId, imdbId };
      } catch {
        const fallback = createFallbackOmdbData(result, runtime, genres, language, country);
        fallback.imdbID = imdbId;
        return { omdbData: fallback, tmdbId, imdbId };
      }
    }

    return {
      omdbData: createFallbackOmdbData(result, runtime, genres, language, country),
      tmdbId,
      imdbId,
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

export const saveExternalMetadataToFirebase = async (
  result: ExternalSearchResult
): Promise<SaveMetadataResult> => {
  try {
    const activeDb = getDbOrThrow();
    const collectionName = getCollectionName(result.mediaType);
    const titleLower = result.title.toLowerCase();

    const resolved = await fetchBestOmdbData(result);
    const imdbId = resolved.imdbId || (resolved.omdbData.imdbID !== 'N/A' ? resolved.omdbData.imdbID : undefined);

    const existingId = await findExistingDocument(collectionName, imdbId, titleLower);
    if (existingId) {
      return {
        status: 'exists',
        message: 'This title is already in Firebase.',
        collection: collectionName,
        documentId: existingId,
      };
    }

    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${collectionName}-${Date.now()}`;

    const document = result.mediaType === 'movie'
      ? buildMovieDocument(id, resolved.omdbData, resolved.tmdbId)
      : buildSeriesDocument(id, resolved.omdbData, resolved.tmdbId);

    await setDoc(doc(collection(activeDb, collectionName), id), document);

    return {
      status: 'created',
      message: 'Metadata saved to Firebase.',
      collection: collectionName,
      documentId: id,
      document,
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

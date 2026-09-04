'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import useMovies from '@/hooks/catalog/useMovies';
import useSeries from '@/hooks/catalog/useSeries';
import useDiscs from '@/hooks/catalog/useDiscs';
import useMediaDiscsAndTapes from '@/hooks/catalog/useMediaDiscsAndTapes';
import {
  getCastDisplay,
  getDirectorsDisplay,
  getDiscIdsForMedia,
  getExternalIds,
  getFolderPath,
  getMediaId,
  getMediaType,
  getNfoMetadata,
  getProcessingSummary,
  getTitleYearLabel,
  LibraryMedia,
  toComputedMedia
} from '../../_components/libraryHelpers';
import ReassignFilesDialog from '../../_components/ReassignFilesDialog';
import DiskReassignDialog, { DiskReassignMode } from '../../_components/DiskReassignDialog';

const placeholderPoster = 'https://placehold.co/500x750/111111/f4f4f4?text=No+Poster';

type BrowseEntry = { name: string; path: string; isDirectory: boolean; size: number };
type FolderFileEntry = { name: string; path: string; size: number };

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function isVideoFileName(name: string): boolean {
  return /\.(mkv|mp4|avi|mov|wmv|m4v|flv|webm|m2ts|mts|ts|mpg|mpeg|iso|strm)$/i.test(name);
}

async function browseDestFolder(path: string): Promise<BrowseEntry[]> {
  const response = await fetch('/api/backend/api/files/dest-folder/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });

  if (!response.ok) {
    throw new Error(`Failed to browse folder (${response.status})`);
  }

  const data = await response.json();
  return Array.isArray(data.data) ? (data.data as BrowseEntry[]) : [];
}

async function loadMovieFolderFiles(path: string): Promise<FolderFileEntry[]> {
  const rootEntries = await browseDestFolder(path);
  const rootFiles = rootEntries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({ name: entry.name, path: entry.path, size: entry.size }));

  const subfolderFiles = await Promise.all(
    rootEntries
      .filter((entry) => entry.isDirectory)
      .map(async (entry) => {
        try {
          const nestedEntries = await browseDestFolder(entry.path);
          return nestedEntries
            .filter((nestedEntry) => !nestedEntry.isDirectory)
            .map((nestedEntry) => ({
              name: `${entry.name} / ${nestedEntry.name}`,
              path: nestedEntry.path,
              size: nestedEntry.size,
            }));
        } catch {
          return [] as FolderFileEntry[];
        }
      })
  );

  return [...rootFiles, ...subfolderFiles.flat()].sort((a, b) => a.name.localeCompare(b.name));
}

const LibraryMediaDetailPage = () => {
  const params = useParams<{ mediaType: string; mediaId: string }>();
  const router = useRouter();
  const mediaTypeFromRoute = params?.mediaType;
  const mediaIdFromRoute = decodeURIComponent(params?.mediaId || '');

  const { movies, loading: moviesLoading, error: moviesError } = useMovies();
  const { series, loading: seriesLoading, error: seriesError } = useSeries();
  const { discs, loading: discsLoading } = useDiscs();

  const loading = moviesLoading || seriesLoading || discsLoading;
  const error = moviesError || seriesError;

  const [posterIndex, setPosterIndex] = useState(0);
  const [posterCount, setPosterCount] = useState(1);
  const [posterRefreshAttempted, setPosterRefreshAttempted] = useState(false);
  const [posterLoadFailed, setPosterLoadFailed] = useState(false);
  const [posterSourceInput, setPosterSourceInput] = useState('');
  const [posterSourceSaving, setPosterSourceSaving] = useState(false);
  const [posterSourceStatus, setPosterSourceStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [posterCacheBust, setPosterCacheBust] = useState(() => Date.now());
  const [selectedDiscIds, setSelectedDiscIds] = useState<Set<string>>(new Set());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignSuccessMsg, setReassignSuccessMsg] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<FolderFileEntry[]>([]);
  const [folderFilesLoading, setFolderFilesLoading] = useState(false);
  const [seasonFolders, setSeasonFolders] = useState<{ name: string; path: string }[]>([]);
  const [selectedSeasonPath, setSelectedSeasonPath] = useState<string>('');
  const [diskNfoData, setDiskNfoData] = useState<Record<string, unknown> | null>(null);
  const [diskReassignOpen, setDiskReassignOpen] = useState(false);
  const [diskReassignMode, setDiskReassignMode] = useState<DiskReassignMode>('folder');
  const [diskReassignSource, setDiskReassignSource] = useState<string>('');
  const [diskReassignLabel, setDiskReassignLabel] = useState<string>('');
  const [diskReassignMsg, setDiskReassignMsg] = useState<string | null>(null);
  const [episodeAssignOpen, setEpisodeAssignOpen] = useState(false);
  const [episodeAssignFile, setEpisodeAssignFile] = useState<{ path: string; name: string } | null>(null);
  const [episodeAssignSeason, setEpisodeAssignSeason] = useState('');
  const [episodeAssignEpisode, setEpisodeAssignEpisode] = useState('');
  const [episodeAssignSaving, setEpisodeAssignSaving] = useState(false);
  const [episodeAssignError, setEpisodeAssignError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openDiskReassign = (mode: DiskReassignMode, sourcePath: string, label: string) => {
    setDiskReassignMode(mode);
    setDiskReassignSource(sourcePath);
    setDiskReassignLabel(label);
    setDiskReassignOpen(true);
  };

  const toggleDisc = (id: string) =>
    setSelectedDiscIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  useEffect(() => {
    if (!mediaTypeFromRoute || !mediaIdFromRoute) return;
    setPosterIndex(0);
    setPosterRefreshAttempted(false);
    setPosterLoadFailed(false);
    fetch(`/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}/list`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.count > 0) setPosterCount(data.count); })
      .catch(() => {});
  }, [mediaTypeFromRoute, mediaIdFromRoute]);

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

  const associatedTapes = linkedTapes;

  const processingSummary = useMemo(() => {
    if (!matchedMedia || !computed) {
      return null;
    }

    return getProcessingSummary(matchedMedia, computed.fileCount);
  }, [matchedMedia, computed]);

  const folderMediaFileCount = useMemo(() => {
    if (folderFiles.length === 0) {
      return 0;
    }

    // Count primary video files first; if none found, fall back to any non-sidecar file.
    const videoExt = /\.(mkv|mp4|avi|mov|wmv|m4v|flv|webm|m2ts|mts|ts|mpg|mpeg|iso|strm)$/i;
    const sidecarExt = /\.(nfo|srt|vtt|ass|ssa|sub|idx|jpg|jpeg|png|webp|gif|bmp|tbn|txt)$/i;

    const videoCount = folderFiles.filter((file) => videoExt.test(file.name)).length;
    if (videoCount > 0) {
      return videoCount;
    }

    const nonSidecarCount = folderFiles.filter((file) => !sidecarExt.test(file.name)).length;
    if (nonSidecarCount > 0) {
      return nonSidecarCount;
    }

    // Last resort: at least surface that files exist in the folder.
    return folderFiles.length;
  }, [folderFiles]);

  const effectiveFileCount = useMemo(() => {
    if (!computed) {
      return 0;
    }
    return computed.fileCount > 0 ? computed.fileCount : folderMediaFileCount;
  }, [computed, folderMediaFileCount]);

  const handlePosterLoadError = async (img: HTMLImageElement) => {
    if (!mediaTypeFromRoute || !mediaIdFromRoute || posterRefreshAttempted) {
      setPosterLoadFailed(true);
      img.onerror = null;
      img.src = fallbackPoster;
      return;
    }

    setPosterRefreshAttempted(true);

    try {
      const response = await fetch(
        `/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}/refresh`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );

      if (response.ok) {
        setPosterLoadFailed(false);
        img.src = `/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}?index=${posterIndex}&retry=${Date.now()}`;
        fetch(`/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}/list`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.count > 0) {
              setPosterCount(data.count);
            }
          })
          .catch(() => {});
        return;
      }
    } catch {
      // Fallback below
    }

    setPosterLoadFailed(true);
    img.onerror = null;
    img.src = fallbackPoster;
  };

  const effectiveInLibrary = useMemo(() => {
    if (!computed) {
      return false;
    }
    return computed.inLibrary || effectiveFileCount > 0 || folderFiles.length > 0;
  }, [computed, effectiveFileCount, folderFiles.length]);

  const effectiveProcessingSummary = useMemo(() => {
    if (!processingSummary) {
      return null;
    }

    if (processingSummary.totalFiles === 0 && effectiveFileCount > 0) {
      return {
        ...processingSummary,
        hasAssignmentSummary: false,
        totalFiles: effectiveFileCount,
        assignedFiles: effectiveFileCount,
        unassignedFiles: 0,
        completionPercent: 100,
      };
    }

    return processingSummary;
  }, [processingSummary, effectiveFileCount]);

  const legacyOmdbData = matchedMedia && typeof matchedMedia === 'object' && 'omdbData' in matchedMedia
    ? matchedMedia.omdbData as { Poster?: string; imdbID?: string } | undefined
    : undefined;

  const fallbackPoster = placeholderPoster;

  const currentPosterSource = useMemo(() => {
    if (!matchedMedia) {
      return '';
    }

    const raw = matchedMedia as unknown as Record<string, unknown>;
    const imageFiles = Array.isArray(raw.imageFiles) ? raw.imageFiles : [];
    const imagePoster = imageFiles.find(
      (img) => typeof img === 'object' && img !== null && typeof (img as { fileName?: unknown }).fileName === 'string'
    ) as { fileName?: string } | undefined;

    if (imagePoster?.fileName && /^https?:\/\//i.test(imagePoster.fileName)) {
      return imagePoster.fileName;
    }

    const rawPoster = typeof raw.posterUrl === 'string' ? raw.posterUrl : typeof raw.Poster === 'string' ? raw.Poster : '';
    if (rawPoster && /^https?:\/\//i.test(rawPoster)) {
      return rawPoster;
    }

    return legacyOmdbData?.Poster && legacyOmdbData.Poster !== 'N/A' ? legacyOmdbData.Poster : '';
  }, [matchedMedia, legacyOmdbData]);

  useEffect(() => {
    setPosterSourceInput(currentPosterSource);
    setPosterSourceStatus(null);
  }, [currentPosterSource]);

  const externalIds = matchedMedia ? getExternalIds(matchedMedia) : null;
  const folderPath = matchedMedia ? getFolderPath(matchedMedia) : null;
  const isSeries = computed?.mediaType === 'series';

  const effectiveFolderPath = useMemo(() => {
    if (!folderPath || !isSeries) {
      return folderPath;
    }
    const normalized = folderPath.replace(/\\/g, '/');
    const leaf = normalized.split('/').pop() || '';
    if (/^Season\s+\d+$/i.test(leaf)) {
      return normalized.split('/').slice(0, -1).join('/');
    }
    return folderPath;
  }, [folderPath, isSeries]);

  const seriesEpisodeOptions = useMemo(() => {
    if (!isSeries || !matchedMedia) {
      return [] as { seasonNumber: number; seasonTitle: string; episodes: { episodeNumber: number; title: string }[] }[];
    }

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
  }, [isSeries, matchedMedia]);

  const episodesForSelectedSeason = useMemo(() => {
    return seriesEpisodeOptions.find((season) => String(season.seasonNumber) === episodeAssignSeason)?.episodes ?? [];
  }, [seriesEpisodeOptions, episodeAssignSeason]);

  const refreshFolderFiles = (pathOverride?: string) => {
    const browsePath = pathOverride || (isSeries && selectedSeasonPath ? selectedSeasonPath : effectiveFolderPath);
    if (!browsePath) {
      return;
    }

    setFolderFilesLoading(true);
    (isSeries ? browseDestFolder(browsePath) : loadMovieFolderFiles(browsePath))
      .then((entries) => {
        const files = isSeries
          ? (entries as BrowseEntry[])
              .filter((entry) => !entry.isDirectory)
              .map((entry) => ({ name: entry.name, path: entry.path, size: entry.size }))
          : (entries as FolderFileEntry[]);
        setFolderFiles(files);
      })
      .catch(() => setFolderFiles([]))
      .finally(() => setFolderFilesLoading(false));
  };

  const openEpisodeAssignDialog = (file: { path: string; name: string }) => {
    setEpisodeAssignFile(file);
    setEpisodeAssignError(null);

    const episodeMatch = file.name.match(/[Ss](\d{1,2})[Ee](\d{1,3})/);
    const seasonFromFile = episodeMatch?.[1] || selectedSeasonPath.match(/Season\s+(\d+)/i)?.[1] || '';
    const episodeFromFile = episodeMatch?.[2] || '';

    setEpisodeAssignSeason(
      seasonFromFile || (seriesEpisodeOptions[0] ? String(seriesEpisodeOptions[0].seasonNumber) : '')
    );
    setEpisodeAssignEpisode(episodeFromFile);
    setEpisodeAssignOpen(true);
  };

  const handleEpisodeAssign = async (keepOriginalName = false) => {
    if (!episodeAssignFile || !effectiveFolderPath || !matchedMedia) {
      return;
    }

    if (!keepOriginalName && (!episodeAssignSeason || !episodeAssignEpisode)) {
      setEpisodeAssignError('Select both a season and an episode, or use the unknown-folder option.');
      return;
    }

    setEpisodeAssignSaving(true);
    setEpisodeAssignError(null);

    const selectedEpisode = episodesForSelectedSeason.find((episode) => String(episode.episodeNumber) === episodeAssignEpisode);

    try {
      const response = await fetch('/api/backend/api/files/dest-folder/assign-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: episodeAssignFile.path,
          seriesFolderPath: effectiveFolderPath,
          seriesTitle: matchedMedia.title || 'Unknown Series',
          seasonNumber: keepOriginalName ? undefined : (episodeAssignSeason ? Number(episodeAssignSeason) : undefined),
          episodeNumber: keepOriginalName ? undefined : Number(episodeAssignEpisode),
          episodeTitle: keepOriginalName ? undefined : selectedEpisode?.title,
          keepOriginalName,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail ?? 'Episode assignment failed.');
      }

      const targetDir = data?.data?.targetDir as string | undefined;
      setDiskReassignMsg(
        keepOriginalName
          ? `Moved ${episodeAssignFile.name} to the unknown season folder and kept the original filename.`
          : `Assigned ${episodeAssignFile.name} to S${episodeAssignSeason.padStart(2, '0')}E${episodeAssignEpisode.padStart(2, '0')}.`
      );
      setEpisodeAssignOpen(false);
      if (targetDir) {
        setSelectedSeasonPath(targetDir);
      }
      refreshFolderFiles(targetDir);
    } catch (err) {
      setEpisodeAssignError(err instanceof Error ? err.message : 'Episode assignment failed.');
    } finally {
      setEpisodeAssignSaving(false);
    }
  };

  // Browse the organized folder path to show the actual files on disk.
  useEffect(() => {
    if (!effectiveFolderPath) {
      setFolderFiles([]);
      setSeasonFolders([]);
      setSelectedSeasonPath('');
      return;
    }

    setFolderFilesLoading(true);
    browseDestFolder(effectiveFolderPath)
      .then(async (entries) => {
        if (!isSeries) {
          const files = await loadMovieFolderFiles(effectiveFolderPath);
          setFolderFiles(files);
          setSeasonFolders([]);
          setSelectedSeasonPath('');
          return;
        }

        const seasons = entries
          .filter((e) => e.isDirectory && /^Season\s+\d+$/i.test(e.name))
          .map((e) => ({ name: e.name, path: e.path }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        setSeasonFolders(seasons);

        const rootFiles = entries.filter((e) => !e.isDirectory);
        if (seasons.length > 0) {
          setSelectedSeasonPath((prev) => (seasons.some((s) => s.path === prev) ? prev : seasons[0].path));
          setFolderFiles([]);
        } else {
          setSelectedSeasonPath('');
          setFolderFiles(rootFiles);
        }
      })
      .catch(() => {
        setFolderFiles([]);
        setSeasonFolders([]);
        setSelectedSeasonPath('');
      })
      .finally(() => setFolderFilesLoading(false));
  }, [effectiveFolderPath, isSeries]);

  useEffect(() => {
    if (!isSeries || !selectedSeasonPath) {
      return;
    }

    setFolderFilesLoading(true);
    browseDestFolder(selectedSeasonPath)
      .then((entries) => {
        const files = entries
          .filter((e) => !e.isDirectory)
          .map((e) => ({ name: e.name, path: e.path, size: e.size }));
        setFolderFiles(files);
      })
      .catch(() => setFolderFiles([]))
      .finally(() => setFolderFilesLoading(false));
  }, [isSeries, selectedSeasonPath]);

  // Read NFO from disk when the catalog record has no NFO metadata but a folderPath is known.
  useEffect(() => {
    if (!folderPath || nfoMetadata) {
      setDiskNfoData(null);
      return;
    }
    fetch('/api/backend/api/files/dest-folder/nfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setDiskNfoData(data.data ?? null))
      .catch(() => setDiskNfoData(null));
  }, [folderPath, nfoMetadata]);

  const handlePosterSourceUpdate = async () => {
    if (!mediaTypeFromRoute || !mediaIdFromRoute) {
      return;
    }

    const sourceUrl = posterSourceInput.trim();
    if (!/^https?:\/\//i.test(sourceUrl)) {
      setPosterSourceStatus({ type: 'error', message: 'Enter a full http or https poster image URL.' });
      return;
    }

    setPosterSourceSaving(true);
    setPosterSourceStatus(null);

    try {
      const response = await fetch(
        `/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}/source`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceUrl }),
        }
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail ?? 'Poster source update failed.');
      }

      const totalPosters = typeof data.total_posters === 'number' && data.total_posters > 0
        ? data.total_posters
        : 1;
      const activeIndex = typeof data.activeIndex === 'number' ? data.activeIndex : totalPosters - 1;

      setPosterCount(totalPosters);
      setPosterIndex(Math.max(0, activeIndex));
      setPosterLoadFailed(false);
      setPosterRefreshAttempted(false);
      setPosterCacheBust(Date.now());
      setPosterSourceStatus({ type: 'success', message: data.message ?? 'Poster source updated.' });
    } catch (err) {
      setPosterSourceStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Poster source update failed.',
      });
    } finally {
      setPosterSourceSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const collection = mediaTypeFromRoute === 'series' ? 'series' : 'movies';
    try {
      const res = await fetch(
        `/api/backend/api/catalog/${collection}/${encodeURIComponent(mediaIdFromRoute)}/remove-to-review`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `Server error ${res.status}`);
      }
      router.push('/dashboard/my-library');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Remove failed.');
      setDeleting(false);
    }
  };

  return (
    <Box sx={styles.page}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Button
          component={Link}
          href="/dashboard/my-library"
          variant="text"
          startIcon={<ArrowBackIcon />}
          sx={{ color: '#cde7ff' }}
        >
          Back to My Library
        </Button>
        {matchedMedia && (
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<DeleteForeverIcon />}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            Remove from Library
          </Button>
        )}
      </Stack>

      {error && <Alert severity="error">Unable to load details: {error}</Alert>}

      {loading && <Typography>Loading media details...</Typography>}

      {!loading && !matchedMedia && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This title was not found. It may have been removed or its identifier has changed.
        </Alert>
      )}

      {!loading && mediaTypeFromRoute && mediaIdFromRoute && (
        <Paper sx={{ ...styles.sectionCard, mb: 2.5 }}>
          <Typography variant="h6" sx={styles.sectionTitle}>
            Poster Tools
          </Typography>
          <Alert severity={currentPosterSource ? 'info' : 'warning'} sx={{ mb: 1.5 }}>
            {currentPosterSource
              ? 'Paste a new poster URL here to replace the current source and refresh the cache.'
              : 'No poster source is set yet. Paste a direct image URL here to fetch and cache one for this title.'}
          </Alert>
          <Stack spacing={1.25}>
            <TextField
              fullWidth
              size="small"
              label="Poster image URL"
              value={posterSourceInput}
              onChange={(e) => setPosterSourceInput(e.target.value)}
              placeholder="https://example.com/poster.jpg"
              disabled={posterSourceSaving}
              sx={styles.posterSourceInput}
            />
            <Button
              variant="contained"
              onClick={() => void handlePosterSourceUpdate()}
              disabled={posterSourceSaving || !posterSourceInput.trim()}
              sx={{ alignSelf: 'flex-start' }}
            >
              {posterSourceSaving ? <CircularProgress size={18} color="inherit" /> : 'Save Poster Source'}
            </Button>
            {posterSourceStatus && (
              <Alert severity={posterSourceStatus.type}>{posterSourceStatus.message}</Alert>
            )}
          </Stack>
        </Paper>
      )}

      {!loading && matchedMedia && computed && (
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper sx={styles.posterCard}>
              <Box
                component="img"
                src={posterLoadFailed
                  ? fallbackPoster
                  : `/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}?index=${posterIndex}&v=${posterCacheBust}`}
                alt={matchedMedia.title || 'Media poster'}
                sx={styles.poster}
                loading="lazy"
                onError={(e) => {
                  void handlePosterLoadError(e.currentTarget as HTMLImageElement);
                }}
              />
              {posterCount > 1 && (
                <Stack direction="row" justifyContent="center" alignItems="center" sx={{ pt: 1 }}>
                  <IconButton
                    size="small"
                    disabled={posterIndex === 0}
                    onClick={() => setPosterIndex((i) => i - 1)}
                    aria-label="previous poster"
                  >
                    <ChevronLeftIcon />
                  </IconButton>
                  <Typography variant="caption" sx={{ mx: 1, opacity: 0.7 }}>
                    {posterIndex + 1} / {posterCount}
                  </Typography>
                  <IconButton
                    size="small"
                    disabled={posterIndex === posterCount - 1}
                    onClick={() => setPosterIndex((i) => i + 1)}
                    aria-label="next poster"
                  >
                    <ChevronRightIcon />
                  </IconButton>
                </Stack>
              )}

            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <Paper sx={styles.sectionCard}>
              <Typography variant="h4" sx={styles.title}>
                {matchedMedia.title || <em style={{ opacity: 0.5 }}>[No Title]</em>}
              </Typography>

              <Stack direction="row" spacing={1} sx={styles.chipRow}>
                <Chip label={computed.mediaType === 'movie' ? 'Movie' : 'Show'} color="primary" />
                <Chip
                  label={effectiveInLibrary ? 'In Library' : 'Not In Library'}
                  color={effectiveInLibrary ? 'success' : 'warning'}
                  variant={effectiveInLibrary ? 'filled' : 'outlined'}
                />
                <Chip label={`${effectiveFileCount} file${effectiveFileCount === 1 ? '' : 's'}`} />
              </Stack>

              <Divider sx={styles.divider} />

              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Release / Running Dates</Typography>
                  <Typography variant="body1">{getTitleYearLabel(matchedMedia)}</Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Runtime</Typography>
                  <Typography variant="body1">{matchedMedia.runtime || 'N/A'}</Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Country</Typography>
                  <Typography variant="body1">
                    {Array.isArray(matchedMedia.countryOfOrigin) && matchedMedia.countryOfOrigin.length > 0
                      ? matchedMedia.countryOfOrigin.join(', ')
                      : 'N/A'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Genres</Typography>
                  <Typography variant="body1">
                    {Array.isArray(matchedMedia.genres) && matchedMedia.genres.length > 0
                      ? matchedMedia.genres.join(', ')
                      : 'N/A'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Directors</Typography>
                  <Typography variant="body1">{getDirectorsDisplay(matchedMedia)}</Typography>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Top Cast</Typography>
                  <Typography variant="body1">{getCastDisplay(matchedMedia)}</Typography>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Writers</Typography>
                  <Typography variant="body1">
                    {Array.isArray(matchedMedia.writers) && matchedMedia.writers.length > 0
                      ? matchedMedia.writers.join(', ')
                      : 'N/A'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Folder Path</Typography>
                  <Typography variant="body1">
                    {folderPath || 'N/A'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>External IDs</Typography>
                  <Typography variant="body1">
                    {externalIds
                      ? `IMDB: ${externalIds.imdbId || legacyOmdbData?.imdbID || 'N/A'} | TMDB: ${externalIds.tmdbId || 'N/A'}`
                      : `IMDB: ${legacyOmdbData?.imdbID || 'N/A'}`}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Paper sx={styles.sectionCard}>
              <Typography variant="h6" sx={styles.sectionTitle}>
                Processing Summary
              </Typography>

              {effectiveProcessingSummary ? (
                <Grid container spacing={1.5}>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box sx={styles.metricTile}>
                      <Typography variant="caption" sx={styles.metricLabel}>Processed</Typography>
                      <Typography variant="h5" sx={styles.metricValue}>
                        {effectiveProcessingSummary.assignedFiles}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box sx={styles.metricTile}>
                      <Typography variant="caption" sx={styles.metricLabel}>Total Files</Typography>
                      <Typography variant="h5" sx={styles.metricValue}>
                        {effectiveProcessingSummary.totalFiles}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box sx={styles.metricTile}>
                      <Typography variant="caption" sx={styles.metricLabel}>Unprocessed</Typography>
                      <Typography variant="h5" sx={styles.metricValue}>
                        {effectiveProcessingSummary.unassignedFiles}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box sx={styles.metricTile}>
                      <Typography variant="caption" sx={styles.metricLabel}>Completion</Typography>
                      <Typography variant="h5" sx={styles.metricValue}>
                        {effectiveProcessingSummary.completionPercent}%
                      </Typography>
                    </Box>
                  </Grid>

                  {effectiveProcessingSummary.mediaType === 'series' && (
                    <>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="body2" sx={styles.metaLabel}>Episode Coverage</Typography>
                        <Typography variant="body1">
                          {(effectiveProcessingSummary.episodesWithFiles ?? 0)} / {(effectiveProcessingSummary.totalEpisodes ?? 0)} episodes with files
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="body2" sx={styles.metaLabel}>Season Coverage</Typography>
                        <Typography variant="body1">
                          {(effectiveProcessingSummary.seasonsWithFiles ?? 0)} / {(effectiveProcessingSummary.totalSeasons ?? 0)} seasons with files
                        </Typography>
                      </Grid>
                    </>
                  )}

                  <Grid size={{ xs: 12 }}>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      {effectiveProcessingSummary.hasAssignmentSummary ? (
                        <Chip size="small" color="success" label="Assignment summary available" />
                      ) : (
                        <Chip size="small" color="warning" variant="outlined" label="Using fallback counts from discs/files" />
                      )}
                      {effectiveProcessingSummary.totalFileSizeFormatted && (
                        <Chip size="small" label={`Total size: ${effectiveProcessingSummary.totalFileSizeFormatted}`} />
                      )}
                    </Stack>
                  </Grid>
                </Grid>
              ) : (
                <Alert severity="info">Processing summary is not available for this title yet.</Alert>
              )}
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Paper sx={styles.sectionCard}>
              <Typography variant="h6" sx={styles.sectionTitle}>
                Catalog Metadata
              </Typography>
              <Box component="pre" sx={styles.preBlock}>
                {JSON.stringify(matchedMedia, null, 2)}
              </Box>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Paper sx={styles.sectionCard}>
              <Typography variant="h6" sx={styles.sectionTitle}>
                NFO Metadata
              </Typography>
              {(nfoMetadata || diskNfoData) ? (
                <Box component="pre" sx={styles.preBlock}>
                  {JSON.stringify(nfoMetadata ?? diskNfoData, null, 2)}
                </Box>
              ) : (
                <Alert severity="info">No NFO metadata is currently available for this title.</Alert>
              )}
            </Paper>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Paper sx={styles.sectionCard}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="h6" sx={styles.sectionTitle}>
                  Associated Discs and Files
                </Typography>
                {selectedDiscIds.size > 0 && (
                  <Button
                    variant="contained"
                    color="warning"
                    size="small"
                    startIcon={<SwapHorizIcon />}
                    onClick={() => setReassignOpen(true)}
                  >
                    Reassign {selectedDiscIds.size} selected
                  </Button>
                )}
              </Stack>

              {reassignSuccessMsg && (
                <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setReassignSuccessMsg(null)}>
                  {reassignSuccessMsg}
                </Alert>
              )}

              {diskReassignMsg && (
                <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setDiskReassignMsg(null)}>
                  {diskReassignMsg}
                </Alert>
              )}

              {associatedDiscs.length === 0 && associatedTapes.length === 0 && !mediaLinksLoading
                && !folderFilesLoading && folderFiles.length === 0 && (
                <Alert severity="info">No associated disc or file records were found.</Alert>
              )}

              {folderFilesLoading && (
                <Typography variant="body2" sx={{ opacity: 0.7, py: 1 }}>Loading files from folder…</Typography>
              )}

              {!folderFilesLoading && folderFiles.length > 0 && (
                <>
                  <Alert severity="info" sx={{ mb: 1.5 }}>
                    Destination files on disk. You can manually reassign the entire folder or individual files.
                  </Alert>

                  {isSeries && seasonFolders.length > 0 && (
                    <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <FormControl size="small" sx={{ minWidth: 220 }}>
                        <InputLabel id="season-select-label">Season</InputLabel>
                        <Select
                          labelId="season-select-label"
                          label="Season"
                          value={selectedSeasonPath}
                          onChange={(e) => setSelectedSeasonPath(e.target.value)}
                        >
                          {seasonFolders.map((season) => (
                            <MenuItem key={season.path} value={season.path}>{season.name}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Typography variant="caption" color="text.secondary">
                        Showing files for the selected season folder.
                      </Typography>
                    </Box>
                  )}

                  {/* Folder-level reassign */}
                  {folderPath && (
                    <Box sx={{ mb: 1.5 }}>
                      <Button
                        variant="outlined"
                        color="warning"
                        size="small"
                        startIcon={<SwapHorizIcon />}
                        onClick={() =>
                          openDiskReassign(
                            'folder',
                            folderPath,
                            folderPath.split('/').pop() || folderPath
                          )
                        }
                      >
                        Reassign Entire Folder
                      </Button>
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
                        Renames the folder, files, and rewrites the NFO
                      </Typography>
                    </Box>
                  )}

                  <List disablePadding>
                    {folderFiles.map((file) => (
                      <ListItem
                        key={file.path}
                        sx={{ ...styles.listItem }}
                        secondaryAction={
                          <Stack direction="row" spacing={1}>
                            {isSeries && isVideoFileName(file.name) && (
                              <Button
                                size="small"
                                variant="text"
                                color="primary"
                                onClick={() => openEpisodeAssignDialog({ path: file.path, name: file.name })}
                              >
                                Assign Episode
                              </Button>
                            )}
                            <Button
                              size="small"
                              variant="text"
                              color="warning"
                              startIcon={<SwapHorizIcon />}
                              onClick={() =>
                                openDiskReassign('file', file.path, file.name)
                              }
                            >
                              Reassign
                            </Button>
                          </Stack>
                        }
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <InsertDriveFileIcon fontSize="small" sx={{ opacity: 0.7 }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={file.name}
                          secondary={file.size > 0 ? formatFileSize(file.size) : undefined}
                          sx={{ pr: 10 }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}

              {!folderFilesLoading && folderPath && folderFiles.length === 0 && (
                <Alert severity="info" sx={{ mb: 1.5 }}>
                  No files were found in the destination folder on disk.
                </Alert>
              )}

              {associatedDiscs.length > 0 && (
                <>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    Select disc records to reassign them to a different catalog entry.
                  </Typography>
                  <List disablePadding>
                    {associatedDiscs.map((disc) => (
                      <ListItem
                        key={disc.id}
                        sx={{ ...styles.listItem, cursor: 'pointer' }}
                        onClick={() => toggleDisc(disc.id)}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <Checkbox
                            edge="start"
                            checked={selectedDiscIds.has(disc.id)}
                            tabIndex={-1}
                            disableRipple
                            size="small"
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={disc.title || disc.id}
                          secondary={
                            (Array.isArray(disc.videoFiles) && disc.videoFiles.length > 0
                              ? disc.videoFiles.map((file) => file.fileName).join(', ')
                              : 'No video file names were stored on this disc record.')
                            + (disc.storageType && disc.storageId ? ` · ${disc.storageType} ${disc.storageId}` : ' · No storage location set')
                          }
                        />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}

              {associatedTapes.length > 0 && (
                <>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: associatedDiscs.length > 0 ? 2 : 0, mb: 0.5 }}>
                    Associated tapes.
                  </Typography>
                  <List disablePadding>
                    {associatedTapes.map((tape) => (
                      <ListItem key={tape.id} sx={styles.listItem}>
                        <ListItemText
                          primary={tape.title || tape.id}
                          secondary={
                            (Array.isArray(tape.videoFiles) && tape.videoFiles.length > 0
                              ? tape.videoFiles.map((file) => file.fileName).join(', ')
                              : 'No video file names were stored on this tape record.')
                            + (tape.storageType && tape.storageId ? ` · ${tape.storageType} ${tape.storageId}` : ' · No storage location set')
                          }
                        />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}
            </Paper>
          </Grid>
        </Grid>
      )}

      {diskReassignOpen && (
        <DiskReassignDialog
          open={diskReassignOpen}
          mode={diskReassignMode}
          sourcePath={diskReassignSource}
          sourceLabel={diskReassignLabel}
          currentMediaType={mediaTypeFromRoute}
          onClose={() => setDiskReassignOpen(false)}
          onReassigned={(newPath) => {
            setDiskReassignOpen(false);
            setDiskReassignMsg(
              diskReassignMode === 'folder'
                ? `Folder reassigned. New path: ${newPath}`
                : `File moved to: ${newPath}`
            );
            setFolderFiles([]);
            // Keep this details page scoped to the currently viewed media entry.
            // For file reassignments, loading `newPath` here shows destination-title files
            // on the source-title page until a manual reload.
            refreshFolderFiles();
          }}
        />
      )}

      {matchedMedia && reassignOpen && (
        <ReassignFilesDialog
          open={reassignOpen}
          fromMediaId={mediaIdFromRoute}
          fromMediaTitle={matchedMedia.title || 'this entry'}
          selectedDiscs={associatedDiscs
            .filter((d) => selectedDiscIds.has(d.id))
            .map((d) => ({
              id: d.id,
              title: d.title || d.id,
              fileNames: Array.isArray(d.videoFiles) ? d.videoFiles.map((f) => f.fileName) : [],
            }))}
          onClose={() => setReassignOpen(false)}
          onReassigned={(toMediaId, toMediaTitle) => {
            setReassignOpen(false);
            setSelectedDiscIds(new Set());
            setReassignSuccessMsg(
              `${selectedDiscIds.size} disc record${selectedDiscIds.size !== 1 ? 's' : ''} successfully reassigned to "${toMediaTitle}".`
            );
          }}
        />
      )}

      <Dialog open={episodeAssignOpen} onClose={() => !episodeAssignSaving && setEpisodeAssignOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign File to Episode</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Alert severity="info">
              Pick the correct episode from the show metadata, or move the file to the unknown season folder while keeping its original filename.
            </Alert>

            {episodeAssignFile && (
              <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                File: {episodeAssignFile.name}
              </Typography>
            )}

            {seriesEpisodeOptions.length > 0 ? (
              <>
                <FormControl fullWidth>
                  <InputLabel id="episode-assign-season-label">Season</InputLabel>
                  <Select
                    labelId="episode-assign-season-label"
                    label="Season"
                    value={episodeAssignSeason}
                    onChange={(e) => {
                      setEpisodeAssignSeason(e.target.value);
                      setEpisodeAssignEpisode('');
                    }}
                  >
                    {seriesEpisodeOptions.map((season) => (
                      <MenuItem key={season.seasonNumber} value={String(season.seasonNumber)}>
                        Season {season.seasonNumber.toString().padStart(2, '0')} · {season.seasonTitle}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel id="episode-assign-episode-label">Episode</InputLabel>
                  <Select
                    labelId="episode-assign-episode-label"
                    label="Episode"
                    value={episodeAssignEpisode}
                    onChange={(e) => setEpisodeAssignEpisode(e.target.value)}
                  >
                    {episodesForSelectedSeason.map((episode) => (
                      <MenuItem key={episode.episodeNumber} value={String(episode.episodeNumber)}>
                        E{episode.episodeNumber.toString().padStart(2, '0')} · {episode.title}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </>
            ) : (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField
                  fullWidth
                  type="number"
                  label="Season"
                  value={episodeAssignSeason}
                  onChange={(e) => setEpisodeAssignSeason(e.target.value)}
                />
                <TextField
                  fullWidth
                  type="number"
                  label="Episode"
                  value={episodeAssignEpisode}
                  onChange={(e) => setEpisodeAssignEpisode(e.target.value)}
                />
              </Stack>
            )}

            {episodeAssignError && <Alert severity="error">{episodeAssignError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEpisodeAssignOpen(false)} disabled={episodeAssignSaving}>Cancel</Button>
          <Button onClick={() => void handleEpisodeAssign(true)} disabled={episodeAssignSaving} color="warning">
            Keep Filename in Unknown Folder
          </Button>
          <Button variant="contained" onClick={() => void handleEpisodeAssign(false)} disabled={episodeAssignSaving}>
            {episodeAssignSaving ? <CircularProgress size={18} color="inherit" /> : 'Assign Episode'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmOpen} onClose={() => !deleting && setDeleteConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove from Library?</DialogTitle>
        <DialogContent>
          <Typography>
            <strong>{matchedMedia?.title}</strong> will be removed from your catalog.
          </Typography>
          <Typography sx={{ mt: 1 }}>
            If an organized folder exists on disk, it will be moved to <strong>_NeedsReview</strong> so you can decide whether to reprocess or permanently delete the files.
          </Typography>
          {deleteError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteForeverIcon />}
          >
            {deleting ? 'Removing…' : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    p: { xs: 2, md: 3 },
    background: 'radial-gradient(circle at 85% 10%, rgba(112, 182, 239, 0.2), transparent 50%), linear-gradient(145deg, #0f1519 0%, #15252f 50%, #1a2f3c 100%)',
    color: '#f7fbff'
  },
  backButton: {
    mb: 2,
    color: '#cde7ff'
  },
  posterCard: {
    p: 1.5,
    borderRadius: 2,
    border: '1px solid rgba(148, 188, 214, 0.25)',
    backgroundColor: 'rgba(9, 16, 20, 0.8)'
  },
  poster: {
    width: '100%',
    borderRadius: 1.5,
    maxHeight: 640,
    objectFit: 'cover'
  },
  posterSourceInput: {
    '& .MuiInputBase-input': {
      color: '#f7fbff',
    },
    '& .MuiInputLabel-root': {
      color: 'rgba(205, 229, 250, 0.78)',
    },
    '& .MuiInputLabel-root.Mui-focused': {
      color: '#70b6ef',
    },
    '& .MuiOutlinedInput-root': {
      '& fieldset': {
        borderColor: 'rgba(148, 188, 214, 0.3)',
      },
      '&:hover fieldset': {
        borderColor: 'rgba(148, 188, 214, 0.5)',
      },
      '&.Mui-focused fieldset': {
        borderColor: '#70b6ef',
      },
    },
  },
  sectionCard: {
    p: 2,
    borderRadius: 2,
    border: '1px solid rgba(148, 188, 214, 0.25)',
    backgroundColor: 'rgba(9, 16, 20, 0.8)'
  },
  title: {
    fontWeight: 700,
    mb: 1
  },
  chipRow: {
    mb: 1.5,
    flexWrap: 'wrap'
  },
  divider: {
    borderColor: 'rgba(190, 219, 245, 0.24)',
    mb: 1.5
  },
  metaLabel: {
    color: 'rgba(205, 229, 250, 0.78)',
    fontWeight: 600
  },
  sectionTitle: {
    mb: 1,
    fontWeight: 700
  },
  preBlock: {
    margin: 0,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    p: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(2, 6, 9, 0.6)',
    border: '1px solid rgba(149, 185, 211, 0.2)',
    maxHeight: 420
  },
  listItem: {
    borderBottom: '1px solid rgba(190, 219, 245, 0.15)'
  },
  metricTile: {
    p: 1.5,
    borderRadius: 1,
    border: '1px solid rgba(149, 185, 211, 0.25)',
    backgroundColor: 'rgba(2, 6, 9, 0.5)',
  },
  metricLabel: {
    color: 'rgba(205, 229, 250, 0.78)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metricValue: {
    fontWeight: 800,
  }
};

export default LibraryMediaDetailPage;

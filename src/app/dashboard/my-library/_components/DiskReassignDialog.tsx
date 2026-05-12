'use client';

import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SearchIcon from '@mui/icons-material/Search';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import TheatersIcon from '@mui/icons-material/Theaters';
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useCallback, useState } from 'react';
import { api } from '@/service/api/apiClient';
import MediaAssignmentSearchService, {
  FolderFileStats,
  SearchResult,
} from '@/service/library/MediaAssignmentSearchService';

const searchService = MediaAssignmentSearchService;

export type DiskReassignMode = 'folder' | 'file';

interface Props {
  open: boolean;
  /** 'folder' — rename the whole folder+files+nfo; 'file' — move a single file */
  mode: DiskReassignMode;
  /** Absolute path to the folder (mode=folder) or file (mode=file) */
  sourcePath: string;
  /** Human-readable label for what is being reassigned */
  sourceLabel?: string;
  /** Media type of the *current* assignment (drives which category is searched by default) */
  currentMediaType?: string;
  onClose: () => void;
  /** Called with the new folder path on success */
  onReassigned: (newPath: string) => void;
}

interface ReassignResult {
  newFolderPath?: string;
  targetFile?: string;
  targetDir?: string;
  operations: string[];
  errors: string[];
}

type SearchMediaType = 'movie' | 'series';
type TargetMediaType = 'movie' | 'series' | 'documentary' | 'live_performance';

interface DestEntry {
  path: string;
  isDirectory: boolean;
  size?: number;
}

interface ExtractMetadataResponse {
  data?: {
    fileMetadata?: {
      path?: string;
      extension?: string;
      size?: number;
      mediaMetadata?: {
        duration?: number;
        videoMetadata?: {
          resolution?: string;
          resolutionCategory?: string;
          bitrate?: number;
          codec?: string;
        };
      };
    };
  };
}

type ExtractedFileMetadata = NonNullable<NonNullable<ExtractMetadataResponse['data']>['fileMetadata']>;

function getDefaultTargetMediaType(currentMediaType?: string): TargetMediaType {
  if (currentMediaType === 'series') return 'series';
  if (currentMediaType === 'documentary') return 'documentary';
  if (currentMediaType === 'live_performance') return 'live_performance';
  return 'movie';
}

function getTargetFolderLabel(mediaType: TargetMediaType): string {
  if (mediaType === 'series') return 'TV Shows';
  if (mediaType === 'documentary') return 'Documentaries';
  if (mediaType === 'live_performance') return 'Live Performances';
  return 'Movies';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function deriveRuntimeLabel(durationMs?: number): string {
  if (!durationMs || durationMs <= 0) return '';
  return `${Math.max(1, Math.round(durationMs / 60000))} min`;
}

function extractYearValue(rawYear?: string): string {
  if (!rawYear) return '';
  const match = rawYear.match(/(19|20)\d{2}/);
  return match ? match[0] : '';
}

function generateCustomId(prefix: 'movie' | 'series'): string {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (maybeCrypto?.randomUUID) {
    return `${prefix}-custom-${maybeCrypto.randomUUID()}`;
  }
  return `${prefix}-custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function browseDestFolder(path: string): Promise<DestEntry[]> {
  const response = await fetch('/api/backend/api/files/dest-folder/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });

  if (!response.ok) {
    throw new Error(`Failed to browse destination folder (${response.status})`);
  }
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data as DestEntry[] : [];
}

async function resolveRepresentativeFile(folderPath: string, targetFilePath?: string): Promise<DestEntry | null> {
  if (targetFilePath) {
    return { path: targetFilePath, isDirectory: false, size: 0 };
  }

  const rootEntries = await browseDestFolder(folderPath);
  const rootFiles = rootEntries.filter((entry) => !entry.isDirectory);

  const nestedFileGroups = await Promise.all(
    rootEntries
      .filter((entry) => entry.isDirectory)
      .map(async (entry) => {
        try {
          const nestedEntries = await browseDestFolder(entry.path);
          return nestedEntries.filter((nestedEntry) => !nestedEntry.isDirectory);
        } catch {
          return [] as DestEntry[];
        }
      })
  );

  const allFiles = [...rootFiles, ...nestedFileGroups.flat()];
  if (allFiles.length === 0) return null;

  const videoFirst = allFiles.filter((entry) => /\.(mkv|mp4|m4v|mov|webm|avi|ts|m2ts|wmv)$/i.test(entry.path));
  const pickFrom = videoFirst.length > 0 ? videoFirst : allFiles;
  pickFrom.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  return pickFrom[0];
}

async function extractTechnicalMetadata(filePath: string): Promise<ExtractedFileMetadata | undefined> {
  const response = await fetch('/api/backend/api/metadata/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, extractThumbnail: false }),
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = await response.json() as ExtractMetadataResponse;
  return payload?.data?.fileMetadata;
}

async function loadFolderFileStats(folderPath: string): Promise<FolderFileStats> {
  const rootEntries = await browseDestFolder(folderPath);
  const rootFiles = rootEntries.filter((entry) => !entry.isDirectory);

  const nestedFileGroups = await Promise.all(
    rootEntries
      .filter((entry) => entry.isDirectory)
      .map(async (entry) => {
        try {
          const nestedEntries = await browseDestFolder(entry.path);
          return nestedEntries.filter((nestedEntry) => !nestedEntry.isDirectory);
        } catch {
          return [] as DestEntry[];
        }
      })
  );

  const allFiles = [...rootFiles, ...nestedFileGroups.flat()];
  const totalFileSize = allFiles.reduce((sum: number, file) => sum + (file.size || 0), 0);

  return {
    fileCount: allFiles.length,
    totalFileSize,
  };
}

export default function DiskReassignDialog({
  open,
  mode,
  sourcePath,
  sourceLabel,
  currentMediaType,
  onClose,
  onReassigned,
}: Props) {
  const defaultTargetMediaType = getDefaultTargetMediaType(currentMediaType);
  const defaultSearchMediaType: SearchMediaType = defaultTargetMediaType === 'series' ? 'series' : 'movie';

  const [searchText, setSearchText] = useState('');
  const [searchMediaType, setSearchMediaType] = useState<SearchMediaType>(defaultSearchMediaType);
  const [targetMediaType, setTargetMediaType] = useState<TargetMediaType>(defaultTargetMediaType);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<SearchResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [result, setResult] = useState<ReassignResult | null>(null);
  const [fileCategory, setFileCategory] = useState<'main_feature' | 'special_feature' | 'unknown' | 'episode'>('main_feature');
  const [useCustomName, setUseCustomName] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customYear, setCustomYear] = useState('');

  const selectedImdbId = selectedTarget?.imdbId ?? '';
  const hasValidImdb = /^tt\d+$/i.test(selectedImdbId);
  const canSubmitCustom = customTitle.trim().length > 0;

  const handleSearch = useCallback(async () => {
    if (!searchText.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    setSelectedTarget(null);
    try {
      const results = await searchService.combinedSearch(searchText.trim(), searchMediaType);
      setSearchResults(results);
      if (results.length === 0) setSearchError('No results found.');
    } catch {
      setSearchError('Search failed. Please try again.');
    } finally {
      setSearchLoading(false);
    }
  }, [searchText, searchMediaType]);

  const handleConfirm = async () => {
    if (!useCustomName && !selectedTarget) return;
    if (useCustomName && !canSubmitCustom) return;
    setSaving(true);
    setError(null);
    setResult(null);

    const endpoint =
      mode === 'folder'
        ? '/api/backend/api/files/dest-folder/reassign-folder'
        : '/api/backend/api/files/dest-folder/reassign-file';

    const backendMediaType = targetMediaType;
    const chosenTitle = useCustomName ? customTitle.trim() : selectedTarget?.title || '';
    const chosenYear = useCustomName ? customYear.trim() : (selectedTarget?.year ? String(selectedTarget.year) : undefined);
    const chosenImdbId = useCustomName ? undefined : (selectedTarget?.imdbId ?? undefined);

    const body =
      mode === 'folder'
        ? {
            currentFolderPath: sourcePath,
            newTitle: chosenTitle,
            newYear: chosenYear,
            newImdbId: chosenImdbId,
            allowCustomName: useCustomName,
            mediaType: backendMediaType,
          }
        : {
            filePath: sourcePath,
            newTitle: chosenTitle,
            newYear: chosenYear,
            newImdbId: chosenImdbId,
            allowCustomName: useCustomName,
            mediaType: backendMediaType,
            fileCategory,
          };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail ?? `Server error ${res.status}`);
      }
      const resultData: ReassignResult = data.data;
      const newPath = resultData.newFolderPath ?? resultData.targetDir ?? sourcePath;

      // Sync the catalog to reflect the new disk location.
      if (resultData.errors.length === 0) {
        try {
          const fileStats = await loadFolderFileStats(newPath);
          if (useCustomName) {
            const representativeFile = await resolveRepresentativeFile(newPath, resultData.targetFile);
            const extracted = representativeFile ? await extractTechnicalMetadata(representativeFile.path) : undefined;
            const mediaMeta = extracted?.mediaMetadata;
            const videoMeta = mediaMeta?.videoMetadata;
            const runtime = deriveRuntimeLabel(mediaMeta?.duration);
            const isSeriesTarget = targetMediaType === 'series';
            const collection = isSeriesTarget ? 'series' : 'movies';
            const generatedId = generateCustomId(isSeriesTarget ? 'series' : 'movie');

            const rawDoc: Record<string, unknown> = {
              id: generatedId,
              title: chosenTitle,
              titleLower: chosenTitle.toLowerCase(),
              mediaType: isSeriesTarget ? 'series' : targetMediaType,
              mediaSubType: !isSeriesTarget && targetMediaType !== 'movie' ? targetMediaType : undefined,
              releaseDate: !isSeriesTarget ? extractYearValue(chosenYear) : undefined,
              runningDates: isSeriesTarget ? (extractYearValue(chosenYear) || '') : undefined,
              runtime,
              genres: [],
              countries: [],
              languages: [],
              externalIds: {},
              imageFiles: [],
              folderPath: newPath,
              jellyfinInfo: { folderPath: newPath },
              libraryStatus: 'available',
              fileCount: fileStats.fileCount,
              assignmentSummary: {
                totalFiles: fileStats.fileCount,
                assignedFiles: fileStats.fileCount,
                unassignedFiles: 0,
                totalFileSize: fileStats.totalFileSize,
                totalFileSizeFormatted: formatBytes(fileStats.totalFileSize),
              },
              technicalMetadata: {
                sourceFilePath: representativeFile?.path,
                fileExtension: extracted?.extension,
                fileSize: extracted?.size ?? representativeFile?.size,
                fileSizeFormatted: formatBytes((extracted?.size ?? representativeFile?.size ?? 0)),
                durationMs: mediaMeta?.duration || null,
                quality: videoMeta?.resolutionCategory || null,
                resolution: videoMeta?.resolution || null,
                videoCodec: videoMeta?.codec || null,
                videoBitrate: videoMeta?.bitrate || null,
              },
              omdbData: {
                Title: chosenTitle,
                Year: extractYearValue(chosenYear) || 'N/A',
                Runtime: runtime || 'N/A',
                Type: isSeriesTarget ? 'series' : 'movie',
                imdbID: '',
                Poster: 'N/A',
              },
            };

            await api.put(`/api/catalog/${collection}/${generatedId}`, rawDoc);
            resultData.operations.push(`Saved custom catalog entry for "${chosenTitle}" using file metadata`);
            resultData.operations.push(`Updated catalog folder path → ${newPath}`);
          } else {
            const resolvedTarget = await searchService.ensureCatalogEntry(
              selectedTarget as SearchResult,
              searchMediaType,
              newPath,
              fileStats,
              targetMediaType === 'series' ? 'movie' : targetMediaType,
            );
            const collection = targetMediaType === 'series' ? 'series' : 'movies';
            await api.patch(`/api/catalog/${collection}/${resolvedTarget.id}/folder-path`, {
              folderPath: newPath,
            });
            resultData.operations.push(`Synced catalog metadata for "${resolvedTarget.title}"`);
            resultData.operations.push(`Updated catalog folder path → ${newPath}`);
          }
        } catch (catalogErr) {
          resultData.errors.push(
            `Disk files moved OK, but catalog sync failed: ${catalogErr instanceof Error ? catalogErr.message : String(catalogErr)}`
          );
        }
      }

      setResult(resultData);
      if (resultData.errors.length === 0) {
        const newPath = resultData.newFolderPath ?? resultData.targetDir ?? sourcePath;
        onReassigned(newPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reassignment failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    setSearchText('');
    setSearchResults([]);
    setSelectedTarget(null);
    setError(null);
    setSearchError(null);
    setResult(null);
    setFileCategory('main_feature');
    setUseCustomName(false);
    setCustomTitle('');
    setCustomYear('');
    setSearchMediaType(defaultSearchMediaType);
    setTargetMediaType(defaultTargetMediaType);
    onClose();
  };

  const isFolderMode = mode === 'folder';

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {isFolderMode ? <FolderOpenIcon color="warning" /> : <DriveFileMoveIcon color="warning" />}
          <Box>
            <Typography variant="h6">
              {isFolderMode ? 'Reassign Folder to Different Title' : 'Reassign File to Different Title'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
              {sourceLabel || sourcePath}
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {/* What will happen */}
        <Alert severity="warning" sx={{ mb: 2 }}>
          {isFolderMode ? (
            <Typography variant="body2">
              The <strong>folder will be renamed</strong>, all video/subtitle files inside will be
              renamed to match, and the <strong>NFO will be overwritten</strong> with the new
              title&apos;s metadata. This cannot be easily undone.
            </Typography>
          ) : fileCategory === 'special_feature' ? (
            <Typography variant="body2">
              The <strong>file will be moved</strong> into a <strong>Featurettes</strong> subfolder
              inside the target title&apos;s folder (created if needed), keeping its original filename.
            </Typography>
          ) : fileCategory === 'episode' ? (
            <Typography variant="body2">
              The <strong>file will be moved</strong> into a <strong>Season 00</strong> subfolder
              inside the target folder (created if needed), keeping its original filename.
            </Typography>
          ) : fileCategory === 'unknown' ? (
            <Typography variant="body2">
              The <strong>file will be moved</strong> into the target folder with its
              <strong> original filename</strong> preserved (folder created if needed).
            </Typography>
          ) : (
            <Typography variant="body2">
              The <strong>file will be moved</strong> into the <strong>{getTargetFolderLabel(targetMediaType)}</strong> destination folder (which
              will be created if needed) and <strong>renamed to match</strong> the title. An NFO
              file will be written if one doesn&apos;t exist yet.
            </Typography>
          )}
        </Alert>

        {/* Result panel after success */}
        {result && (
          <Alert
            severity={result.errors.length === 0 ? 'success' : 'error'}
            icon={result.errors.length === 0 ? <CheckCircleOutlineIcon /> : undefined}
            sx={{ mb: 2 }}
          >
            <Typography variant="body2" fontWeight={600}>
              {result.errors.length === 0 ? 'Done!' : 'Completed with errors'}
            </Typography>
            {result.operations.map((op, i) => (
              <Typography key={i} variant="caption" display="block">
                {op}
              </Typography>
            ))}
            {result.errors.map((e, i) => (
              <Typography key={i} variant="caption" display="block" color="error">
                {e}
              </Typography>
            ))}
          </Alert>
        )}

        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel id="target-media-type-label">Save As</InputLabel>
          <Select
            labelId="target-media-type-label"
            label="Save As"
            value={targetMediaType}
            onChange={(e) => {
              const next = e.target.value as TargetMediaType;
              setTargetMediaType(next);
              setSearchResults([]);
              setSelectedTarget(null);
              setSearchMediaType(next === 'series' ? 'series' : 'movie');
            }}
          >
            <MenuItem value="movie">Movie</MenuItem>
            <MenuItem value="series">TV Show</MenuItem>
            <MenuItem value="documentary">Documentary</MenuItem>
            <MenuItem value="live_performance">Live Performance</MenuItem>
          </Select>
        </FormControl>

        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <Button
            size="small"
            variant={searchMediaType === 'movie' ? 'contained' : 'outlined'}
            startIcon={<MovieIcon />}
            onClick={() => {
              setSearchMediaType('movie');
              setSearchResults([]);
              setSelectedTarget(null);
            }}
            disabled={targetMediaType === 'series'}
          >
            Search Movies
          </Button>
          <Button
            size="small"
            variant={searchMediaType === 'series' ? 'contained' : 'outlined'}
            startIcon={<TvIcon />}
            onClick={() => {
              setSearchMediaType('series');
              setSearchResults([]);
              setSelectedTarget(null);
            }}
            disabled={targetMediaType !== 'series'}
          >
            Search TV Shows
          </Button>
        </Stack>

        <Button
          size="small"
          variant={useCustomName ? 'contained' : 'outlined'}
          onClick={() => {
            setUseCustomName((prev) => !prev);
            setSearchResults([]);
            setSelectedTarget(null);
            setSearchError(null);
          }}
          sx={{ mb: 1.5 }}
        >
          {useCustomName ? 'Using Custom Name' : 'Use Custom Name Instead'}
        </Button>

        {useCustomName && (
          <Stack spacing={1.25} sx={{ mb: 1.5 }}>
            <TextField
              size="small"
              label="Custom Title"
              placeholder="Enter the folder/file title to save"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
            />
            <TextField
              size="small"
              label="Year (optional)"
              placeholder="Example: 2024"
              value={customYear}
              onChange={(e) => setCustomYear(e.target.value)}
            />
            <Alert severity="info">
              Custom naming skips IMDb requirements and stores technical metadata from the moved file (runtime, file type, quality, file size).
            </Alert>
          </Stack>
        )}

        {targetMediaType !== 'series' && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            Documentary and Live Performance use movie metadata search, but will be saved into their own Jellyfin folders.
          </Alert>
        )}

        {!isFolderMode && (
          <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
            <InputLabel id="file-category-label">File Role</InputLabel>
            <Select
              labelId="file-category-label"
              label="File Role"
              value={fileCategory}
              onChange={(e) => setFileCategory(e.target.value as 'main_feature' | 'special_feature' | 'unknown' | 'episode')}
            >
              <MenuItem value="main_feature">Main Feature</MenuItem>
              <MenuItem value="special_feature">Special Feature (Featurettes subfolder)</MenuItem>
              <MenuItem value="unknown">Unknown / Unclassified</MenuItem>
              <MenuItem value="episode">Episode (Season 00 subfolder)</MenuItem>
            </Select>
          </FormControl>
        )}

        {/* Search */}
        {!useCustomName && (
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <TextField
            fullWidth
            size="small"
            placeholder={`Search for a ${searchMediaType === 'movie' ? 'movie' : 'TV show'}…`}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Button
            variant="contained"
            onClick={handleSearch}
            disabled={searchLoading || !searchText.trim()}
            sx={{ minWidth: 90 }}
          >
            {searchLoading ? <CircularProgress size={18} color="inherit" /> : 'Search'}
          </Button>
        </Stack>
        )}

        {!useCustomName && searchError && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            {searchError}
          </Alert>
        )}

        {!useCustomName && selectedTarget && !hasValidImdb && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            The selected title does not include a valid IMDb ID. Reassignment requires an IMDb ID so folder and file names can be validated.
          </Alert>
        )}

        {/* Search results */}
        {!useCustomName && searchResults.length > 0 && (
          <Box sx={{ maxHeight: 260, overflowY: 'auto' }}>
            {searchResults.map((result) => (
              <Card
                key={`${result.imdbId ?? result.id}-${result.source}`}
                variant="outlined"
                sx={{
                  mb: 0.75,
                  borderColor:
                    selectedTarget?.id === result.id && selectedTarget?.source === result.source
                      ? 'primary.main'
                      : 'divider',
                  backgroundColor:
                    selectedTarget?.id === result.id && selectedTarget?.source === result.source
                      ? 'rgba(33, 150, 243, 0.1)'
                      : 'transparent',
                }}
              >
                <CardActionArea onClick={() => setSelectedTarget(result)}>
                  <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {result.poster && result.poster !== 'N/A' ? (
                        <Box
                          component="img"
                          src={result.poster}
                          alt=""
                          sx={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
                        />
                      ) : (
                        <Box
                          sx={{
                            width: 32,
                            height: 48,
                            borderRadius: 0.5,
                            bgcolor: 'rgba(255,255,255,0.06)',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {result.type === 'series' ? (
                            <TvIcon fontSize="small" sx={{ opacity: 0.4 }} />
                          ) : (
                            targetMediaType === 'documentary' ? <TheatersIcon fontSize="small" sx={{ opacity: 0.4 }} /> :
                            targetMediaType === 'live_performance' ? <LibraryMusicIcon fontSize="small" sx={{ opacity: 0.4 }} /> :
                            <MovieIcon fontSize="small" sx={{ opacity: 0.4 }} />
                          )}
                        </Box>
                      )}
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {result.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {result.year || '—'} · {result.imdbId || 'no IMDB ID'} ·{' '}
                          <em>{result.source}</em>
                        </Typography>
                      </Box>
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        <Button onClick={handleClose} disabled={saving}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={
            saving ||
            (result?.errors.length === 0) ||
            (useCustomName ? !canSubmitCustom : (!selectedTarget || !hasValidImdb))
          }
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {saving ? 'Working…' : isFolderMode ? 'Rename Folder & Rewrite NFO' : 'Move File'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

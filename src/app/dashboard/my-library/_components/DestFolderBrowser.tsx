'use client';

import { useEffect, useReducer, useCallback, useState, useRef } from 'react';
import Link from 'next/link';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import DiskReassignDialog, { DiskReassignMode } from './DiskReassignDialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

interface FolderState {
  loaded: boolean;
  loading: boolean;
  children: FsEntry[];
  error: string | null;
}

interface DestFolderInfo {
  destBase: string;
  exists: boolean;
  writable: boolean;
  categoryFolders: Record<string, string>; // mediaType → folder name
}

type BrowserState = {
  info: DestFolderInfo | null;
  infoLoading: boolean;
  infoError: string | null;
  expanded: Set<string>;
  folders: Record<string, FolderState>;
  version: number;
};

type Action =
  | { type: 'SET_INFO'; payload: DestFolderInfo }
  | { type: 'SET_INFO_ERROR'; payload: string }
  | { type: 'TOGGLE_FOLDER'; path: string }
  | { type: 'FOLDER_LOADING'; path: string }
  | { type: 'FOLDER_LOADED'; path: string; children: FsEntry[] }
  | { type: 'FOLDER_ERROR'; path: string; error: string }
  | { type: 'RESET' };

function reducer(state: BrowserState, action: Action): BrowserState {
  switch (action.type) {
    case 'SET_INFO':
      return { ...state, infoLoading: false, info: action.payload };
    case 'SET_INFO_ERROR':
      return { ...state, infoLoading: false, infoError: action.payload };
    case 'TOGGLE_FOLDER': {
      const next = new Set(state.expanded);
      if (next.has(action.path)) {
        next.delete(action.path);
      } else {
        next.add(action.path);
      }
      return { ...state, expanded: next };
    }
    case 'FOLDER_LOADING':
      return {
        ...state,
        folders: {
          ...state.folders,
          [action.path]: { loaded: false, loading: true, children: [], error: null },
        },
      };
    case 'FOLDER_LOADED':
      return {
        ...state,
        folders: {
          ...state.folders,
          [action.path]: { loaded: true, loading: false, children: action.children, error: null },
        },
      };
    case 'FOLDER_ERROR':
      return {
        ...state,
        folders: {
          ...state.folders,
          [action.path]: { loaded: true, loading: false, children: [], error: action.error },
        },
      };
    case 'RESET':
      return {
        ...state,
        expanded: new Set<string>(),
        folders: {},
        version: state.version + 1,
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IMDB_FOLDER_RE = /\[imdbid-(tt\d+)\]/i;

function extractImdbId(name: string): string | null {
  const match = IMDB_FOLDER_RE.exec(name);
  return match ? match[1] : null;
}

/** Walk up the path segments to find the first one containing an imdbid tag. */
function resolveMediaIdFromPath(
  entryPath: string,
  destBase: string,
): { mediaId: string; mediaType: string } | null {
  // Relative path from destBase
  const rel = entryPath.startsWith(destBase)
    ? entryPath.slice(destBase.length).replace(/^\//, '')
    : entryPath;

  const segments = rel.split('/').filter(Boolean);

  // segments[0] is the category folder (Movies, TV Shows, …)
  // segments[1] is the title folder which carries [imdbid-ttXXXX]
  // segments[2+] are season folders / files inside

  let mediaType = 'movie';
  if (segments.length > 0) {
    const cat = segments[0].toLowerCase();
    if (cat.includes('tv') || cat.includes('show') || cat.includes('series')) mediaType = 'series';
    else if (cat.includes('documentary') || cat.includes('documentar')) mediaType = 'documentary';
    else if (cat.includes('live') || cat.includes('performance')) mediaType = 'live_performance';
  }

  // Find the first segment with an imdb tag (usually segments[1])
  for (const seg of segments) {
    const id = extractImdbId(seg);
    if (id) return { mediaId: id, mediaType };
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function isVideoFileName(name: string): boolean {
  return /\.(mp4|mkv|webm|mov|m4v|avi|ts|m2ts|wmv)$/i.test(name);
}

function getParentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '/';
  return normalized.slice(0, idx);
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function fetchDestFolderInfo(): Promise<DestFolderInfo> {
  const res = await fetch('/api/backend/api/files/dest-folder');
  if (!res.ok) throw new Error(`Failed to load destination folder info (${res.status})`);
  const json = await res.json();
  return json.data as DestFolderInfo;
}

async function fetchFolderChildren(path: string): Promise<FsEntry[]> {
  const res = await fetch('/api/backend/api/files/dest-folder/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `Failed to browse ${path} (${res.status})`);
  }
  const json = await res.json();
  return json.data as FsEntry[];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface EntryRowProps {
  entry: FsEntry;
  depth: number;
  destBase: string;
  expanded: Set<string>;
  folders: Record<string, FolderState>;
  onToggle: (path: string) => void;
  onDropToFolder: (sourcePath: string, destFolderPath: string) => void;
  onOpenReassign: (
    mode: DiskReassignMode,
    sourcePath: string,
    sourceLabel: string,
    currentMediaType?: string,
  ) => void;
  onRequestDelete: (entry: FsEntry) => void;
  onPreviewVideo: (entry: FsEntry) => void;
}

function EntryRow({
  entry,
  depth,
  destBase,
  expanded,
  folders,
  onToggle,
  onDropToFolder,
  onOpenReassign,
  onRequestDelete,
  onPreviewVideo,
}: EntryRowProps) {
  const isExpanded = expanded.has(entry.path);
  const folderState = folders[entry.path];
  const mediaInfo = resolveMediaIdFromPath(entry.path, destBase);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragEnterCount = useRef(0);

  const indent = depth * 24;

  if (entry.isDirectory) {
    const isLoading = folderState?.loading ?? false;
    const children = folderState?.children ?? [];
    const loadError = folderState?.error ?? null;

    return (
      <>
        <ListItem
          disablePadding
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', entry.path);
            e.dataTransfer.effectAllowed = 'move';
            e.stopPropagation();
          }}
          onDragEnd={() => {
            dragEnterCount.current = 0;
            setIsDragOver(false);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragEnterCount.current += 1;
            if (dragEnterCount.current === 1) setIsDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDragLeave={(e) => {
            e.stopPropagation();
            dragEnterCount.current -= 1;
            if (dragEnterCount.current === 0) setIsDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragEnterCount.current = 0;
            setIsDragOver(false);
            const sourcePath = e.dataTransfer.getData('text/plain');
            if (sourcePath && sourcePath !== entry.path) {
              onDropToFolder(sourcePath, entry.path);
            }
          }}
          sx={{ cursor: 'grab' }}
        >
          <ListItemButton
            onClick={() => onToggle(entry.path)}
            sx={{
              pl: `${16 + indent}px`,
              py: 0.5,
              ...(isDragOver && {
                backgroundColor: 'rgba(100, 180, 255, 0.18)',
                outline: '2px dashed rgba(100, 180, 255, 0.6)',
                outlineOffset: '-2px',
              }),
            }}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              {isLoading ? (
                <CircularProgress size={18} />
              ) : isExpanded ? (
                <FolderOpenIcon fontSize="small" sx={{ color: 'primary.main' }} />
              ) : (
                <FolderIcon fontSize="small" sx={{ color: 'primary.light', opacity: 0.85 }} />
              )}
            </ListItemIcon>
            <ListItemText
              primary={
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {entry.name}
                  </Typography>
                  {mediaInfo && (
                    <Chip
                      size="small"
                      label={mediaInfo.mediaType}
                      color="primary"
                      variant="outlined"
                      sx={{ height: 18, fontSize: '0.65rem' }}
                    />
                  )}
                </Stack>
              }
            />
            {mediaInfo && (
              <IconButton
                component={Link}
                href={`/dashboard/my-library/${mediaInfo.mediaType}/${encodeURIComponent(mediaInfo.mediaId)}`}
                size="small"
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                title={`Open ${mediaInfo.mediaId} in My Library`}
                sx={{ mr: 0.5, color: 'primary.main' }}
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            )}

            {depth >= 1 && (
              <IconButton
                size="small"
                title="Assign/Reassign folder metadata"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onOpenReassign(
                    'folder',
                    entry.path,
                    entry.name,
                    mediaInfo?.mediaType,
                  );
                }}
                sx={{ mr: 0.5, color: 'warning.main' }}
              >
                <SwapHorizIcon fontSize="small" />
              </IconButton>
            )}

            {depth >= 1 && (
              <IconButton
                size="small"
                title="Delete folder"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onRequestDelete(entry);
                }}
                sx={{ mr: 0.5, color: 'error.main' }}
              >
                <DeleteForeverIcon fontSize="small" />
              </IconButton>
            )}

            {isExpanded ? (
              <ExpandMoreIcon fontSize="small" sx={{ opacity: 0.6 }} />
            ) : (
              <ChevronRightIcon fontSize="small" sx={{ opacity: 0.6 }} />
            )}
          </ListItemButton>
        </ListItem>

        <Collapse in={isExpanded} unmountOnExit>
          {loadError && (
            <Alert severity="error" sx={{ ml: `${16 + indent + 32}px`, my: 0.5, py: 0.25 }}>
              {loadError}
            </Alert>
          )}
          <List disablePadding>
            {children.map((child) => (
              <EntryRow
                key={child.path}
                entry={child}
                depth={depth + 1}
                destBase={destBase}
                expanded={expanded}
                folders={folders}
                onToggle={onToggle}
                onDropToFolder={onDropToFolder}
                onOpenReassign={onOpenReassign}
                onRequestDelete={onRequestDelete}
                onPreviewVideo={onPreviewVideo}
              />
            ))}
          </List>
        </Collapse>
      </>
    );
  }

  // File entry
  return (
    <ListItem
      disablePadding
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', entry.path);
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
      }}
      sx={{ cursor: 'grab' }}
    >
      <ListItemButton
        component={mediaInfo ? Link : 'div'}
        href={mediaInfo ? `/dashboard/my-library/${mediaInfo.mediaType}/${encodeURIComponent(mediaInfo.mediaId)}` : undefined}
        sx={{ pl: `${16 + indent}px`, py: 0.4, opacity: 0.85 }}
      >
        <ListItemIcon sx={{ minWidth: 32 }}>
          <InsertDriveFileIcon fontSize="small" sx={{ opacity: 0.65 }} />
        </ListItemIcon>
        <ListItemText
          primary={
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
              {entry.name}
            </Typography>
          }
          secondary={entry.size > 0 ? formatBytes(entry.size) : undefined}
          secondaryTypographyProps={{ sx: { fontSize: '0.7rem' } }}
        />

        <IconButton
          size="small"
          title={isVideoFileName(entry.name) ? 'Preview video' : 'Preview available for video files only'}
          disabled={!isVideoFileName(entry.name)}
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (isVideoFileName(entry.name)) {
              onPreviewVideo(entry);
            }
          }}
          sx={{ mr: 0.5, color: 'info.main' }}
        >
          <PlayCircleOutlineIcon fontSize="small" />
        </IconButton>

        <IconButton
          size="small"
          title="Assign/Reassign file metadata"
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenReassign(
              'file',
              entry.path,
              entry.name,
              mediaInfo?.mediaType,
            );
          }}
          sx={{ mr: 0.5, color: 'warning.main' }}
        >
          <SwapHorizIcon fontSize="small" />
        </IconButton>

        <IconButton
          size="small"
          title="Delete file"
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            onRequestDelete(entry);
          }}
          sx={{ mr: 0.5, color: 'error.main' }}
        >
          <DeleteForeverIcon fontSize="small" />
        </IconButton>

        {mediaInfo && <OpenInNewIcon fontSize="small" sx={{ opacity: 0.5, mr: 0.5 }} />}
      </ListItemButton>
    </ListItem>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DestFolderBrowser() {
  const [state, dispatch] = useReducer(reducer, {
    info: null,
    infoLoading: true,
    infoError: null,
    expanded: new Set<string>(),
    folders: {},
    version: 0,
  });

  const [moveError, setMoveError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [diskReassignOpen, setDiskReassignOpen] = useState(false);
  const [diskReassignMode, setDiskReassignMode] = useState<DiskReassignMode>('file');
  const [diskReassignSourcePath, setDiskReassignSourcePath] = useState('');
  const [diskReassignSourceLabel, setDiskReassignSourceLabel] = useState('');
  const [diskReassignMediaType, setDiskReassignMediaType] = useState<string | undefined>(undefined);
  const [diskReassignMsg, setDiskReassignMsg] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FsEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewEntry, setPreviewEntry] = useState<FsEntry | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Load top-level dest folder info
  useEffect(() => {
    fetchDestFolderInfo()
      .then((info) => dispatch({ type: 'SET_INFO', payload: info }))
      .catch((err) => dispatch({ type: 'SET_INFO_ERROR', payload: String(err.message ?? err) }));
  }, []);

  // Load root children once destBase is known, or after a reset (version changes)
  useEffect(() => {
    if (!state.info?.destBase || !state.info.exists) return;
    const path = state.info.destBase;
    if (state.folders[path]) return; // already loaded or loading
    dispatch({ type: 'FOLDER_LOADING', path });
    fetchFolderChildren(path)
      .then((children) => dispatch({ type: 'FOLDER_LOADED', path, children }))
      .catch((err) => dispatch({ type: 'FOLDER_ERROR', path, error: String(err.message ?? err) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.info, state.version]);

  const handleToggle = useCallback(
    (path: string) => {
      dispatch({ type: 'TOGGLE_FOLDER', path });
      // Lazy-load children on first expand
      if (!state.expanded.has(path) && !state.folders[path]) {
        dispatch({ type: 'FOLDER_LOADING', path });
        fetchFolderChildren(path)
          .then((children) => dispatch({ type: 'FOLDER_LOADED', path, children }))
          .catch((err) => dispatch({ type: 'FOLDER_ERROR', path, error: String(err.message ?? err) }));
      }
    },
    [state.expanded, state.folders],
  );

  const handleDropToFolder = useCallback(async (sourcePath: string, destFolderPath: string) => {
    if (sourcePath === destFolderPath) return;
    // Prevent dropping a parent folder into its own subtree
    if (destFolderPath.startsWith(sourcePath + '/')) {
      setMoveError('Cannot move a folder into one of its own subfolders.');
      return;
    }
    const basename = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || '';
    const destinationPath = `${destFolderPath}/${basename}`;
    setIsMoving(true);
    setMoveError(null);
    try {
      const res = await fetch('/api/backend/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath, destinationPath, mergeContents: false }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = (err as { detail?: { message?: string } | string }).detail;
        const msg = typeof detail === 'object' ? detail?.message : detail;
        throw new Error(msg || `Move failed (${res.status})`);
      }
      dispatch({ type: 'RESET' });
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Move operation failed.');
    } finally {
      setIsMoving(false);
    }
  }, []);

  const handleOpenReassign = useCallback(
    (
      mode: DiskReassignMode,
      sourcePath: string,
      sourceLabel: string,
      currentMediaType?: string,
    ) => {
      setDiskReassignMode(mode);
      setDiskReassignSourcePath(sourcePath);
      setDiskReassignSourceLabel(sourceLabel);
      setDiskReassignMediaType(currentMediaType);
      setDiskReassignOpen(true);
    },
    [],
  );

  const refreshFolderPath = useCallback(async (path: string) => {
    if (!path) return;
    dispatch({ type: 'FOLDER_LOADING', path });
    try {
      const children = await fetchFolderChildren(path);
      dispatch({ type: 'FOLDER_LOADED', path, children });
    } catch (err) {
      dispatch({ type: 'FOLDER_ERROR', path, error: String((err as Error)?.message ?? err) });
    }
  }, []);

  const refreshAfterReassign = useCallback(
    async (mode: DiskReassignMode, oldPath: string, newPath: string) => {
      const paths = new Set<string>();

      if (mode === 'folder') {
        paths.add(getParentPath(oldPath));
        paths.add(getParentPath(newPath));
      } else {
        paths.add(getParentPath(oldPath));
        paths.add(getParentPath(newPath));
      }

      await Promise.all(Array.from(paths).map((path) => refreshFolderPath(path)));
    },
    [refreshFolderPath],
  );

  const handlePreviewVideo = useCallback((entry: FsEntry) => {
    setPreviewEntry(entry);
    setPreviewOpen(true);
  }, []);

  const handleRequestDelete = useCallback((entry: FsEntry) => {
    setDeleteTarget(entry);
    setDeleteError(null);
    setDeleteConfirmOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch('/api/backend/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: deleteTarget.path, useTrash: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = (err as { detail?: { message?: string } | string }).detail;
        const msg = typeof detail === 'object' ? detail?.message : detail;
        throw new Error(msg || `Delete failed (${res.status})`);
      }

      if (previewEntry?.path === deleteTarget.path) {
        const player = videoRef.current;
        if (player) {
          player.pause();
          player.removeAttribute('src');
          player.load();
        }
        setPreviewOpen(false);
        setPreviewEntry(null);
      }

      const deletedEntry = deleteTarget;
      setDeleteConfirmOpen(false);
      setDeleteTarget(null);
      setDiskReassignMsg(`${deletedEntry.isDirectory ? 'Folder' : 'File'} deleted: ${deletedEntry.name}`);
      await refreshFolderPath(getParentPath(deletedEntry.path));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, previewEntry?.path, refreshFolderPath]);

  const handleClosePreview = useCallback(() => {
    const player = videoRef.current;
    if (player) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    setPreviewOpen(false);
    setPreviewEntry(null);
  }, []);

  useEffect(() => {
    if (!previewOpen) {
      return undefined;
    }

    const handlePreviewKeydown = (event: KeyboardEvent) => {
      const player = videoRef.current;
      if (!player) {
        if (event.key === 'Escape') {
          event.preventDefault();
          handleClosePreview();
        }
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) {
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        if (player.paused) {
          void player.play().catch(() => undefined);
        } else {
          player.pause();
        }
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        player.currentTime = Math.max(0, player.currentTime - 5);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        const duration = Number.isFinite(player.duration) ? player.duration : player.currentTime + 5;
        player.currentTime = Math.min(duration, player.currentTime + 5);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        handleClosePreview();
      }
    };

    window.addEventListener('keydown', handlePreviewKeydown);
    return () => window.removeEventListener('keydown', handlePreviewKeydown);
  }, [handleClosePreview, previewOpen]);

  if (state.infoLoading) {
    return (
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading destination folder…</Typography>
      </Stack>
    );
  }

  if (state.infoError) {
    return <Alert severity="error">{state.infoError}</Alert>;
  }

  if (!state.info) return null;

  const { destBase, exists, writable } = state.info;
  const rootState = state.folders[destBase];

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', opacity: 0.7, fontSize: '0.8rem' }}>
          {destBase}
        </Typography>
        <Chip
          size="small"
          label={exists ? 'Accessible' : 'Not found'}
          color={exists ? 'success' : 'error'}
          variant="outlined"
        />
        {exists && (
          <Chip
            size="small"
            label={writable ? 'Writable' : 'Read-only'}
            color={writable ? 'info' : 'warning'}
            variant="outlined"
          />
        )}
      </Stack>

      {moveError && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setMoveError(null)}>
          {moveError}
        </Alert>
      )}

      {diskReassignMsg && (
        <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setDiskReassignMsg(null)}>
          {diskReassignMsg}
        </Alert>
      )}

      {isMoving && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <CircularProgress size={16} />
          <Typography variant="body2">Moving…</Typography>
        </Stack>
      )}

      {!exists && (
        <Alert severity="warning">
          The destination folder <code>{destBase}</code> is not accessible from the backend. Check that the path is
          mounted and the <code>MEDIA_DEST_BASE</code> environment variable is correct.
        </Alert>
      )}

      {exists && (
        <>
          {rootState?.loading && (
            <Stack direction="row" alignItems="center" spacing={1} sx={{ py: 2 }}>
              <CircularProgress size={18} />
              <Typography variant="body2">Loading…</Typography>
            </Stack>
          )}
          {rootState?.error && <Alert severity="error">{rootState.error}</Alert>}
          {rootState?.loaded && rootState.children.length === 0 && (
            <Alert severity="info">The destination folder is empty.</Alert>
          )}
          {rootState?.loaded && rootState.children.length > 0 && (
            <List disablePadding sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              {rootState.children.map((entry) => (
                <EntryRow
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  destBase={destBase}
                  expanded={state.expanded}
                  folders={state.folders}
                  onToggle={handleToggle}
                  onDropToFolder={handleDropToFolder}
                  onOpenReassign={handleOpenReassign}
                  onRequestDelete={handleRequestDelete}
                  onPreviewVideo={handlePreviewVideo}
                />
              ))}
            </List>
          )}
        </>
      )}

      <Dialog
        open={previewOpen}
        onClose={handleClosePreview}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle sx={{ fontFamily: 'monospace', fontSize: '0.95rem' }}>
          {previewEntry?.name || 'Video preview'}
        </DialogTitle>
        <DialogContent sx={{ pb: 2 }}>
          {previewEntry && (
            <Box sx={{ width: '100%', bgcolor: '#000', borderRadius: 1, overflow: 'hidden' }}>
              <video
                ref={videoRef}
                controls
                autoPlay
                preload="metadata"
                src={`/api/backend/api/files/dest-folder/stream?path=${encodeURIComponent(previewEntry.path)}`}
                style={{ width: '100%', maxHeight: '70vh', display: 'block' }}
              />
            </Box>
          )}
          <Typography variant="caption" sx={{ display: 'block', mt: 1.5, opacity: 0.72 }}>
            Shortcuts: Space play/pause, Left/Right arrows seek 5 seconds, Escape close.
          </Typography>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteConfirmOpen}
        onClose={() => !deleting && setDeleteConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{deleteTarget?.isDirectory ? 'Delete folder?' : 'Delete file?'}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
            {deleteTarget?.path}
          </Typography>
          <Typography sx={{ mt: 1.5 }}>
            This will move the {deleteTarget?.isDirectory ? 'folder' : 'file'} to trash when available. If trash is disabled on the backend, it will be deleted permanently.
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
            onClick={() => void handleConfirmDelete()}
            disabled={deleting || !deleteTarget}
            startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteForeverIcon />}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {diskReassignOpen && (
        <DiskReassignDialog
          open={diskReassignOpen}
          mode={diskReassignMode}
          sourcePath={diskReassignSourcePath}
          sourceLabel={diskReassignSourceLabel}
          currentMediaType={diskReassignMediaType}
          onClose={() => setDiskReassignOpen(false)}
          onReassigned={(newPath) => {
            setDiskReassignOpen(false);
            setDiskReassignMsg(
              diskReassignMode === 'folder'
                ? `Folder reassigned. New path: ${newPath}`
                : `File reassigned. New path: ${newPath}`
            );
            void refreshAfterReassign(diskReassignMode, diskReassignSourcePath, newPath);
          }}
        />
      )}
    </Box>
  );
}

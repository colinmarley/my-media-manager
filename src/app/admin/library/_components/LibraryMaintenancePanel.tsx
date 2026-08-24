"use client";

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  CreateNewFolder as CreateNewFolderIcon,
  DriveFileMove as MoveIcon,
  Edit as RenameIcon,
  Folder as FolderIcon,
  Description as FileIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import type { LibraryPath } from '../../../../types/library/LibraryTypes';
import FolderBrowser from './FolderBrowser';

const FILE_API_BASE = '/api/backend/api/files';

interface DirectoryItem {
  path: string;
  name: string;
  is_directory?: boolean;
  is_file?: boolean;
  size?: number;
}

interface ApiSuccess<T> {
  success: boolean;
  data: T;
}

interface LibraryMaintenancePanelProps {
  libraryPaths: LibraryPath[];
  disabled?: boolean;
}

const LibraryMaintenancePanel: React.FC<LibraryMaintenancePanelProps> = ({
  libraryPaths,
  disabled = false,
}) => {
  const [inspectorPath, setInspectorPath] = useState('');
  const [inspectorDraftPath, setInspectorDraftPath] = useState('');
  const [items, setItems] = useState<DirectoryItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedIsDirectory, setSelectedIsDirectory] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [folderBrowserMode, setFolderBrowserMode] = useState<'inspector' | 'destination' | 'createParent'>('inspector');

  const [renameValue, setRenameValue] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [newFolderParentPath, setNewFolderParentPath] = useState('');
  const [newFolderName, setNewFolderName] = useState('');

  const selectedItem = useMemo(
    () => items.find((item) => item.path === selectedPath) ?? null,
    [items, selectedPath],
  );

  const apiCall = async <T,>(path: string, payload: Record<string, unknown>): Promise<T> => {
    const response = await fetch(`${FILE_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Request failed with ${response.status}`);
    }

    const data = (await response.json()) as ApiSuccess<T>;
    if (!data.success) {
      throw new Error('Operation failed');
    }

    return data.data;
  };

  const loadDirectory = async (path: string) => {
    if (!path.trim()) {
      setError('Enter a directory path to inspect.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await apiCall<{ items: DirectoryItem[] }>('/folders/list', { path });
      setItems(data.items || []);
      setInspectorPath(path);
      setInspectorDraftPath(path);
      setSelectedPath(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  const resetOperationMessages = () => {
    setError(null);
    setSuccessMessage(null);
  };

  const handleRenameOpen = () => {
    if (!selectedItem) return;
    setRenameValue(selectedItem.name);
    setShowRenameDialog(true);
    resetOperationMessages();
  };

  const handleRename = async () => {
    if (!selectedPath || !renameValue.trim()) return;

    try {
      const endpoint = selectedIsDirectory ? '/folders/rename' : '/rename';
      await apiCall<Record<string, unknown>>(endpoint, {
        currentPath: selectedPath,
        newName: renameValue.trim(),
      });

      setShowRenameDialog(false);
      setSuccessMessage('Rename completed successfully.');
      await loadDirectory(inspectorPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
    }
  };

  const handleMoveOpen = () => {
    if (!selectedItem) return;
    setDestinationPath('');
    setShowMoveDialog(true);
    resetOperationMessages();
  };

  const handleMove = async () => {
    if (!selectedPath || !destinationPath.trim() || !selectedItem) return;

    const separator = selectedPath.includes('\\') ? '\\' : '/';
    const destination = destinationPath.endsWith(separator)
      ? `${destinationPath}${selectedItem.name}`
      : `${destinationPath}${separator}${selectedItem.name}`;

    try {
      const endpoint = selectedIsDirectory ? '/folders/move' : '/move';
      await apiCall<Record<string, unknown>>(endpoint, {
        sourcePath: selectedPath,
        destinationPath: destination,
        mergeContents: true,
      });

      setShowMoveDialog(false);
      setSuccessMessage('Move completed successfully.');
      await loadDirectory(inspectorPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move failed');
    }
  };

  const handleCreateFolderOpen = () => {
    setNewFolderParentPath(inspectorPath || inspectorDraftPath || '');
    setNewFolderName('');
    setShowCreateDialog(true);
    resetOperationMessages();
  };

  const handleCreateFolder = async () => {
    if (!newFolderParentPath.trim() || !newFolderName.trim()) return;

    try {
      await apiCall<Record<string, unknown>>('/folders/create', {
        parentPath: newFolderParentPath.trim(),
        folderName: newFolderName.trim(),
      });

      setShowCreateDialog(false);
      setSuccessMessage('Folder created successfully.');

      if (inspectorPath) {
        await loadDirectory(inspectorPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create folder failed');
    }
  };

  return (
    <Stack spacing={3}>
      {!disabled && (
        <Alert severity="info">
          Use this panel to inspect a path and run maintenance operations directly from Admin Library.
        </Alert>
      )}

      {disabled ? (
        <Alert severity="warning">Please log in to use maintenance operations.</Alert>
      ) : (
        <>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          {successMessage && <Alert severity="success" onClose={() => setSuccessMessage(null)}>{successMessage}</Alert>}

          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">Path Inspector</Typography>

                <FormControl fullWidth>
                  <InputLabel>Library Root Shortcut</InputLabel>
                  <Select
                    label="Library Root Shortcut"
                    value=""
                    onChange={(event) => {
                      const nextPath = String(event.target.value || '');
                      if (!nextPath) return;
                      setInspectorDraftPath(nextPath);
                      setInspectorPath(nextPath);
                      setSelectedPath(null);
                      void loadDirectory(nextPath);
                    }}
                  >
                    {libraryPaths.map((path) => (
                      <MenuItem key={path.id} value={path.rootPath}>
                        {path.name} - {path.rootPath}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                  <TextField
                    fullWidth
                    label="Directory Path"
                    placeholder="/mnt/media/library"
                    value={inspectorDraftPath}
                    onChange={(event) => setInspectorDraftPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void loadDirectory(inspectorDraftPath);
                      }
                    }}
                  />
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setFolderBrowserMode('inspector');
                      setShowFolderBrowser(true);
                    }}
                  >
                    Browse
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<SearchIcon />}
                    onClick={() => void loadDirectory(inspectorDraftPath)}
                    disabled={isLoading}
                  >
                    Inspect
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between">
                  <Typography variant="h6">Directory Items</Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      startIcon={<RefreshIcon />}
                      onClick={() => void loadDirectory(inspectorPath || inspectorDraftPath)}
                      disabled={!inspectorPath && !inspectorDraftPath}
                    >
                      Refresh
                    </Button>
                    <Button
                      size="small"
                      startIcon={<CreateNewFolderIcon />}
                      onClick={handleCreateFolderOpen}
                    >
                      Create Folder
                    </Button>
                  </Stack>
                </Stack>

                <Typography variant="body2" color="text.secondary">
                  {inspectorPath ? `Current path: ${inspectorPath}` : 'No path inspected yet.'}
                </Typography>

                <Divider />

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                  <Button
                    variant="outlined"
                    startIcon={<RenameIcon />}
                    onClick={handleRenameOpen}
                    disabled={!selectedItem}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<MoveIcon />}
                    onClick={handleMoveOpen}
                    disabled={!selectedItem}
                  >
                    Move
                  </Button>
                  {selectedItem && (
                    <Chip
                      color="primary"
                      label={`${selectedIsDirectory ? 'Folder' : 'File'} selected: ${selectedItem.name}`}
                    />
                  )}
                </Stack>

                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 420, overflowY: 'auto' }}>
                  {items.length === 0 ? (
                    <Box sx={{ py: 6, px: 2 }}>
                      <Typography color="text.secondary" align="center">
                        {isLoading ? 'Loading directory items...' : 'No items found. Inspect a valid path to begin.'}
                      </Typography>
                    </Box>
                  ) : (
                    <List dense disablePadding>
                      {items.map((item) => {
                        const isSelected = selectedPath === item.path;
                        const isDirectory = Boolean(item.is_directory && !item.is_file);

                        return (
                          <ListItem key={item.path} disablePadding>
                            <ListItemButton
                              selected={isSelected}
                              onClick={() => {
                                setSelectedPath(item.path);
                                setSelectedIsDirectory(isDirectory);
                                setSuccessMessage(null);
                                setError(null);
                              }}
                            >
                              <ListItemText
                                primary={
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    {isDirectory ? <FolderIcon color="primary" /> : <FileIcon color="action" />}
                                    <Typography>{item.name}</Typography>
                                    <Chip size="small" variant="outlined" label={isDirectory ? 'folder' : 'file'} />
                                  </Stack>
                                }
                                secondary={
                                  <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                    {item.path}
                                  </Typography>
                                }
                              />
                            </ListItemButton>
                          </ListItem>
                        );
                      })}
                    </List>
                  )}
                </Box>
              </Stack>
            </CardContent>
          </Card>

          <Dialog open={showRenameDialog} onClose={() => setShowRenameDialog(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Rename {selectedIsDirectory ? 'Folder' : 'File'}</DialogTitle>
            <DialogContent>
              <TextField
                autoFocus
                margin="dense"
                fullWidth
                label="New Name"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setShowRenameDialog(false)}>Cancel</Button>
              <Button variant="contained" onClick={() => void handleRename()} disabled={!renameValue.trim()}>
                Rename
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog open={showMoveDialog} onClose={() => setShowMoveDialog(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Move {selectedIsDirectory ? 'Folder' : 'File'}</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Destination path should be a folder. The item name is appended automatically.
              </Typography>
              <Stack spacing={1.5}>
                <TextField
                  fullWidth
                  label="Destination Folder Path"
                  value={destinationPath}
                  onChange={(event) => setDestinationPath(event.target.value)}
                />
                <Button
                  variant="outlined"
                  onClick={() => {
                    setFolderBrowserMode('destination');
                    setShowFolderBrowser(true);
                  }}
                >
                  Browse Destination
                </Button>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setShowMoveDialog(false)}>Cancel</Button>
              <Button variant="contained" onClick={() => void handleMove()} disabled={!destinationPath.trim()}>
                Move
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogContent>
              <Stack spacing={1.5} sx={{ mt: 0.5 }}>
                <TextField
                  fullWidth
                  label="Parent Path"
                  value={newFolderParentPath}
                  onChange={(event) => setNewFolderParentPath(event.target.value)}
                />
                <Button
                  variant="outlined"
                  onClick={() => {
                    setFolderBrowserMode('createParent');
                    setShowFolderBrowser(true);
                  }}
                >
                  Browse Parent Path
                </Button>
                <TextField
                  fullWidth
                  label="New Folder Name"
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setShowCreateDialog(false)}>Cancel</Button>
              <Button
                variant="contained"
                onClick={() => void handleCreateFolder()}
                disabled={!newFolderParentPath.trim() || !newFolderName.trim()}
              >
                Create
              </Button>
            </DialogActions>
          </Dialog>

          <FolderBrowser
            open={showFolderBrowser}
            onClose={() => setShowFolderBrowser(false)}
            onSelect={(path) => {
              if (folderBrowserMode === 'inspector') {
                setInspectorDraftPath(path);
                setInspectorPath(path);
                void loadDirectory(path);
              } else if (folderBrowserMode === 'destination') {
                setDestinationPath(path);
              } else {
                setNewFolderParentPath(path);
              }
              setShowFolderBrowser(false);
            }}
            initialPath={
              folderBrowserMode === 'destination'
                ? destinationPath
                : folderBrowserMode === 'createParent'
                  ? newFolderParentPath
                  : inspectorDraftPath
            }
          />
        </>
      )}
    </Stack>
  );
};

export default LibraryMaintenancePanel;
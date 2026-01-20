'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tooltip,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  Stack,
  CircularProgress
} from '@mui/material';
import {
  Edit,
  DriveFileMove,
  Check,
  Close,
  ArrowBack,
  FolderOpen,
  CreateNewFolder,
  Save,
  Undo
} from '@mui/icons-material';
import { ScannedFile } from '../../../../service/library/LibraryBrowserService';
import axios from 'axios';

interface PendingChange {
  fileId: string;
  type: 'rename' | 'move' | 'both';
  newName?: string;
  newFolderPath?: string;
}

interface FolderOption {
  id: string;
  path: string;
  name: string;
  isNew?: boolean;
}

interface MediaAssignmentProps {
  files: ScannedFile[];
  scanId?: string;
  libraryPath?: string;
  onBack?: () => void;
}

const MediaAssignment: React.FC<MediaAssignmentProps> = ({ files, scanId, libraryPath, onBack }) => {
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Dialog states
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; file: ScannedFile | null }>({
    open: false,
    file: null
  });
  const [newNameInput, setNewNameInput] = useState('');
  
  const [newFolderDialog, setNewFolderDialog] = useState(false);
  const [newFolderParent, setNewFolderParent] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const API_BASE_URL = process.env.NODE_ENV === 'production'
    ? 'https://your-api-domain.com/api'
    : 'http://localhost:8082/api';

  // Load available folders from scanned directories
  useEffect(() => {
    loadFolders();
  }, [scanId, libraryPath]);

  const loadFolders = async () => {
    try {
      setLoading(true);
      
      // Fetch all scanned directories from backend
      const requestBody: any = {
        limit: 1000,  // Get all directories
        offset: 0
      };
      
      // Only include scanId and libraryPath if they're provided
      if (scanId) {
        requestBody.scanId = scanId;
      }
      if (libraryPath) {
        requestBody.libraryPath = libraryPath;
      }
      
      const response = await axios.post(`${API_BASE_URL}/library/scanned-directories`, requestBody);

      if (response.data.success && response.data.data.directories) {
        const directories = response.data.data.directories;
        
        if (directories.length === 0) {
          // No directories found in database, extract from files as fallback
          extractFoldersFromFiles();
        } else {
          const folderOptions: FolderOption[] = directories.map((dir: any) => {
            const pathSeparator = dir.path.includes('\\') ? '\\' : '/';
            return {
              id: dir.id,
              path: dir.path,
              name: dir.name || dir.path.split(pathSeparator).pop() || dir.path
            };
          });

          // Add parent folders to the list
          const foldersWithParents = addParentFolders(folderOptions);
          setFolders(foldersWithParents);
        }
      } else {
        // No directories found, extract from files as fallback
        extractFoldersFromFiles();
      }
    } catch (err: any) {
      console.error('Error loading folders:', err);
      console.error('Error details:', err.response?.data);
      
      // Fallback: Extract folders from file paths
      extractFoldersFromFiles();
    } finally {
      setLoading(false);
    }
  };

  const addParentFolders = (folders: FolderOption[]): FolderOption[] => {
    const allPaths = new Set<string>();
    
    // Add all existing folder paths
    folders.forEach(folder => allPaths.add(folder.path));
    
    // Extract and add all parent paths
    folders.forEach(folder => {
      const pathSeparator = folder.path.includes('\\') ? '\\' : '/';
      const parts = folder.path.split(pathSeparator).filter(Boolean);
      
      // Build parent paths incrementally
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath += (currentPath ? pathSeparator : '') + parts[i];
        if (currentPath) {
          allPaths.add(currentPath);
        }
      }
    });
    
    // Convert all paths to FolderOption objects
    return Array.from(allPaths).map(path => {
      const pathSeparator = path.includes('\\') ? '\\' : '/';
      const existing = folders.find(f => f.path === path);
      
      return existing || {
        id: path,
        path: path,
        name: path.split(pathSeparator).pop() || path
      };
    }).sort((a, b) => a.path.localeCompare(b.path));
  };

  const extractFoldersFromFiles = () => {
    try {
      // Extract unique folder paths from files as fallback
      const uniqueFolders = new Set<string>();
      files.forEach(file => {
        const pathSeparator = file.path.includes('\\') ? '\\' : '/';
        const lastSepIndex = file.path.lastIndexOf(pathSeparator);
        const folderPath = lastSepIndex !== -1 ? file.path.substring(0, lastSepIndex) : '';
        if (folderPath) {
          uniqueFolders.add(folderPath);
        }
      });

      const folderOptions: FolderOption[] = Array.from(uniqueFolders).map(path => {
        const pathSeparator = path.includes('\\') ? '\\' : '/';
        return {
          id: path,
          path: path,
          name: path.split(pathSeparator).pop() || path
        };
      });

      // Add parent folders to the list
      const foldersWithParents = addParentFolders(folderOptions);
      setFolders(foldersWithParents);
      
      if (foldersWithParents.length === 0) {
        setError('No folders found. Please ensure files have been scanned.');
      }
    } catch (err) {
      console.error('Error extracting folders from files:', err);
      setError('Failed to load available folders');
    }
  };

  const handleFolderChange = (fileId: string, newFolderPath: string) => {
    setPendingChanges(prev => {
      const newChanges = new Map(prev);
      const existing = newChanges.get(fileId) || { fileId, type: 'move' };
      
      newChanges.set(fileId, {
        ...existing,
        newFolderPath,
        type: existing.newName ? 'both' : 'move'
      });
      
      return newChanges;
    });
  };

  const handleRenameClick = (file: ScannedFile) => {
    setRenameDialog({ open: true, file });
    setNewNameInput(file.name.replace(/\.[^/.]+$/, '')); // Remove extension
  };

  const handleRenameConfirm = () => {
    if (!renameDialog.file || !newNameInput.trim()) return;
    
    const fileId = renameDialog.file.id;
    const extension = renameDialog.file.extension;
    const newName = `${newNameInput.trim()}${extension}`;

    setPendingChanges(prev => {
      const newChanges = new Map(prev);
      const existing = newChanges.get(fileId) || { fileId, type: 'rename' };
      
      newChanges.set(fileId, {
        ...existing,
        newName,
        type: existing.newFolderPath ? 'both' : 'rename'
      });
      
      return newChanges;
    });

    setRenameDialog({ open: false, file: null });
    setNewNameInput('');
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !newFolderParent) {
      setError('Please provide folder name and parent path');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/files/folders/create`, {
        parentPath: newFolderParent,
        folderName: newFolderName.trim()
      });

      if (response.data.success) {
        const newFolderPath = response.data.data.folderPath;
        
        // Add new folder to the list
        setFolders(prev => [...prev, {
          id: newFolderPath,
          path: newFolderPath,
          name: newFolderName.trim(),
          isNew: true
        }]);

        setSuccess(`Folder "${newFolderName}" created successfully`);
        setNewFolderDialog(false);
        setNewFolderName('');
        setNewFolderParent('');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail?.message || 'Failed to create folder');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveChange = (fileId: string) => {
    setPendingChanges(prev => {
      const newChanges = new Map(prev);
      newChanges.delete(fileId);
      return newChanges;
    });
  };

  const handleApplyChanges = async () => {
    if (pendingChanges.size === 0) {
      setError('No pending changes to apply');
      return;
    }

    setLoading(true);
    setError(null);
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const [fileId, change] of pendingChanges.entries()) {
        const file = files.find(f => f.id === fileId);
        if (!file) continue;

        try {
          if (change.type === 'rename' && change.newName) {
            // Rename only
            await axios.post(`${API_BASE_URL}/file-operations/rename`, {
              currentPath: file.path,
              newName: change.newName
            });
            successCount++;
          } else if (change.type === 'move' && change.newFolderPath) {
            // Move only
            const newPath = `${change.newFolderPath}/${file.name}`;
            await axios.post(`${API_BASE_URL}/file-operations/move`, {
              sourcePath: file.path,
              destinationPath: newPath,
              mergeContents: false
            });
            successCount++;
          } else if (change.type === 'both' && change.newName && change.newFolderPath) {
            // Rename then move
            const renamed = await axios.post(`${API_BASE_URL}/file-operations/rename`, {
              currentPath: file.path,
              newName: change.newName
            });
            
            const renamedPath = renamed.data.data.newPath;
            const finalPath = `${change.newFolderPath}/${change.newName}`;
            
            await axios.post(`${API_BASE_URL}/file-operations/move`, {
              sourcePath: renamedPath,
              destinationPath: finalPath,
              mergeContents: false
            });
            successCount++;
          }
        } catch (err) {
          console.error(`Error processing ${file.name}:`, err);
          errorCount++;
        }
      }

      if (successCount > 0) {
        setSuccess(`Successfully applied ${successCount} change(s)`);
        setPendingChanges(new Map());
        
        // Refresh the view after a delay
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
      
      if (errorCount > 0) {
        setError(`${errorCount} operation(s) failed`);
      }
    } catch (err: any) {
      setError('Failed to apply changes');
    } finally {
      setLoading(false);
    }
  };

  const handleClearAllChanges = () => {
    setPendingChanges(new Map());
  };

  const getFileStatus = (fileId: string): 'pending' | 'none' => {
    return pendingChanges.has(fileId) ? 'pending' : 'none';
  };

  const getChangeDescription = (fileId: string): string => {
    const change = pendingChanges.get(fileId);
    if (!change) return '';

    const parts: string[] = [];
    if (change.newName) {
      parts.push(`Rename → ${change.newName}`);
    }
    if (change.newFolderPath) {
      const folderName = change.newFolderPath.split('/').pop() || change.newFolderPath;
      parts.push(`Move → ${folderName}`);
    }
    return parts.join(' & ');
  };

  const getCurrentFolderPath = (file: ScannedFile): string => {
    // Handle both Windows (\) and Unix (/) path separators
    const pathSeparator = file.path.includes('\\') ? '\\' : '/';
    const lastSepIndex = file.path.lastIndexOf(pathSeparator);
    return lastSepIndex !== -1 ? file.path.substring(0, lastSepIndex) : file.path;
  };

  const getFolderForFile = (file: ScannedFile): string => {
    const change = pendingChanges.get(file.id);
    return change?.newFolderPath || getCurrentFolderPath(file);
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {onBack && (
            <IconButton onClick={onBack}>
              <ArrowBack />
            </IconButton>
          )}
          <Typography variant="h4">
            File Management
          </Typography>
          <Chip 
            label={`${files.length} file${files.length !== 1 ? 's' : ''}`} 
            color="primary" 
            variant="outlined"
          />
          {pendingChanges.size > 0 && (
            <Chip 
              label={`${pendingChanges.size} pending change${pendingChanges.size !== 1 ? 's' : ''}`} 
              color="warning" 
            />
          )}
        </Box>
        
        <Stack direction="row" spacing={1}>
          <Button
            startIcon={<CreateNewFolder />}
            onClick={() => {
              setNewFolderDialog(true);
              // Set default parent folder to the library root path if available
              if (libraryPath) {
                setNewFolderParent(libraryPath);
              }
            }}
            variant="outlined"
          >
            New Folder
          </Button>
          {pendingChanges.size > 0 && (
            <>
              <Button
                startIcon={<Undo />}
                onClick={handleClearAllChanges}
                variant="outlined"
                color="error"
              >
                Clear All
              </Button>
              <Button
                startIcon={<Save />}
                onClick={handleApplyChanges}
                variant="contained"
                color="success"
                disabled={loading}
              >
                Apply Changes
              </Button>
            </>
          )}
        </Stack>
      </Box>

      {/* Alerts */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {/* File List Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell width="40%">File Name</TableCell>
              <TableCell width="30%">Current Path</TableCell>
              <TableCell width="20%">Folder Location</TableCell>
              <TableCell width="10%">Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {files.map((file) => {
              const status = getFileStatus(file.id);
              const changeDesc = getChangeDescription(file.id);
              const currentFolder = getFolderForFile(file);

              return (
                <TableRow 
                  key={file.id}
                  sx={{
                    bgcolor: status === 'pending' ? 'warning.50' : 'transparent',
                    '&:hover': { bgcolor: status === 'pending' ? 'warning.100' : 'action.hover' }
                  }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={status === 'pending' ? 600 : 400}>
                      {pendingChanges.get(file.id)?.newName || file.name}
                    </Typography>
                    {status === 'pending' && pendingChanges.get(file.id)?.newName && (
                      <Typography variant="caption" color="text.secondary">
                        Was: {file.name}
                      </Typography>
                    )}
                  </TableCell>
                  
                  <TableCell>
                    <Typography variant="body2" sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
                      {getCurrentFolderPath(file)}
                    </Typography>
                  </TableCell>
                  
                  <TableCell>
                    <FormControl size="small" fullWidth>
                      <Select
                        value={currentFolder}
                        onChange={(e) => handleFolderChange(file.id, e.target.value)}
                        displayEmpty
                        MenuProps={{
                          PaperProps: {
                            style: {
                              maxHeight: 400,
                            },
                          },
                        }}
                      >
                        {folders.map((folder) => (
                          <MenuItem key={folder.id} value={folder.path}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <FolderOpen fontSize="small" color={folder.isNew ? 'success' : 'inherit'} />
                              <Typography variant="body2">{folder.name}</Typography>
                            </Box>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </TableCell>
                  
                  <TableCell>
                    {status === 'pending' && (
                      <Chip 
                        label="Pending" 
                        size="small" 
                        color="warning"
                        icon={<Edit />}
                      />
                    )}
                  </TableCell>
                  
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title="Rename File">
                        <IconButton
                          size="small"
                          onClick={() => handleRenameClick(file)}
                          color={pendingChanges.get(file.id)?.newName ? 'warning' : 'default'}
                        >
                          <Edit fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      
                      {status === 'pending' && (
                        <Tooltip title="Undo Changes">
                          <IconButton
                            size="small"
                            onClick={() => handleRemoveChange(file.id)}
                            color="error"
                          >
                            <Close fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {files.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No files loaded
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Select files from Library Browser to manage them here
          </Typography>
        </Box>
      )}

      {/* Rename Dialog */}
      <Dialog 
        open={renameDialog.open} 
        onClose={() => setRenameDialog({ open: false, file: null })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Rename File</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            {renameDialog.file && (
              <>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Current name: {renameDialog.file.name}
                </Typography>
                <TextField
                  autoFocus
                  label="New File Name"
                  value={newNameInput}
                  onChange={(e) => setNewNameInput(e.target.value)}
                  fullWidth
                  margin="normal"
                  helperText={`Extension ${renameDialog.file.extension} will be preserved`}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleRenameConfirm();
                    }
                  }}
                />
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialog({ open: false, file: null })}>
            Cancel
          </Button>
          <Button 
            onClick={handleRenameConfirm} 
            variant="contained"
            disabled={!newNameInput.trim()}
          >
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* New Folder Dialog */}
      <Dialog 
        open={newFolderDialog} 
        onClose={() => setNewFolderDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create New Folder</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <FormControl fullWidth margin="normal">
              <InputLabel>Parent Folder</InputLabel>
              <Select
                value={newFolderParent}
                onChange={(e) => setNewFolderParent(e.target.value)}
                label="Parent Folder"
                MenuProps={{
                  PaperProps: {
                    style: {
                      maxHeight: 400,
                    },
                  },
                }}
              >
                {folders.map((folder) => (
                  <MenuItem key={folder.id} value={folder.path}>
                    {folder.path}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <TextField
              label="Folder Name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              fullWidth
              margin="normal"
              placeholder="Enter folder name"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleCreateFolder();
                }
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewFolderDialog(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreateFolder} 
            variant="contained"
            disabled={loading || !newFolderName.trim() || !newFolderParent}
            startIcon={loading ? <CircularProgress size={20} /> : <CreateNewFolder />}
          >
            Create Folder
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MediaAssignment;

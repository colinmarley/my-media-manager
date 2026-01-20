'use client';

import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Grid,
  Card,
  CardContent,
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
  Pagination,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Divider,
  Switch,
  FormControlLabel
} from '@mui/material';
import {
  Folder,
  MovieFilter,
  Edit,
  DriveFileMove,
  Delete,
  Refresh,
  Search,
  ViewList,
  GridView,
  PlayArrow,
  ExpandMore,
  FolderOpen,
  Description,
  SwapHoriz,
  Assignment
} from '@mui/icons-material';
import useLibraryBrowserStore from '../../../../store/useLibraryBrowserStore';
import { ScannedFile, ScannedDirectory } from '../../../../service/library/LibraryBrowserService';
import MediaAssignment from './MediaAssignment';
import LibraryBrowserService from '../../../../service/library/LibraryBrowserService';

type LibraryItem = ScannedFile | ScannedDirectory;

const libraryBrowserService = new LibraryBrowserService();

// Type guard functions
const isScannedFile = (item: LibraryItem): item is ScannedFile => {
  return 'extension' in item;
};

const isScannedDirectory = (item: LibraryItem): item is ScannedDirectory => {
  return !('extension' in item);
};

// Helper function to get relative path from library root
const getRelativePath = (fullPath: string, libraryPath?: string): string => {
  if (!libraryPath) return fullPath;
  
  // Remove library path from the full path to get relative path
  if (fullPath.startsWith(libraryPath)) {
    const relative = fullPath.substring(libraryPath.length);
    // Remove leading slash if present
    return relative.startsWith('/') || relative.startsWith('\\') ? relative.substring(1) : relative;
  }
  
  return fullPath;
};

// Helper function to get parent path (library root to current folder)
const getParentPath = (fullPath: string, libraryPath?: string): string => {
  if (!libraryPath) {
    // If no library path, show the parent directories of the full path
    const pathParts = fullPath.split(/[\\/]/).filter(Boolean);
    if (pathParts.length <= 1) return fullPath;
    return pathParts.slice(0, -1).join('/');
  }
  
  // Get relative path
  const relative = getRelativePath(fullPath, libraryPath);
  if (!relative || relative === fullPath) {
    return libraryPath;
  }
  
  // Get parent of relative path
  const pathParts = relative.split(/[\\/]/).filter(Boolean);
  if (pathParts.length <= 1) {
    return libraryPath; // Direct child of library root
  }
  
  // Return library path + parent directories (excluding the folder name itself)
  const parentParts = pathParts.slice(0, -1);
  return `${libraryPath}/${parentParts.join('/')}`;
};

const LibraryBrowser: React.FC = () => {
  const {
    scannedFiles,
    scannedDirectories,
    currentPath,
    loading,
    error,
    selectedItems,
    viewMode,
    searchQuery,
    mediaTypeFilter,
    scanIdFilter,
    currentPage,
    itemsPerPage,
    totalItems,
    folderChildren,
    rootFolders,
    showFolderChildren,
    selectedFolderId,
    setCurrentPath,
    setSearchQuery,
    setMediaTypeFilter,
    setScanIdFilter,
    setViewMode,
    setShowFolderChildren,
    setSelectedFolderId,
    loadScannedFiles,
    loadScannedDirectories,
    loadFolderChildren,
    loadRootFolders,
    refreshData,
    toggleItemSelection,
    selectAllItems,
    clearSelection,
    renameItem,
    moveItems,
    moveSelectedToFolder,
    navigateToPath,
    goBack,
    setPage
  } = useLibraryBrowserStore();
  
  const [showAssignment, setShowAssignment] = useState(false);
  const [allFilesForAssignment, setAllFilesForAssignment] = useState<ScannedFile[]>([]);
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; itemId: string; currentName: string }>({
    open: false,
    itemId: '',
    currentName: ''
  });
  const [newName, setNewName] = useState('');
  const [moveDialog, setMoveDialog] = useState(false);
  const [bulkMoveDialog, setBulkMoveDialog] = useState(false);
  const [targetPath, setTargetPath] = useState('');

  useEffect(() => {
    // Load data when component mounts or filters change
    loadScannedFiles();
    loadScannedDirectories();
    // Load root folders for move operations
    if (currentPath) {
      loadRootFolders(currentPath);
    }
  }, [currentPath, loadScannedFiles, loadScannedDirectories, loadRootFolders]);

  useEffect(() => {
    // Refresh when filters change
    refreshData();
  }, [searchQuery, mediaTypeFilter, scanIdFilter, currentPage, refreshData]);

  const handleRefresh = () => {
    refreshData();
  };

  const handleRename = (itemId: string, currentName: string) => {
    setRenameDialog({ open: true, itemId, currentName });
    setNewName(currentName);
  };

  const handleRenameConfirm = async () => {
    if (renameDialog.itemId && newName.trim()) {
      await renameItem(renameDialog.itemId, newName.trim());
      setRenameDialog({ open: false, itemId: '', currentName: '' });
      setNewName('');
    }
  };

  const handleMoveConfirm = async () => {
    if (targetPath.trim() && selectedItems.length > 0) {
      await moveItems(targetPath.trim());
      setMoveDialog(false);
      setTargetPath('');
    }
  };

  const handleBulkMoveToFolder = async (targetFolderId: string) => {
    await moveSelectedToFolder(targetFolderId);
    setBulkMoveDialog(false);
  };

  const handleFolderExpand = async (folder: ScannedDirectory) => {
    if (selectedFolderId === folder.id) {
      setSelectedFolderId(null);
    } else {
      setSelectedFolderId(folder.id);
      await loadFolderChildren(folder.path);
    }
  };

  const handleItemClick = (item: LibraryItem, type: 'file' | 'directory') => {
    if (type === 'directory') {
      navigateToPath(item.path);
    } else {
      // For files, toggle selection or open preview
      toggleItemSelection(item.id);
    }
  };

  const handleOpenAssignment = async () => {
    // Load ALL files (not paginated) before opening MediaAssignment
    try {
      const result = await libraryBrowserService.getScannedFiles({
        libraryPath: currentPath || undefined,
        scanId: scanIdFilter || undefined,
        limit: 10000, // Get all files
        offset: 0
      });
      
      // Store all files for MediaAssignment
      setAllFilesForAssignment(result.files);
      setShowAssignment(true);
    } catch (error: any) {
      console.error('Failed to load all files:', error);
    }
  };

  const filteredFiles = scannedFiles.filter(file => {
    const matchesSearch = !searchQuery || file.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = !mediaTypeFilter || file.media_type === mediaTypeFilter;
    return matchesSearch && matchesType;
  }).sort((a, b) => a.name.localeCompare(b.name));

  const filteredDirectories = scannedDirectories.filter(dir => {
    const matchesSearch = !searchQuery || dir.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = !mediaTypeFilter || dir.media_type === mediaTypeFilter;
    return matchesSearch && matchesType;
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Sort items: folders first (by name), then files (by name)
  const allItems: LibraryItem[] = [...filteredDirectories, ...filteredFiles];
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  // Show MediaAssignment if activated
  if (showAssignment) {
    const selectedFiles = allFilesForAssignment.filter(file => selectedItems.includes(file.id));
    // Pass all loaded files (not paginated) to MediaAssignment
    const filesToManage = selectedFiles.length > 0 ? selectedFiles : allFilesForAssignment;
    
    return (
      <MediaAssignment 
        files={filesToManage} 
        scanId={scanIdFilter} 
        libraryPath={currentPath}
        onBack={() => setShowAssignment(false)} 
      />
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Library Browser
        </Typography>
        
        {/* Breadcrumbs */}
        <Box sx={{ mb: 2 }}>
          <Button onClick={() => navigateToPath('')} size="small">
            Root
          </Button>
          {currentPath && (
            <>
              {currentPath.split('/').filter(Boolean).map((segment, index, arr) => (
                <React.Fragment key={index}>
                  <Typography component="span" sx={{ mx: 1 }}>/</Typography>
                  <Button
                    onClick={() => navigateToPath(arr.slice(0, index + 1).join('/'))}
                    size="small"
                  >
                    {segment}
                  </Button>
                </React.Fragment>
              ))}
            </>
          )}
        </Box>

        {/* Error Display */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
      </Box>

      {/* Toolbar */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <TextField
          label="Search files and folders"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />
          }}
          size="small"
          sx={{ minWidth: 200 }}
        />

        {/* Media Type Filter */}
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Media Type</InputLabel>
          <Select
            value={mediaTypeFilter}
            onChange={(e) => setMediaTypeFilter(e.target.value)}
            label="Media Type"
          >
            <MenuItem value="">All Types</MenuItem>
            <MenuItem value="movie">Movies</MenuItem>
            <MenuItem value="episode">TV Episodes</MenuItem>
            <MenuItem value="unknown">Unknown</MenuItem>
          </Select>
        </FormControl>

        {/* View Mode Toggle */}
        <Box sx={{ display: 'flex', border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <IconButton
            onClick={() => setViewMode('list')}
            sx={{ 
              borderRadius: 0,
              backgroundColor: viewMode === 'list' ? 'primary.main' : 'transparent',
              color: viewMode === 'list' ? 'white' : 'text.primary'
            }}
          >
            <ViewList />
          </IconButton>
          <IconButton
            onClick={() => setViewMode('grid')}
            sx={{ 
              borderRadius: 0,
              backgroundColor: viewMode === 'grid' ? 'primary.main' : 'transparent',
              color: viewMode === 'grid' ? 'white' : 'text.primary'
            }}
          >
            <GridView />
          </IconButton>
        </Box>

        {/* Actions */}
        <Button
          onClick={handleRefresh}
          startIcon={<Refresh />}
          variant="outlined"
          disabled={loading}
        >
          Refresh
        </Button>

        <FormControlLabel
          control={
            <Switch
              checked={showFolderChildren}
              onChange={(e) => setShowFolderChildren(e.target.checked)}
            />
          }
          label="Show Folder Contents"
        />

        <Button
          onClick={handleOpenAssignment}
          startIcon={<Assignment />}
          variant="contained"
          color="secondary"
          disabled={loading}
        >
          Assign Media Data{selectedItems.length > 0 ? ` (${selectedItems.length})` : ''}
        </Button>

        {selectedItems.length > 0 && (
          <>
            <Button
              onClick={() => setMoveDialog(true)}
              startIcon={<DriveFileMove />}
              variant="contained"
            >
              Move ({selectedItems.length})
            </Button>
            <Button
              onClick={() => setBulkMoveDialog(true)}
              startIcon={<SwapHoriz />}
              variant="contained"
              color="secondary"
            >
              Move to Folder ({selectedItems.length})
            </Button>
            <Button
              onClick={clearSelection}
              variant="outlined"
            >
              Clear Selection
            </Button>
          </>
        )}
      </Box>

      {/* Content */}
      {loading ? (
        <Typography>Loading...</Typography>
      ) : (
        <>
          {/* Items Grid/List */}
          <Grid container spacing={viewMode === 'grid' ? 2 : 1}>
            {allItems.map((item) => {
              const isDirectory = isScannedDirectory(item);
              const isSelected = selectedItems.includes(item.id);
              console.log('Rendering item:', item);
              
              return (
                <Grid key={item.id} size={{ xs: 12, sm: viewMode === 'grid' ? 6 : 12, md: viewMode === 'grid' ? 4 : 12, lg: viewMode === 'grid' ? 3 : 12 }}>
                  {/* Directory with expandable content */}
                  {isDirectory && showFolderChildren ? (
                    <Accordion 
                      expanded={selectedFolderId === item.id}
                      onChange={() => handleFolderExpand(item as ScannedDirectory)}
                      sx={{
                        backgroundColor: isSelected ? 'action.selected' : 'background.paper',
                        border: isSelected ? 2 : 1,
                        borderColor: isSelected ? 'primary.main' : 'divider',
                      }}
                    >
                      <AccordionSummary expandIcon={<ExpandMore />}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                            <Folder sx={{ mr: 1, color: 'warning.main' }} />
                            <Typography variant="body1" sx={{ flexGrow: 1, fontWeight: 500 }}>
                              {item.path}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 0.5, mr: 1 }}>
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleItemSelection(item.id);
                                }}
                              >
                                {isSelected ? <FolderOpen /> : <Folder />}
                              </IconButton>
                              <Tooltip title="Rename">
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRename(item.id, item.name);
                                  }}
                                >
                                  <Edit fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ ml: 4, textAlign: 'left' }}>
                            {getParentPath(item.path, item.libraryPath)}
                          </Typography>
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails>
                        {selectedFolderId === item.id && folderChildren && (
                          <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                              Folder Contents ({folderChildren.files.length + folderChildren.directories.length} items)
                            </Typography>
                            <List dense>
                              {/* Sort subdirectories by name */}
                              {folderChildren.directories
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((subDir) => (
                                <ListItem key={subDir.id}>
                                  <ListItemIcon>
                                    <Folder color="warning" />
                                  </ListItemIcon>
                                  <ListItemText 
                                    primary={subDir.name}
                                    secondary={showFolderChildren ? subDir.path : undefined}
                                  />
                                </ListItem>
                              ))}
                              {/* Sort files by name */}
                              {folderChildren.files
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((file) => (
                                <ListItem key={file.id}>
                                  <ListItemIcon>
                                    <Description color="info" />
                                  </ListItemIcon>
                                  <ListItemText 
                                    primary={file.name}
                                    secondary={showFolderChildren ? `${file.path} • ${file.extension} • ${file.media_type}` : `${file.extension} • ${file.media_type}`}
                                  />
                                </ListItem>
                              ))}
                            </List>
                          </Box>
                        )}
                      </AccordionDetails>
                    </Accordion>
                  ) : (
                    /* Regular card view */
                    <Card
                      sx={{
                        cursor: 'pointer',
                        backgroundColor: isSelected ? 'action.selected' : 'background.paper',
                        border: isSelected ? 2 : 1,
                        borderColor: isSelected ? 'primary.main' : 'divider',
                        '&:hover': {
                          backgroundColor: 'action.hover'
                        }
                      }}
                      onClick={() => handleItemClick(item, isDirectory ? 'directory' : 'file')}
                    >
                      <CardContent sx={{ p: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                          {isDirectory ? (
                            <Folder sx={{ mr: 1, color: 'warning.main' }} />
                          ) : (
                            <MovieFilter sx={{ mr: 1, color: 'info.main' }} />
                          )}
                          
                          <Typography variant="body1" sx={{ flexGrow: 1, fontWeight: 500 }}>
                            {item.path}
                          </Typography>
                          
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <Tooltip title="Rename">
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRename(item.id, item.name);
                                }}
                              >
                                <Edit fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>
                        
                        {/* Item details */}
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                          <Chip
                            label={item.media_type || 'unknown'}
                            size="small"
                            variant="outlined"
                          />
                          {isScannedFile(item) && (
                            <Chip
                              label={item.extension}
                              size="small"
                              variant="outlined"
                            />
                          )}
                        </Box>
                        
                        <Typography variant="caption" color="text.secondary">
                          {showFolderChildren && isDirectory ? getParentPath(item.path, item.libraryPath) : (item.media_type || 'unknown')}
                        </Typography>
                      </CardContent>
                    </Card>
                  )}
                </Grid>
              );
            })}
          </Grid>

          {/* Pagination */}
          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
              <Pagination
                count={totalPages}
                page={currentPage}
                onChange={(_, page) => setPage(page)}
                color="primary"
              />
            </Box>
          )}

          {/* Empty State */}
          {allItems.length === 0 && !loading && (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No files or folders found
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Try adjusting your search or filters, or run a scan to discover media files.
              </Typography>
            </Box>
          )}
        </>
      )}

      {/* Rename Dialog */}
      <Dialog open={renameDialog.open} onClose={() => setRenameDialog({ open: false, itemId: '', currentName: '' })}>
        <DialogTitle>Rename Item</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="New Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            fullWidth
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialog({ open: false, itemId: '', currentName: '' })}>
            Cancel
          </Button>
          <Button onClick={handleRenameConfirm} variant="contained">
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* Move Dialog */}
      <Dialog open={moveDialog} onClose={() => setMoveDialog(false)}>
        <DialogTitle>Move Selected Items</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Target Path"
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            fullWidth
            margin="normal"
            helperText="Enter the full path where you want to move the selected items"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialog(false)}>
            Cancel
          </Button>
          <Button onClick={handleMoveConfirm} variant="contained">
            Move
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Move to Folder Dialog */}
      <Dialog open={bulkMoveDialog} onClose={() => setBulkMoveDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Move to Folder</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Select a destination folder for {selectedItems.length} selected item(s):
          </Typography>
          
          <List>
            {rootFolders.map((folder) => (
              <ListItem key={folder.id}>
                <ListItemButton
                  onClick={() => handleBulkMoveToFolder(folder.id)}
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    mb: 1,
                    '&:hover': {
                      borderColor: 'primary.main',
                      backgroundColor: 'action.hover'
                    }
                  }}
                >
                  <ListItemIcon>
                    <Folder color="warning" />
                  </ListItemIcon>
                  <ListItemText
                    primary={folder.name}
                    secondary={folder.path}
                  />
                </ListItemButton>
              </ListItem>
            ))}
            {rootFolders.length === 0 && (
              <Typography color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                No destination folders available. Make sure you have scanned library paths.
              </Typography>
            )}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkMoveDialog(false)}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LibraryBrowser;
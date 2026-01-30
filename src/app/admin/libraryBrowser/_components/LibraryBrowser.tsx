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
  FormControlLabel,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Checkbox
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
  Assignment,
  ChevronRight,
  InsertDriveFile,
  ArrowBack,
  Home
} from '@mui/icons-material';
import useLibraryBrowserStore from '../../../../store/useLibraryBrowserStore';
import { ScannedFile, ScannedDirectory } from '../../../../service/library/LibraryBrowserService';
import MediaAssignment from './MediaAssignment';
import LibraryBrowserService from '../../../../service/library/LibraryBrowserService';

type LibraryItem = ScannedFile | ScannedDirectory;

interface TreeNode {
  path: string;
  name: string;
  isFolder: boolean;
  children?: TreeNode[];
  file?: ScannedFile;
  directory?: ScannedDirectory;
  level: number;
}

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
    rootLibraryPath,
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
    setRootLibraryPath,
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
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
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
    // Set rootLibraryPath from first scanned item if not already set
    if (!rootLibraryPath && scannedFiles.length > 0) {
      setRootLibraryPath(scannedFiles[0].libraryPath || '');
    } else if (!rootLibraryPath && scannedDirectories.length > 0) {
      setRootLibraryPath(scannedDirectories[0].libraryPath || '');
    }
  }, [scannedFiles, scannedDirectories, rootLibraryPath, setRootLibraryPath]);

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
    // Load files from the current folder (and its subfolders)
    try {
      const result = await libraryBrowserService.getScannedFiles({
        libraryPath: rootLibraryPath || undefined,
        scanId: scanIdFilter || undefined,
        limit: 10000, // Get all files
        offset: 0
      });
      
      // Filter to only include files from current path (if any) and its subdirectories
      let filesToAssign = result.files;
      if (currentPath) {
        const normalizedCurrent = currentPath.replace(/\\/g, '/');
        filesToAssign = result.files.filter(file => {
          const normalizedFilePath = file.path.replace(/\\/g, '/');
          const fileParent = getParentDirectory(normalizedFilePath);
          // Include files that are in currentPath or any of its subdirectories
          return normalizedFilePath.startsWith(normalizedCurrent + '/') || fileParent === normalizedCurrent;
        });
      }
      
      console.log(`Opening MediaAssignment with ${filesToAssign.length} files from ${currentPath || 'root'}`);
      
      // Store all files for MediaAssignment
      setAllFilesForAssignment(filesToAssign);
      setShowAssignment(true);
    } catch (error: any) {
      console.error('Failed to load all files:', error);
    }
  };

  // Helper to get parent directory from a path
  const getParentDirectory = (path: string): string => {
    // Normalize path separators
    const normalizedPath = path.replace(/\\/g, '/');
    const parts = normalizedPath.split('/').filter(Boolean);
    if (parts.length <= 1) return '';
    
    // Take all parts except the last one
    const parentParts = parts.slice(0, -1);
    
    // For Windows paths (e.g., Y:/Media/...), don't prepend extra slash
    // For Unix paths (e.g., /home/user/...), prepend slash
    const isWindowsPath = parentParts[0] && parentParts[0].match(/^[A-Za-z]:$/);
    return isWindowsPath ? parentParts.join('/') : '/' + parentParts.join('/');
  };

  // Helper to check if an item is a direct child of currentPath
  const isDirectChild = (itemPath: string, itemLibraryPath?: string): boolean => {
    // Normalize paths for comparison
    const normalizedItem = itemPath.replace(/\\/g, '/');
    const normalizedCurrent = currentPath ? currentPath.replace(/\\/g, '/') : '';
    const normalizedRoot = (itemLibraryPath || rootLibraryPath).replace(/\\/g, '/');
    
    if (!normalizedCurrent) {
      // At root - show items whose parent equals the library root
      const parent = getParentDirectory(normalizedItem);
      return parent === normalizedRoot;
    }
    
    // Check if item's parent matches current path
    const parent = getParentDirectory(normalizedItem);
    return parent === normalizedCurrent;
  };

  const filteredFiles = scannedFiles.filter(file => {
    const matchesSearch = !searchQuery || file.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = !mediaTypeFilter || file.media_type === mediaTypeFilter;
    const isChild = isDirectChild(file.path, file.libraryPath);
    return matchesSearch && matchesType && isChild;
  }).sort((a, b) => a.name.localeCompare(b.name));

  const filteredDirectories = scannedDirectories.filter(dir => {
    const matchesSearch = !searchQuery || dir.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = !mediaTypeFilter || dir.media_type === mediaTypeFilter;
    const isChild = isDirectChild(dir.path, dir.libraryPath);
    return matchesSearch && matchesType && isChild;
  }).sort((a, b) => a.name.localeCompare(b.name));

  console.log('LibraryBrowser render:', {
    scannedFiles: scannedFiles.length,
    scannedDirectories: scannedDirectories.length,
    filteredFiles: filteredFiles.length,
    filteredDirectories: filteredDirectories.length,
    rootLibraryPath,
    currentPath
  });

  // Build tree structure from filtered files and directories
  const buildTreeStructure = (): TreeNode[] => {
    const root: TreeNode[] = [];
    
    // Add directories first
    filteredDirectories.forEach(dir => {
      root.push({
        path: dir.path,
        name: dir.name,
        isFolder: true,
        directory: dir,
        level: 0,
        children: []
      });
    });
    
    // Add files
    filteredFiles.forEach(file => {
      root.push({
        path: file.path,
        name: file.name,
        isFolder: false,
        file: file,
        level: 0
      });
    });
    
    return root;
  };

  // Toggle folder expansion
  const toggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  };

  // Update tree data when files or directories change
  useEffect(() => {
    setTreeData(buildTreeStructure());
  }, [scannedFiles, scannedDirectories, searchQuery, mediaTypeFilter]);

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
        libraryPath={currentPath || rootLibraryPath}
        onBack={() => setShowAssignment(false)} 
      />
    );
  }

  // Render tree node (folder or file)
  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.path);
    const paddingLeft = depth * 32;
    const isSelected = selectedItems.includes(node.isFolder ? node.directory!.id : node.file!.id);

    if (node.isFolder) {
      const dir = node.directory!;
      return (
        <React.Fragment key={node.path}>
          <TableRow 
            sx={{ 
              bgcolor: isSelected ? 'rgba(61, 90, 254, 0.15)' : 'rgba(61, 90, 254, 0.08)',
              '&:hover': { bgcolor: 'rgba(61, 90, 254, 0.2)' },
              cursor: 'pointer'
            }}
          >
            <TableCell 
              colSpan={5} 
              sx={{ pl: `${paddingLeft + 8}px` }}
              onClick={() => navigateToPath(dir.path)}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ChevronRight color="primary" />
                <Folder color="primary" />
                <Typography variant="body2" fontWeight={600} color="text.primary">
                  {node.name}
                </Typography>
                <Chip label={dir.media_type || 'unknown'} size="small" variant="outlined" sx={{ ml: 1 }} />
              </Box>
            </TableCell>
            <TableCell>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Tooltip title="Select">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleItemSelection(dir.id);
                    }}
                  >
                    <Checkbox checked={isSelected} size="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Rename">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRename(dir.id, dir.name);
                    }}
                  >
                    <Edit fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </TableCell>
          </TableRow>
        </React.Fragment>
      );
    } else if (node.file) {
      const file = node.file;
      return (
        <TableRow 
          key={file.id}
          sx={{
            bgcolor: isSelected ? 'rgba(255, 152, 0, 0.15)' : 'transparent',
            '&:hover': { bgcolor: isSelected ? 'rgba(255, 152, 0, 0.25)' : 'action.hover' },
            cursor: 'pointer'
          }}
          onClick={() => toggleItemSelection(file.id)}
        >
          <TableCell sx={{ pl: `${paddingLeft + 8}px` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <InsertDriveFile fontSize="small" color="action" />
              <Typography variant="body2">{file.name}</Typography>
            </Box>
          </TableCell>
          <TableCell>
            <Chip label={file.extension} size="small" />
          </TableCell>
          <TableCell>
            <Chip label={file.media_type || 'unknown'} size="small" variant="outlined" />
          </TableCell>
          <TableCell>
            <Typography variant="caption" color="text.secondary">
              {file.metadata?.size ? ((file.metadata.size / 1024 / 1024).toFixed(2) + ' MB') : 'N/A'}
            </Typography>
          </TableCell>
          <TableCell>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title="Select">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleItemSelection(file.id);
                  }}
                >
                  <Checkbox checked={isSelected} size="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Rename">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRename(file.id, file.name);
                  }}
                >
                  <Edit fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </TableCell>
        </TableRow>
      );
    }
    return null;
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Library Browser
        </Typography>
        
        {/* Navigation */}
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {/* Back Button */}
          {currentPath && (
            <Button
              onClick={goBack}
              startIcon={<ArrowBack />}
              variant="outlined"
              size="small"
            >
              Back
            </Button>
          )}
          
          {/* Breadcrumbs */}
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button 
              onClick={() => navigateToPath('')} 
              size="small"
              startIcon={<Home />}
              sx={{ minWidth: 'auto' }}
            >
              {rootLibraryPath ? rootLibraryPath.split(/[\\/]/).pop() || 'Library' : 'Root'}
            </Button>
            
            {currentPath && (() => {
              // Get the relative path from root to current
              const normalizedCurrent = currentPath.replace(/\\/g, '/');
              const normalizedRoot = rootLibraryPath.replace(/\\/g, '/');
              const relativePath = normalizedCurrent.startsWith(normalizedRoot) 
                ? normalizedCurrent.substring(normalizedRoot.length)
                : normalizedCurrent;
              
              const pathSegments = relativePath.split('/').filter(Boolean);
              
              return pathSegments.map((segment, index) => {
                const segmentPath = normalizedRoot + '/' + pathSegments.slice(0, index + 1).join('/');
                return (
                  <React.Fragment key={index}>
                    <Typography component="span" sx={{ mx: 0.5, color: 'text.secondary' }}>/</Typography>
                    <Button
                      onClick={() => navigateToPath(segmentPath)}
                      size="small"
                      sx={{ minWidth: 'auto' }}
                    >
                      {segment}
                    </Button>
                  </React.Fragment>
                );
              });
            })()}
          </Box>
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
          {/* Items Tree View */}
          <TableContainer component={Paper} sx={{ maxHeight: 'calc(100vh - 400px)' }}>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell width="120">Extension</TableCell>
                  <TableCell width="120">Type</TableCell>
                  <TableCell width="100">Size</TableCell>
                  <TableCell width="150">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {treeData.map(node => renderTreeNode(node, 0))}
              </TableBody>
            </Table>
          </TableContainer>

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
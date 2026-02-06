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
  Undo,
  ExpandMore,
  ChevronRight,
  InsertDriveFile,
  Folder
} from '@mui/icons-material';
import { ScannedFile } from '../../../../service/library/LibraryBrowserService';
import MediaAssignmentDialog from './MediaAssignmentDialog';
import axios from 'axios';
import { getPathSeparator } from '@/utils/fileUtiles';
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db } from '../../../../../firebaseConfig';
import type { MediaAssignment } from '@/types/library/MediaAssignment.type';
import { AssignmentOrganizationStatus } from '@/types/library/MediaAssignment.type';
import MediaOrganizationService from '@/service/library/MediaOrganizationService';

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

interface TreeNode {
  path: string;
  name: string;
  isFolder: boolean;
  children: TreeNode[];
  file?: ScannedFile;
  level: number;
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
  
  // Tree view state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  
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
  const [assignmentDialog, setAssignmentDialog] = useState(false);

  const API_BASE_URL = process.env.NODE_ENV === 'production'
    ? 'https://your-api-domain.com/api'
    : 'http://localhost:8082/api';

  // Load available folders from scanned directories
  useEffect(() => {
    loadFolders();
  }, [scanId, libraryPath]);

  // Build tree structure when files change
  useEffect(() => {
    if (files.length > 0) {
      const tree = buildTreeStructure(files);
      setTreeData(tree);
    }
  }, [files]);

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
      const pathSeparator = getPathSeparator(path);
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
      console.log('Extracting folders from files:', files.length, 'files');
      console.log('First file:', files[0]);
      
      // Extract unique folder paths from files as fallback
      const uniqueFolders = new Set<string>();
      files.forEach(file => {
        const pathSeparator = getPathSeparator(file.path);
        const lastSepIndex = file.path.lastIndexOf(pathSeparator);
        const folderPath = lastSepIndex !== -1 ? file.path.substring(0, lastSepIndex) : '';
        console.log('File:', file.name, 'Path:', file.path, 'Folder:', folderPath);
        if (folderPath) {
          uniqueFolders.add(folderPath);
        }
      });

      console.log('Unique folders found:', Array.from(uniqueFolders));

      const folderOptions: FolderOption[] = Array.from(uniqueFolders).map(path => {
        const pathSeparator = getPathSeparator(path);
        return {
          id: path,
          path: path,
          name: path.split(pathSeparator).pop() || path
        };
      });

      // Add parent folders to the list
      const foldersWithParents = addParentFolders(folderOptions);
      setFolders(foldersWithParents);
      
      console.log('Total folders (with parents):', foldersWithParents.length);
      
      if (foldersWithParents.length === 0) {
        setError('No folders found. Please ensure files have been scanned.');
      }
      
      setLoading(false); // Set loading to false after extraction
    } catch (err) {
      console.error('Error extracting folders from files:', err);
      setError('Failed to load available folders');
      setLoading(false); // Set loading to false even on error
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

  // Build hierarchical tree structure from flat file list
  const buildTreeStructure = (files: ScannedFile[]): TreeNode[] => {
    const tree: Map<string, TreeNode> = new Map();
    const rootNodes: TreeNode[] = [];
    
    // First, determine the common root path (should be the folder containing all files)
    let commonRoot = '';
    if (files.length > 0) {
      const firstPath = files[0].path;
      const pathSeparator = getPathSeparator(firstPath);
      const parts = firstPath.split(pathSeparator).filter(Boolean);
      
      // Find common prefix across all files, but exclude the filename
      // We want the common folder, not including the file itself
      const maxDepth = parts.length - 1; // Don't include the filename
      for (let i = 0; i < maxDepth; i++) {
        const testPath = parts.slice(0, i + 1).join(pathSeparator);
        const allMatch = files.every(f => f.path.startsWith(testPath));
        if (allMatch) {
          commonRoot = testPath;
        } else {
          break;
        }
      }
      
      console.log('buildTreeStructure - commonRoot:', commonRoot);
    }
    
    // Process each file
    files.forEach(file => {
      const pathSeparator = getPathSeparator(file.path);
      const relativePath = commonRoot ? file.path.substring(commonRoot.length).replace(/^[\\\/]/, '') : file.path;
      const parts = relativePath.split(pathSeparator).filter(Boolean);
      
      console.log('Processing file:', file.path);
      console.log('  relativePath:', relativePath);
      console.log('  parts:', parts);
      
      // Create folder nodes for the path
      let currentPath = commonRoot;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const fullPath = currentPath ? `${currentPath}${pathSeparator}${part}` : part;
        
        if (!tree.has(fullPath)) {
          const node: TreeNode = {
            path: fullPath,
            name: part,
            isFolder: true,
            children: [],
            level: i
          };
          tree.set(fullPath, node);
          
          // Add to parent or root
          if (i === 0) {
            rootNodes.push(node);
          } else {
            const parentPath = currentPath;
            const parentNode = tree.get(parentPath);
            if (parentNode) {
              parentNode.children.push(node);
            }
          }
        }
        
        currentPath = fullPath;
      }
      
      // Add the file node
      const fileName = parts[parts.length - 1];
      const fileNode: TreeNode = {
        path: file.path,
        name: fileName,
        isFolder: false,
        children: [],
        file: file,
        level: parts.length - 1
      };
      
      if (parts.length === 1) {
        // File at root level
        rootNodes.push(fileNode);
      } else {
        // File in a folder
        const folderPath = currentPath;
        const folderNode = tree.get(folderPath);
        if (folderNode) {
          folderNode.children.push(fileNode);
        }
      }
    });
    
    // Sort nodes: folders first, then alphabetically
    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      });
      nodes.forEach(node => {
        if (node.children.length > 0) {
          sortNodes(node.children);
        }
      });
    };
    
    sortNodes(rootNodes);
    return rootNodes;
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const handleFileSelect = (fileId: string) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  const handleFolderSelect = (node: TreeNode) => {
    // Get all file IDs in this folder and subfolders
    const fileIds = getAllFileIdsInNode(node);
    
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      // Check if all files are selected
      const allSelected = fileIds.every(id => newSet.has(id));
      
      if (allSelected) {
        // Deselect all files in folder
        fileIds.forEach(id => newSet.delete(id));
      } else {
        // Select all files in folder
        fileIds.forEach(id => newSet.add(id));
      }
      return newSet;
    });
  };

  const getAllFileIdsInNode = (node: TreeNode): string[] => {
    const fileIds: string[] = [];
    
    const collectFiles = (n: TreeNode) => {
      if (n.file) {
        fileIds.push(n.file.id);
      }
      n.children.forEach(child => collectFiles(child));
    };
    
    collectFiles(node);
    return fileIds;
  };

  const isFolderSelected = (node: TreeNode): { checked: boolean; indeterminate: boolean } => {
    const fileIds = getAllFileIdsInNode(node);
    if (fileIds.length === 0) return { checked: false, indeterminate: false };
    
    const selectedCount = fileIds.filter(id => selectedFiles.has(id)).length;
    
    if (selectedCount === 0) return { checked: false, indeterminate: false };
    if (selectedCount === fileIds.length) return { checked: true, indeterminate: false };
    return { checked: false, indeterminate: true };
  };

  const handleSelectAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map(f => f.id)));
    }
  };

  const handleAssignMedia = async (assignments: any[]) => {
    try {
      setLoading(true);
      
      if (assignments.length === 0) {
        setError('No assignments to process');
        return;
      }

      let successCount = 0;
      let errorCount = 0;
      let organizationErrors: string[] = [];

      // Process all assignments
      for (const assignment of assignments) {
        try {
          // Validate required fields
          if (!assignment.fileIds || !assignment.mediaType || !assignment.mediaId || !assignment.targetStructure) {
            console.error('Invalid assignment data:', assignment);
            errorCount++;
            continue;
          }
          
          // 1. Create media_assignments document
          const mediaAssignment: any = {
            mediaFileIds: assignment.fileIds,
            primaryFileId: assignment.fileIds[0],
            mediaType: assignment.mediaType,
            mediaId: assignment.mediaId,
            isPreferredVersion: true,
            targetFolderStructure: assignment.targetStructure,
            organizationStatus: 'pending' as AssignmentOrganizationStatus,
            operations: [],
            assignedBy: 'current-user', // TODO: Get from auth context
            assignedDate: new Date(),
            confidence: 100,
            isManualAssignment: true,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          
          // Only include episode-specific fields if mediaType is 'episode'
          if (assignment.mediaType === 'episode') {
            mediaAssignment.seriesId = assignment.seriesId;
            mediaAssignment.seasonId = assignment.seasonId;
            mediaAssignment.seasonNumber = assignment.seasonNumber;
            mediaAssignment.episodeNumber = assignment.episodeNumber;
          }
          
          // Only include version if it's provided
          if (assignment.version) {
            mediaAssignment.version = assignment.version;
          }

          const assignmentRef = await addDoc(
            collection(db, 'media_assignments'),
            mediaAssignment
          );
          
          // 2. Update scanned_files status
          const updatePromises = assignment.fileIds.map((fileId: string) =>
            updateDoc(doc(db, 'scanned_files', fileId), {
              assignmentStatus: 'assigned',
              assignedToType: assignment.mediaType,
              assignedToId: assignment.mediaId,
              updatedAt: new Date()
            })
          );
          
          await Promise.all(updatePromises);
          
          // 3. Optional: Trigger file organization if requested
          if (assignment.organizeNow) {
            try {
              const orgService = new MediaOrganizationService();
              await orgService.organizeFiles(assignmentRef.id);
            } catch (orgError: any) {
              console.error('Error organizing files:', orgError);
              organizationErrors.push(`${assignment.mediaTitle}: ${orgError.message}`);
            }
          }

          successCount++;
        } catch (assignError: any) {
          console.error('Error processing assignment:', assignError);
          errorCount++;
        }
      }

      // Show appropriate success/error messages
      if (successCount > 0 && errorCount === 0) {
        if (organizationErrors.length > 0) {
          setError(`${successCount} file(s) assigned but organization failed:\n${organizationErrors.join('\n')}`);
        } else {
          setSuccess(`Successfully assigned ${successCount} file(s)${assignments[0].organizeNow ? ' and organized' : ''}`);
          setSelectedFiles(new Set());
          setAssignmentDialog(false);
        }
      } else if (successCount > 0 && errorCount > 0) {
        setError(`Assigned ${successCount} file(s), but ${errorCount} failed`);
      } else {
        setError(`Failed to assign all ${errorCount} file(s)`);
      }
      
    } catch (err: any) {
      console.error('Error assigning media:', err);
      setError(`Failed to assign files: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const expandAll = () => {
    const allFolderPaths = new Set<string>();
    const collectFolders = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        if (node.isFolder) {
          allFolderPaths.add(node.path);
          collectFolders(node.children);
        }
      });
    };
    collectFolders(treeData);
    setExpandedFolders(allFolderPaths);
  };

  const collapseAll = () => {
    setExpandedFolders(new Set());
  };

  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.path);
    const paddingLeft = depth * 32;

    if (node.isFolder) {
      const { checked, indeterminate } = isFolderSelected(node);
      
      return (
        <React.Fragment key={node.path}>
          <TableRow 
            sx={{ 
              bgcolor: 'rgba(61, 90, 254, 0.08)',
              '&:hover': { bgcolor: 'rgba(61, 90, 254, 0.15)' },
              cursor: 'pointer'
            }}
          >
            <TableCell padding="checkbox">
              <Checkbox
                checked={checked}
                indeterminate={indeterminate}
                onChange={(e) => {
                  e.stopPropagation();
                  handleFolderSelect(node);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </TableCell>
            <TableCell 
              colSpan={5} 
              sx={{ pl: `${paddingLeft + 8}px` }}
              onClick={() => toggleFolder(node.path)}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {isExpanded ? <ExpandMore color="primary" /> : <ChevronRight color="primary" />}
                <Folder color="primary" />
                <Typography variant="body2" fontWeight={600} color="text.primary">
                  {node.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  ({node.children.filter(c => !c.isFolder).length} files, {node.children.filter(c => c.isFolder).length} folders)
                </Typography>
              </Box>
            </TableCell>
          </TableRow>
          {isExpanded && node.children.map(child => renderTreeNode(child, depth + 1))}
        </React.Fragment>
      );
    } else if (node.file) {
      const file = node.file;
      const status = getFileStatus(file.id);
      const changeDesc = getChangeDescription(file.id);
      const currentFolder = getFolderForFile(file);

      return (
        <TableRow 
          key={file.id}
          sx={{
            bgcolor: status === 'pending' ? 'rgba(255, 152, 0, 0.15)' : 'transparent',
            '&:hover': { bgcolor: status === 'pending' ? 'rgba(255, 152, 0, 0.25)' : 'action.hover' }
          }}
        >
          <TableCell padding="checkbox">
            <Checkbox
              checked={selectedFiles.has(file.id)}
              onChange={() => handleFileSelect(file.id)}
              onClick={(e) => e.stopPropagation()}
            />
          </TableCell>
          <TableCell sx={{ pl: `${paddingLeft + 8}px` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <InsertDriveFile fontSize="small" color="action" />
              <Box>
                <Typography variant="body2" fontWeight={status === 'pending' ? 600 : 400}>
                  {pendingChanges.get(file.id)?.newName || file.name}
                </Typography>
                {status === 'pending' && pendingChanges.get(file.id)?.newName && (
                  <Typography variant="caption" color="text.secondary">
                    Was: {file.name}
                  </Typography>
                )}
              </Box>
            </Box>
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
    }
    
    return null;
  };

  console.log('MediaAssignment render:', {
    filesCount: files.length,
    foldersCount: folders.length,
    treeDataCount: treeData.length,
    loading,
    error
  });

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
          {selectedFiles.size > 0 && (
            <Button
              startIcon={<Check />}
              onClick={() => setAssignmentDialog(true)}
              variant="contained"
              color="primary"
            >
              Assign to Media ({selectedFiles.size})
            </Button>
          )}
          <Button
            startIcon={<ExpandMore />}
            onClick={expandAll}
            variant="outlined"
            size="small"
          >
            Expand All
          </Button>
          <Button
            startIcon={<ChevronRight />}
            onClick={collapseAll}
            variant="outlined"
            size="small"
          >
            Collapse All
          </Button>
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
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedFiles.size === files.length && files.length > 0}
                  indeterminate={selectedFiles.size > 0 && selectedFiles.size < files.length}
                  onChange={handleSelectAll}
                />
              </TableCell>
              <TableCell width="35%">Name</TableCell>
              <TableCell width="25%">Current Path</TableCell>
              <TableCell width="20%">Move To Folder</TableCell>
              <TableCell width="10%">Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {treeData.map(node => renderTreeNode(node, 0))}
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

      {/* Media Assignment Dialog */}
      <MediaAssignmentDialog
        open={assignmentDialog}
        onClose={() => setAssignmentDialog(false)}
        selectedFiles={files.filter(f => selectedFiles.has(f.id)).map(f => {
          // Ensure extension starts with a dot
          const extension = f.extension?.startsWith('.') ? f.extension : `.${f.extension || ''}`;
          
          return {
            id: f.id,
            fileName: f.name,
            fileExtension: extension,
            filePath: f.path,
            folderPath: f.path?.substring(0, f.path.lastIndexOf('\\')) || '',
            scanId: f.scanId,
            libraryPathId: f.libraryPath || '',
            // Additional required MediaFile properties with defaults
            relativePath: '',
            fileSize: f.metadata?.size || 0,
            fileSizeFormatted: '',
            checksum: '',
            createdDate: new Date(),
            modifiedDate: new Date(f.metadata?.modified_time || new Date()),
            lastScannedDate: f.discoveredAt,
            isAvailable: true,
            detectedMediaType: 'unknown',
            confidence: 0,
            audioTracks: [],
            subtitleTracks: [],
            assignmentStatus: 'unassigned',
          } as any;
        })}
        onAssign={handleAssignMedia}
      />
    </Box>
  );
};

export default MediaAssignment;

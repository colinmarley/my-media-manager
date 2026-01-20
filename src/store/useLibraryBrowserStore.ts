import { create } from 'zustand';
import LibraryBrowserService, { ScannedFile, ScannedDirectory, ScanResult } from '../service/library/LibraryBrowserService';

interface LibraryBrowserState {
  // Data
  scannedFiles: ScannedFile[];
  scannedDirectories: ScannedDirectory[];
  scanResults: ScanResult[];
  currentPath: string;
  folderChildren: { files: ScannedFile[]; directories: ScannedDirectory[] } | null;
  rootFolders: ScannedDirectory[];
  
  // UI State
  loading: boolean;
  error: string | null;
  selectedItems: string[];
  viewMode: 'grid' | 'list';
  showHiddenFiles: boolean;
  showFolderChildren: boolean;
  selectedFolderId: string | null;
  
  // Filters
  searchQuery: string;
  mediaTypeFilter: string;
  scanIdFilter: string;
  
  // Pagination
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
  
  // Actions
  setCurrentPath: (path: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSearchQuery: (query: string) => void;
  setMediaTypeFilter: (filter: string) => void;
  setScanIdFilter: (filter: string) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setShowHiddenFiles: (show: boolean) => void;
  setShowFolderChildren: (show: boolean) => void;
  setSelectedFolderId: (id: string | null) => void;
  
  // Data actions
  loadScannedFiles: () => Promise<void>;
  loadScannedDirectories: () => Promise<void>;
  loadScanResults: () => Promise<void>;
  loadFolderChildren: (folderPath: string) => Promise<void>;
  loadRootFolders: (libraryPath: string) => Promise<void>;
  refreshData: () => Promise<void>;
  
  // Selection actions
  toggleItemSelection: (itemId: string) => void;
  selectAllItems: () => void;
  clearSelection: () => void;
  
  // File operations
  renameItem: (itemId: string, newName: string) => Promise<void>;
  moveItems: (targetPath: string) => Promise<void>;
  moveSelectedToFolder: (targetFolderId: string) => Promise<void>;
  deleteItems: () => Promise<void>;
  
  // Navigation
  navigateToPath: (path: string) => void;
  goBack: () => void;
  goForward: () => void;
  
  // Pagination
  setPage: (page: number) => void;
  setItemsPerPage: (count: number) => void;
}

const libraryBrowserService = new LibraryBrowserService();

const useLibraryBrowserStore = create<LibraryBrowserState>((set, get) => ({
  // Initial state
  scannedFiles: [],
  scannedDirectories: [],
  scanResults: [],
  currentPath: '',
  folderChildren: null,
  rootFolders: [],
  loading: false,
  error: null,
  selectedItems: [],
  viewMode: 'list',
  showHiddenFiles: false,
  showFolderChildren: false,
  selectedFolderId: null,
  searchQuery: '',
  mediaTypeFilter: '',
  scanIdFilter: '',
  currentPage: 1,
  itemsPerPage: 50,
  totalItems: 0,

  // Basic setters
  setCurrentPath: (path: string) => set({ currentPath: path }),
  setLoading: (loading: boolean) => set({ loading }),
  setError: (error: string | null) => set({ error }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setMediaTypeFilter: (filter: string) => set({ mediaTypeFilter: filter }),
  setScanIdFilter: (filter: string) => set({ scanIdFilter: filter }),
  setViewMode: (mode: 'grid' | 'list') => set({ viewMode: mode }),
  setShowHiddenFiles: (show: boolean) => set({ showHiddenFiles: show }),
  setShowFolderChildren: (show: boolean) => set({ showFolderChildren: show }),
  setSelectedFolderId: (id: string | null) => set({ selectedFolderId: id }),

  // Data loading actions
  loadScannedFiles: async () => {
    const state = get();
    set({ loading: true, error: null });
    
    try {
      const result = await libraryBrowserService.getScannedFiles({
        libraryPath: state.currentPath || undefined,
        scanId: state.scanIdFilter || undefined,
        limit: state.itemsPerPage,
        offset: (state.currentPage - 1) * state.itemsPerPage
      });
      
      set({ 
        scannedFiles: result.files,
        totalItems: result.count,
        loading: false 
      });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to load scanned files',
        loading: false 
      });
    }
  },

  loadScannedDirectories: async () => {
    const state = get();
    set({ loading: true, error: null });
    
    try {
      const result = await libraryBrowserService.getScannedDirectories({
        libraryPath: state.currentPath || undefined,
        scanId: state.scanIdFilter || undefined,
        limit: state.itemsPerPage,
        offset: (state.currentPage - 1) * state.itemsPerPage
      });
      
      set({ 
        scannedDirectories: result.directories,
        totalItems: result.count,
        loading: false 
      });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to load scanned directories',
        loading: false 
      });
    }
  },

  loadScanResults: async () => {
    set({ loading: true, error: null });
    
    try {
      const results = await libraryBrowserService.getScanResults();
      set({ 
        scanResults: results,
        loading: false 
      });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to load scan results',
        loading: false 
      });
    }
  },

  loadFolderChildren: async (folderPath: string) => {
    set({ loading: true, error: null });
    
    try {
      const children = await libraryBrowserService.getFolderChildren(folderPath);
      set({ 
        folderChildren: children,
        loading: false 
      });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to load folder children',
        loading: false 
      });
    }
  },

  loadRootFolders: async (libraryPath: string) => {
    set({ loading: true, error: null });
    
    try {
      const folders = await libraryBrowserService.getRootFolders(libraryPath);
      set({ 
        rootFolders: folders,
        loading: false 
      });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to load root folders',
        loading: false 
      });
    }
  },

  refreshData: async () => {
    const actions = get();
    await Promise.all([
      actions.loadScannedFiles(),
      actions.loadScannedDirectories()
    ]);
  },

  // Selection actions
  toggleItemSelection: (itemId: string) => {
    const state = get();
    const isSelected = state.selectedItems.includes(itemId);
    
    if (isSelected) {
      set({ 
        selectedItems: state.selectedItems.filter(id => id !== itemId) 
      });
    } else {
      set({ 
        selectedItems: [...state.selectedItems, itemId] 
      });
    }
  },

  selectAllItems: () => {
    const state = get();
    const allIds = [
      ...state.scannedFiles.map(f => f.id),
      ...state.scannedDirectories.map(d => d.id)
    ];
    set({ selectedItems: allIds });
  },

  clearSelection: () => set({ selectedItems: [] }),

  // File operations
  renameItem: async (itemId: string, newName: string) => {
    const state = get();
    set({ loading: true, error: null });
    
    try {
      // Find the item to rename
      const file = state.scannedFiles.find(f => f.id === itemId);
      const directory = state.scannedDirectories.find(d => d.id === itemId);
      
      if (file) {
        await libraryBrowserService.renameFile(file.path, newName);
      } else if (directory) {
        await libraryBrowserService.renameDirectory(directory.path, newName);
      }
      
      // Refresh data after rename
      await get().refreshData();
      set({ loading: false });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to rename item',
        loading: false 
      });
    }
  },

  moveItems: async (targetPath: string) => {
    const state = get();
    set({ loading: true, error: null });
    
    try {
      // Move each selected item with merge enabled
      for (const itemId of state.selectedItems) {
        const file = state.scannedFiles.find(f => f.id === itemId);
        const directory = state.scannedDirectories.find(d => d.id === itemId);
        
        if (file) {
          await libraryBrowserService.moveFile(file.path, targetPath, true); // Enable merge
        } else if (directory) {
          await libraryBrowserService.moveDirectory(directory.path, targetPath, true); // Enable merge
        }
      }
      
      // Clear selection and refresh
      set({ selectedItems: [] });
      await get().refreshData();
      set({ loading: false });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to move items',
        loading: false 
      });
    }
  },

  moveSelectedToFolder: async (targetFolderId: string) => {
    const state = get();
    set({ loading: true, error: null });
    
    try {
      // Find the target folder
      const targetFolder = state.scannedDirectories.find(d => d.id === targetFolderId);
      if (!targetFolder) {
        throw new Error('Target folder not found');
      }

      // Prepare items for bulk move
      const itemsToMove = state.selectedItems.map(itemId => {
        const file = state.scannedFiles.find(f => f.id === itemId);
        const directory = state.scannedDirectories.find(d => d.id === itemId);
        
        if (file) {
          return { id: itemId, path: file.path, type: 'file' as const };
        } else if (directory) {
          return { id: itemId, path: directory.path, type: 'directory' as const };
        }
        return null;
      }).filter(Boolean) as Array<{id: string, path: string, type: 'file' | 'directory'}>;

      // Perform bulk move
      const results = await libraryBrowserService.moveMultipleItems(itemsToMove, targetFolder.path);
      
      // Check for any failures
      const failures = results.filter(r => !r.success);
      if (failures.length > 0) {
        set({ 
          error: `Some items failed to move: ${failures.map(f => f.message).join(', ')}`,
          loading: false 
        });
      } else {
        // Clear selection and refresh
        set({ selectedItems: [] });
        await get().refreshData();
        set({ loading: false });
      }
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to move items to folder',
        loading: false 
      });
    }
  },

  deleteItems: async () => {
    // Note: Delete functionality would need to be implemented in the API
    set({ error: 'Delete functionality not yet implemented' });
  },

  // Navigation
  navigateToPath: (path: string) => {
    set({ currentPath: path, currentPage: 1 });
    get().refreshData();
  },

  goBack: () => {
    const state = get();
    if (state.currentPath) {
      const parentPath = state.currentPath.substring(0, state.currentPath.lastIndexOf('/'));
      get().navigateToPath(parentPath);
    }
  },

  goForward: () => {
    // Would need navigation history for this
  },

  // Pagination
  setPage: (page: number) => {
    set({ currentPage: page });
    get().refreshData();
  },

  setItemsPerPage: (count: number) => {
    set({ itemsPerPage: count, currentPage: 1 });
    get().refreshData();
  }
}));

export default useLibraryBrowserStore;
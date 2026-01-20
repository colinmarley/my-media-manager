/**
 * Media Assignment Store
 * 
 * Zustand store for managing media assignment operations,
 * including file selection, OMDB/TVDB searches, and file operations.
 */

import { create } from 'zustand';
import MediaAssignmentService from '../service/library/MediaAssignmentService';
import { ScannedFile } from '../service/library/LibraryBrowserService';
import {
  FileAssignment,
  MediaSuggestion,
  NamingFormat,
  FolderStructureTemplate,
  DEFAULT_NAMING_FORMATS,
  DEFAULT_FOLDER_STRUCTURES,
  MediaAssignmentType,
  BatchAssignmentOperation,
  BatchOperationSummary,
  MediaSearchParams
} from '../types/library/MediaAssignment';
import { OmdbResponseFull } from '../types/OmdbResponse.type';

interface MediaAssignmentState {
  // Data
  assignments: FileAssignment[];
  currentAssignment: FileAssignment | null;
  searchResults: MediaSuggestion[];
  
  // Configuration
  libraryRoot: string;
  namingFormat: NamingFormat | null;
  folderStructure: FolderStructureTemplate | null;
  
  // UI State
  loading: boolean;
  searching: boolean;
  error: string | null;
  selectedAssignmentIds: string[];
  
  // View state
  viewMode: 'grid' | 'list' | 'detail';
  filterType: MediaAssignmentType | 'all';
  filterStatus: string;
  sortBy: 'name' | 'date' | 'confidence' | 'status';
  
  // Batch operation state
  batchOperation: BatchAssignmentOperation | null;
  batchProgress: BatchOperationSummary | null;
  
  // Actions - Assignment Management
  setAssignments: (assignments: FileAssignment[]) => void;
  addAssignment: (file: ScannedFile) => void;
  addAssignments: (files: ScannedFile[]) => void;
  removeAssignment: (fileId: string) => void;
  clearAssignments: () => void;
  updateAssignment: (fileId: string, updates: Partial<FileAssignment>) => void;
  setCurrentAssignment: (assignment: FileAssignment | null) => void;
  
  // Actions - Search & Match
  searchMedia: (params: MediaSearchParams) => Promise<void>;
  selectSuggestion: (fileId: string, suggestion: MediaSuggestion) => Promise<void>;
  assignMediaData: (fileId: string, omdbData: OmdbResponseFull, type: MediaAssignmentType) => void;
  assignSeriesData: (fileId: string, seriesData: OmdbResponseFull) => void;
  setEpisodeInfo: (fileId: string, season: number, episode: number) => void;
  autoSuggestAll: () => Promise<void>;
  autoSuggestSingle: (fileId: string) => Promise<void>;
  
  // Actions - File Operations
  generateProposedNames: (fileIds?: string[]) => void;
  previewRename: (fileId: string) => string | null;
  previewMove: (fileId: string) => string | null;
  executeRename: (fileId: string) => Promise<void>;
  executeMove: (fileId: string) => Promise<void>;
  executeBatchOperation: (operation: 'rename' | 'move' | 'complete') => Promise<void>;
  
  // Actions - Configuration
  setLibraryRoot: (path: string) => void;
  setNamingFormat: (format: NamingFormat | null) => void;
  setFolderStructure: (structure: FolderStructureTemplate | null) => void;
  resetToDefaults: () => void;
  
  // Actions - Selection
  toggleSelection: (fileId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  selectByType: (type: MediaAssignmentType) => void;
  
  // Actions - UI
  setViewMode: (mode: 'grid' | 'list' | 'detail') => void;
  setFilterType: (type: MediaAssignmentType | 'all') => void;
  setFilterStatus: (status: string) => void;
  setSortBy: (sortBy: 'name' | 'date' | 'confidence' | 'status') => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const mediaAssignmentService = new MediaAssignmentService();

const useMediaAssignmentStore = create<MediaAssignmentState>((set, get) => ({
  // Initial state
  assignments: [],
  currentAssignment: null,
  searchResults: [],
  libraryRoot: '',
  namingFormat: null,
  folderStructure: null,
  loading: false,
  searching: false,
  error: null,
  selectedAssignmentIds: [],
  viewMode: 'detail',
  filterType: 'all',
  filterStatus: 'all',
  sortBy: 'name',
  batchOperation: null,
  batchProgress: null,

  // Assignment Management
  setAssignments: (assignments: FileAssignment[]) => set({ assignments }),

  addAssignment: (file: ScannedFile) => {
    const assignment = mediaAssignmentService.createAssignment(file);
    set(state => ({
      assignments: [...state.assignments, assignment]
    }));
  },

  addAssignments: (files: ScannedFile[]) => {
    const newAssignments = files.map(file => 
      mediaAssignmentService.createAssignment(file)
    );
    set(state => ({
      assignments: [...state.assignments, ...newAssignments]
    }));
  },

  removeAssignment: (fileId: string) => {
    set(state => ({
      assignments: state.assignments.filter(a => a.file.id !== fileId),
      selectedAssignmentIds: state.selectedAssignmentIds.filter(id => id !== fileId)
    }));
  },

  clearAssignments: () => set({ 
    assignments: [], 
    selectedAssignmentIds: [],
    currentAssignment: null 
  }),

  updateAssignment: (fileId: string, updates: Partial<FileAssignment>) => {
    set(state => ({
      assignments: state.assignments.map(a =>
        a.file.id === fileId ? { ...a, ...updates } : a
      )
    }));
  },

  setCurrentAssignment: (assignment: FileAssignment | null) => set({ currentAssignment: assignment }),

  // Search & Match
  searchMedia: async (params: MediaSearchParams) => {
    set({ searching: true, error: null });
    try {
      const results = await mediaAssignmentService.searchMedia(params);
      set({ searchResults: results, searching: false });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to search media', 
        searching: false,
        searchResults: []
      });
    }
  },

  selectSuggestion: async (fileId: string, suggestion: MediaSuggestion) => {
    set({ loading: true, error: null });
    try {
      // Get full OMDB data
      const omdbData = await mediaAssignmentService.getMediaData(suggestion.data.imdbID);
      
      // Update assignment with media data
      get().assignMediaData(fileId, omdbData, suggestion.type);
      
      // If it's an episode, also get series data
      if (suggestion.type === 'episode' && omdbData.Type === 'series') {
        get().assignSeriesData(fileId, omdbData);
      }
      
      set({ loading: false });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to load media data', 
        loading: false 
      });
    }
  },

  assignMediaData: (fileId: string, omdbData: OmdbResponseFull, type: MediaAssignmentType) => {
    const state = get();
    const assignment = state.assignments.find(a => a.file.id === fileId);
    
    if (!assignment) return;

    const updates: Partial<FileAssignment> = {
      omdbData,
      assignmentType: type,
      status: 'matched',
      confidence: 90
    };

    get().updateAssignment(fileId, updates);
    
    // Auto-generate proposed name if format is set
    if (state.namingFormat || state.libraryRoot) {
      get().generateProposedNames([fileId]);
    }
  },

  assignSeriesData: (fileId: string, seriesData: OmdbResponseFull) => {
    get().updateAssignment(fileId, { seriesData });
  },

  setEpisodeInfo: (fileId: string, season: number, episode: number) => {
    get().updateAssignment(fileId, { 
      seasonNumber: season, 
      episodeNumber: episode 
    });
    
    // Regenerate proposed name with new episode info
    get().generateProposedNames([fileId]);
  },

  autoSuggestAll: async () => {
    const { assignments } = get();
    set({ loading: true, error: null });
    
    try {
      for (const assignment of assignments) {
        if (assignment.status === 'unassigned') {
          const suggestions = await mediaAssignmentService.autoSuggestMatches(assignment.file);
          get().updateAssignment(assignment.file.id, { 
            suggestions,
            status: 'searching'
          });
        }
      }
      set({ loading: false });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to auto-suggest matches', 
        loading: false 
      });
    }
  },

  autoSuggestSingle: async (fileId: string) => {
    const assignment = get().assignments.find(a => a.file.id === fileId);
    if (!assignment) return;

    set({ loading: true, error: null });
    try {
      const suggestions = await mediaAssignmentService.autoSuggestMatches(assignment.file);
      get().updateAssignment(fileId, { suggestions, status: 'searching' });
      set({ loading: false });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to auto-suggest matches', 
        loading: false 
      });
    }
  },

  // File Operations
  generateProposedNames: (fileIds?: string[]) => {
    const state = get();
    const targetAssignments = fileIds 
      ? state.assignments.filter(a => fileIds.includes(a.file.id))
      : state.assignments;

    for (const assignment of targetAssignments) {
      if (!assignment.omdbData || !assignment.assignmentType) continue;

      try {
        const proposed = mediaAssignmentService.generateProposedPath(
          assignment,
          state.libraryRoot,
          state.namingFormat || DEFAULT_NAMING_FORMATS[assignment.assignmentType],
          state.folderStructure || DEFAULT_FOLDER_STRUCTURES[assignment.assignmentType]
        );

        get().updateAssignment(assignment.file.id, {
          proposedName: proposed.filename,
          proposedPath: proposed.fullPath,
          proposedFolder: proposed.folder
        });
      } catch (error) {
        console.error(`Failed to generate name for ${assignment.file.name}:`, error);
      }
    }
  },

  previewRename: (fileId: string): string | null => {
    const assignment = get().assignments.find(a => a.file.id === fileId);
    return assignment?.proposedName || null;
  },

  previewMove: (fileId: string): string | null => {
    const assignment = get().assignments.find(a => a.file.id === fileId);
    return assignment?.proposedPath || null;
  },

  executeRename: async (fileId: string) => {
    const assignment = get().assignments.find(a => a.file.id === fileId);
    if (!assignment || !assignment.proposedName) {
      set({ error: 'No proposed name available' });
      return;
    }

    set({ loading: true, error: null });
    try {
      const result = await mediaAssignmentService.renameFile({
        fileId,
        operation: 'rename',
        newName: assignment.proposedName
      });

      if (result.success) {
        get().updateAssignment(fileId, { status: 'renamed' });
      } else {
        throw new Error(result.error || 'Rename failed');
      }

      set({ loading: false });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to rename file', 
        loading: false 
      });
    }
  },

  executeMove: async (fileId: string) => {
    const assignment = get().assignments.find(a => a.file.id === fileId);
    if (!assignment || !assignment.proposedPath) {
      set({ error: 'No proposed path available' });
      return;
    }

    set({ loading: true, error: null });
    try {
      const result = await mediaAssignmentService.moveFile({
        fileId,
        operation: 'move',
        targetPath: assignment.proposedPath,
        createFolder: true
      });

      if (result.success) {
        get().updateAssignment(fileId, { status: 'moved' });
      } else {
        throw new Error(result.error || 'Move failed');
      }

      set({ loading: false });
    } catch (error: any) {
      set({ 
        error: error.message || 'Failed to move file', 
        loading: false 
      });
    }
  },

  executeBatchOperation: async (operation: 'rename' | 'move' | 'complete') => {
    const state = get();
    const selectedAssignments = state.assignments.filter(a => 
      state.selectedAssignmentIds.includes(a.file.id)
    );

    if (selectedAssignments.length === 0) {
      set({ error: 'No files selected for batch operation' });
      return;
    }

    const batchOp: BatchAssignmentOperation = {
      files: selectedAssignments,
      operation,
      targetFolder: state.libraryRoot,
      namingFormat: state.namingFormat || undefined,
      folderStructure: state.folderStructure || undefined,
      dryRun: false,
      continueOnError: true,
      createFolders: true
    };

    set({ loading: true, error: null, batchOperation: batchOp });

    try {
      const result = await mediaAssignmentService.executeBatchOperation(batchOp);
      
      set({ 
        batchOperation: result,
        batchProgress: result.summary,
        loading: false
      });

      // Update assignment statuses based on results
      if (result.results) {
        for (const opResult of result.results) {
          if (opResult.success) {
            get().updateAssignment(opResult.fileId, { 
              status: operation === 'rename' ? 'renamed' : 'moved'
            });
          }
        }
      }
    } catch (error: any) {
      set({ 
        error: error.message || 'Batch operation failed', 
        loading: false 
      });
    }
  },

  // Configuration
  setLibraryRoot: (path: string) => set({ libraryRoot: path }),

  setNamingFormat: (format: NamingFormat | null) => set({ namingFormat: format }),

  setFolderStructure: (structure: FolderStructureTemplate | null) => 
    set({ folderStructure: structure }),

  resetToDefaults: () => set({ 
    namingFormat: null, 
    folderStructure: null 
  }),

  // Selection
  toggleSelection: (fileId: string) => {
    set(state => ({
      selectedAssignmentIds: state.selectedAssignmentIds.includes(fileId)
        ? state.selectedAssignmentIds.filter(id => id !== fileId)
        : [...state.selectedAssignmentIds, fileId]
    }));
  },

  selectAll: () => {
    set(state => ({
      selectedAssignmentIds: state.assignments.map(a => a.file.id)
    }));
  },

  clearSelection: () => set({ selectedAssignmentIds: [] }),

  selectByType: (type: MediaAssignmentType) => {
    set(state => ({
      selectedAssignmentIds: state.assignments
        .filter(a => a.assignmentType === type)
        .map(a => a.file.id)
    }));
  },

  // UI
  setViewMode: (mode: 'grid' | 'list' | 'detail') => set({ viewMode: mode }),
  setFilterType: (type: MediaAssignmentType | 'all') => set({ filterType: type }),
  setFilterStatus: (status: string) => set({ filterStatus: status }),
  setSortBy: (sortBy: 'name' | 'date' | 'confidence' | 'status') => set({ sortBy }),
  setLoading: (loading: boolean) => set({ loading }),
  setError: (error: string | null) => set({ error })
}));

export default useMediaAssignmentStore;

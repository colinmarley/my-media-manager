import { useState, useCallback } from 'react';
import { LibraryPath, LibraryStatus } from '../../types/library/LibraryTypes';

export interface LibraryStatusState {
  libraryPaths: LibraryPath[];
  selectedPath: LibraryPath | null;
  isLoading: boolean;
  error: string | null;
}

export const useLibraryStatus = () => {
  const [state, setState] = useState<LibraryStatusState>({
    libraryPaths: [],
    selectedPath: null,
    isLoading: false,
    error: null
  });

  // Add a new library path
  const addLibraryPath = useCallback((path: LibraryPath) => {
    setState(prev => ({
      ...prev,
      libraryPaths: [...prev.libraryPaths, path]
    }));
  }, []);

  // Remove a library path
  const removeLibraryPath = useCallback((pathId: string) => {
    setState(prev => ({
      ...prev,
      libraryPaths: prev.libraryPaths.filter(path => path.id !== pathId),
      selectedPath: prev.selectedPath?.id === pathId ? null : prev.selectedPath
    }));
  }, []);

  // Update a library path
  const updateLibraryPath = useCallback((pathId: string, updates: Partial<LibraryPath>) => {
    setState(prev => ({
      ...prev,
      libraryPaths: prev.libraryPaths.map(path => 
        path.id === pathId ? { ...path, ...updates } : path
      ),
      selectedPath: prev.selectedPath?.id === pathId 
        ? { ...prev.selectedPath, ...updates }
        : prev.selectedPath
    }));
  }, []);

  // Select a library path
  const selectLibraryPath = useCallback((path: LibraryPath | null) => {
    setState(prev => ({ ...prev, selectedPath: path }));
  }, []);

  // Set loading state
  const setLoading = useCallback((isLoading: boolean) => {
    setState(prev => ({ ...prev, isLoading }));
  }, []);

  // Set error
  const setError = useCallback((error: string | null) => {
    setState(prev => ({ ...prev, error }));
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  // Get library statistics
  const getLibraryStatistics = useCallback(() => {
    const totalPaths = state.libraryPaths.length;
    const activePaths = state.libraryPaths.filter(path => path.isActive).length;
    const lastScanned = state.libraryPaths
      .filter(path => path.lastScanned)
      .sort((a, b) => (b.lastScanned?.getTime() || 0) - (a.lastScanned?.getTime() || 0))[0]?.lastScanned;

    return {
      totalPaths,
      activePaths,
      lastScanned
    };
  }, [state.libraryPaths]);

  return {
    // State
    libraryPaths: state.libraryPaths,
    selectedPath: state.selectedPath,
    isLoading: state.isLoading,
    error: state.error,

    // Actions
    addLibraryPath,
    removeLibraryPath,
    updateLibraryPath,
    selectLibraryPath,
    setLoading,
    setError,
    clearError,
    getLibraryStatistics
  };
};
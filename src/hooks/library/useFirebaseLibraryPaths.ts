import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { LibraryPath } from '../../types/library/LibraryTypes';
import { firebaseLibraryService } from '../../service/library/FirebaseLibraryService';

export const useFirebaseLibraryPaths = (user: User | null) => {
  const [libraryPaths, setLibraryPaths] = useState<LibraryPath[]>([]);
  const [selectedPath, setSelectedPath] = useState<LibraryPath | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load library paths when user changes
  useEffect(() => {
    if (!user) {
      setLibraryPaths([]);
      setSelectedPath(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Subscribe to real-time updates
    const unsubscribe = firebaseLibraryService.subscribeToLibraryPaths(user, (paths) => {
      setLibraryPaths(paths);
      setIsLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  const addLibraryPath = async (path: Omit<LibraryPath, 'id'>) => {
    if (!user) {
      setError('User not authenticated');
      return;
    }

    try {
      setError(null);
      await firebaseLibraryService.addLibraryPath(user, path);
      // Real-time listener will update the state
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add library path');
    }
  };

  const removeLibraryPath = async (pathId: string) => {
    if (!user) {
      setError('User not authenticated');
      return;
    }

    try {
      setError(null);
      await firebaseLibraryService.deleteLibraryPath(user, pathId);
      
      // Clear selection if deleted path was selected
      if (selectedPath?.id === pathId) {
        setSelectedPath(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove library path');
    }
  };

  const updateLibraryPath = async (pathId: string, updates: Partial<LibraryPath>) => {
    if (!user) {
      setError('User not authenticated');
      return;
    }

    try {
      setError(null);
      await firebaseLibraryService.updateLibraryPath(user, pathId, updates);
      // Real-time listener will update the state
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update library path');
    }
  };

  const selectLibraryPath = (path: LibraryPath) => {
    setSelectedPath(path);
  };

  const clearError = () => {
    setError(null);
  };

  const getLibraryStatistics = () => {
    return {
      totalPaths: libraryPaths.length,
      activePaths: libraryPaths.filter(p => p.isActive).length,
      lastScanned: libraryPaths
        .filter(p => p.lastScanned)
        .sort((a, b) => (b.lastScanned?.getTime() || 0) - (a.lastScanned?.getTime() || 0))[0]?.lastScanned || null
    };
  };

  return {
    libraryPaths,
    selectedPath,
    isLoading,
    error,
    addLibraryPath,
    removeLibraryPath,
    updateLibraryPath,
    selectLibraryPath,
    clearError,
    getLibraryStatistics
  };
};
import { useState, useEffect, useCallback } from 'react';
import { LibraryPath } from '../../types/library/LibraryTypes';
import { api } from '../../service/api/apiClient';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const useLibraryPaths = (_user: unknown = null) => {
  const [libraryPaths, setLibraryPaths] = useState<LibraryPath[]>([]);
  const [selectedPath, setSelectedPath] = useState<LibraryPath | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPaths = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const paths = await api.get<LibraryPath[]>('/api/library-paths');
      setLibraryPaths(paths);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library paths');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPaths();
  }, [fetchPaths]);

  const addLibraryPath = async (path: Omit<LibraryPath, 'id'>) => {
    try {
      setError(null);
      const newPath = await api.post<LibraryPath>('/api/library-paths', path);
      setLibraryPaths((prev) => [...prev, newPath]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add library path');
    }
  };

  const removeLibraryPath = async (pathId: string) => {
    try {
      setError(null);
      await api.delete(`/api/library-paths/${pathId}`);
      setLibraryPaths((prev) => prev.filter((p) => p.id !== pathId));
      if (selectedPath?.id === pathId) {
        setSelectedPath(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove library path');
    }
  };

  const updateLibraryPath = async (pathId: string, updates: Partial<LibraryPath>) => {
    try {
      setError(null);
      const updated = await api.put<LibraryPath>(`/api/library-paths/${pathId}`, updates);
      setLibraryPaths((prev) => prev.map((p) => (p.id === pathId ? updated : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update library path');
    }
  };

  const selectLibraryPath = (path: LibraryPath) => {
    setSelectedPath(path);
  };

  const clearError = () => setError(null);

  const getLibraryStatistics = () => ({
    totalPaths: libraryPaths.length,
    activePaths: libraryPaths.filter((p) => p.isActive).length,
    lastScanned:
      libraryPaths
        .filter((p) => p.lastScanned)
        .sort((a, b) => (b.lastScanned?.getTime() || 0) - (a.lastScanned?.getTime() || 0))[0]
        ?.lastScanned || null,
  });

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
    getLibraryStatistics,
  };
};
import { useState, useCallback, useEffect } from 'react';
import { 
  LibraryPath, 
  ScanResult, 
  ScanProgress,
  LibrarySettings
} from '../../types/library/LibraryTypes';
import { LibraryScanner, DEFAULT_LIBRARY_SETTINGS } from '../../service/library/LibraryScanner';

export interface LibraryScannerState {
  scanner: LibraryScanner | null;
  isScanning: boolean;
  scanProgress: ScanProgress | null;
  scanResults: ScanResult[];
  settings: LibrarySettings;
  error: string | null;
}

export const useLibraryScanner = () => {
  const [state, setState] = useState<LibraryScannerState>({
    scanner: null,
    isScanning: false,
    scanProgress: null,
    scanResults: [],
    settings: DEFAULT_LIBRARY_SETTINGS,
    error: null
  });

  // Initialize services
  useEffect(() => {
    const scanner = new LibraryScanner(state.settings, 'http://localhost:8082');

    setState(prev => ({
      ...prev,
      scanner
    }));
  }, [state.settings]);

  // Start scanning a library path
  const startScan = useCallback(async (libraryPath: LibraryPath): Promise<ScanResult | null> => {
    if (!state.scanner || state.isScanning) {
      return null;
    }

    setState(prev => ({
      ...prev,
      isScanning: true,
      scanProgress: null,
      error: null
    }));

    try {
      const result = await state.scanner.scanLibraryPath(
        libraryPath,
        (progress: ScanProgress) => {
          setState(prev => ({
            ...prev,
            scanProgress: progress
          }));
        }
      );

      setState(prev => ({
        ...prev,
        isScanning: false,
        scanResults: [...prev.scanResults, result],
        scanProgress: null
      }));

      return result;
    } catch (error) {
      setState(prev => ({
        ...prev,
        isScanning: false,
        scanProgress: null,
        error: error instanceof Error ? error.message : 'Unknown scan error'
      }));
      return null;
    }
  }, [state.scanner, state.isScanning]);

  // Stop current scan
  const stopScan = useCallback(() => {
    if (state.scanner && state.isScanning) {
      state.scanner.abortScan();
      setState(prev => ({
        ...prev,
        isScanning: false,
        scanProgress: null
      }));
    }
  }, [state.scanner, state.isScanning]);

  // Update library settings
  const updateSettings = useCallback((newSettings: Partial<LibrarySettings>) => {
    setState(prev => ({
      ...prev,
      settings: { ...prev.settings, ...newSettings }
    }));
  }, []);

  // Clear scan results
  const clearResults = useCallback(() => {
    setState(prev => ({
      ...prev,
      scanResults: [],
      error: null
    }));
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  // Get scan statistics
  const getScanStatistics = useCallback(() => {
    const totalScans = state.scanResults.length;
    const totalFiles = state.scanResults.reduce((sum, result) => sum + result.totalFiles, 0);
    const totalFolders = state.scanResults.reduce((sum, result) => sum + result.totalFolders, 0);
    const totalErrors = state.scanResults.reduce((sum, result) => sum + result.errors.length, 0);

    return {
      totalScans,
      totalFiles,
      totalFolders,
      totalErrors
    };
  }, [state.scanResults]);

  return {
    // State
    isScanning: state.isScanning,
    scanProgress: state.scanProgress,
    scanResults: state.scanResults,
    settings: state.settings,
    error: state.error,
    
    // Actions
    startScan,
    stopScan,
    updateSettings,
    clearResults,
    clearError,
    getScanStatistics,
    
    // Services
    scanner: state.scanner
  };
};
import { 
  LibraryPath, 
  MediaFileInfo, 
  FolderStructure, 
  ScanResult, 
  ScanProgress, 
  ScanError, 
  ScanStatus,
  VideoQuality,
  AudioTrack,
  SubtitleTrack,
  SUPPORTED_VIDEO_EXTENSIONS,
  SUPPORTED_SUBTITLE_EXTENSIONS,
  DEFAULT_EXCLUDE_PATTERNS,
  LibrarySettings 
} from '../../types/library/LibraryTypes';

// Default library settings
export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = {
  defaultNamingConventions: [
    {
      type: 'movie',
      pattern: '^(.+?)\\s*\\((\\d{4})\\).*\\.(mp4|mkv|avi|mov)$',
      example: 'Movie Title (2023).mp4',
      description: 'Movie Title (Year).extension'
    },
    {
      type: 'series',
      pattern: '^(.+?)\\s*\\((\\d{4})\\)$',
      example: 'TV Show (2023)',
      description: 'TV Show (Year) folder'
    }
  ],
  autoScanInterval: 24,
  autoMatchThreshold: 80,
  fileExtensions: SUPPORTED_VIDEO_EXTENSIONS,
  excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
  extractMetadata: true,
  validateFiles: true
};

export class LibraryScanner {
  private scanProgress: ScanProgress | null = null;
  private scanAborted = false;
  private settings: LibrarySettings;
  private baseUrl: string;
  private activeScanId: string | null = null;

  constructor(settings: LibrarySettings, baseUrl: string = 'http://localhost:8082') {
    this.settings = settings;
    this.baseUrl = baseUrl;
  }

  /**
   * Start a library scan using the backend API
   */
  async scanLibraryPath(libraryPath: LibraryPath, onProgress?: (progress: ScanProgress) => void): Promise<ScanResult> {
    try {
      // Start scan on backend
      const response = await fetch(`${this.baseUrl}/api/library/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          libraryPath: libraryPath.rootPath
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to start scan');
      }

      const startResult = await response.json();
      this.activeScanId = startResult.data.scanId;
      
      // Poll for progress
      return await this.pollScanProgress(libraryPath, onProgress);
    } catch (error) {
      const errorResult: ScanResult = {
        libraryPath,
        totalFolders: 0,
        totalFiles: 0,
        newFiles: 0,
        missingFiles: 0,
        matchedFiles: 0,
        unmatchedFiles: 0,
        errors: [{
          type: 'file_access',
          message: error instanceof Error ? error.message : 'Unknown error',
          path: libraryPath.rootPath,
          timestamp: new Date()
        }],
        startTime: new Date(),
        endTime: new Date(),
        status: 'error'
      };
      return errorResult;
    }
  }

  /**
   * Poll the backend for scan progress updates
   */
  private async pollScanProgress(libraryPath: LibraryPath, onProgress?: (progress: ScanProgress) => void): Promise<ScanResult> {
    if (!this.activeScanId) {
      throw new Error('No active scan ID');
    }

    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          if (this.scanAborted) {
            await this.stopScan();
            reject(new Error('Scan aborted'));
            return;
          }

          const response = await fetch(`${this.baseUrl}/api/library/scan/status/${this.activeScanId}`);
          
          if (!response.ok) {
            throw new Error('Failed to get scan status');
          }

          const statusData = await response.json();
          const status = statusData.data;

          // Update progress
          this.scanProgress = {
            currentPath: status.currentPath || libraryPath.rootPath,
            foldersProcessed: status.foldersProcessed || 0,
            totalFolders: status.totalFolders || 0,
            filesProcessed: status.filesProcessed || 0,
            totalFiles: status.totalFiles || 0,
            percentage: status.percentage || 0,
            status: status.status || 'scanning'
          };

          if (onProgress && this.scanProgress) {
            onProgress(this.scanProgress);
          }

          // Check if scan is complete
          if (status.status === 'completed') {
            const result: ScanResult = {
              libraryPath,
              totalFolders: status.totalFolders || 0,
              totalFiles: status.totalFiles || 0,
              newFiles: status.newFiles || 0,
              missingFiles: status.missingFiles || 0,
              matchedFiles: status.matchedFiles || 0,
              unmatchedFiles: status.unmatchedFiles || 0,
              errors: status.errors || [],
              startTime: new Date(status.startTime),
              endTime: new Date(status.endTime || new Date()),
              status: 'completed'
            };
            this.activeScanId = null;
            resolve(result);
          } else if (status.status === 'failed') {
            const result: ScanResult = {
              libraryPath,
              totalFolders: 0,
              totalFiles: 0,
              newFiles: 0,
              missingFiles: 0,
              matchedFiles: 0,
              unmatchedFiles: 0,
              errors: status.errors || [{
                type: 'file_access',
                message: 'Scan failed',
                path: libraryPath.rootPath,
                timestamp: new Date()
              }],
              startTime: new Date(status.startTime),
              endTime: new Date(),
              status: 'error'
            };
            this.activeScanId = null;
            resolve(result);
          } else {
            // Continue polling
            setTimeout(poll, 1000);
          }
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  }

  /**
   * Stop the current scan
   */
  async stopScan(): Promise<boolean> {
    if (!this.activeScanId) {
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/library/scan/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scanId: this.activeScanId
        })
      });

      const result = await response.json();
      this.scanAborted = true;
      this.activeScanId = null;
      
      return result.success;
    } catch (error) {
      console.error('Failed to stop scan:', error);
      return false;
    }
  }

  /**
   * Abort current scan operation
   */
  abortScan(): void {
    this.scanAborted = true;
    if (this.scanProgress) {
      this.scanProgress.status = 'cancelled';
    }
  }

  /**
   * Get current scan progress
   */
  getScanProgress(): ScanProgress | null {
    return this.scanProgress;
  }

  /**
   * Verify library files exist using backend API
   */
  async verifyLibraryFiles(files: MediaFileInfo[]): Promise<{ verified: MediaFileInfo[], missing: MediaFileInfo[] }> {
    const verified: MediaFileInfo[] = [];
    const missing: MediaFileInfo[] = [];

    try {
      const filePaths = files.map(file => file.filePath);
      
      const response = await fetch(`${this.baseUrl}/api/library/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filePaths
        })
      });

      if (!response.ok) {
        throw new Error('Failed to verify files');
      }

      const result = await response.json();
      const verificationResults = result.data.verificationResults;

      files.forEach((file, index) => {
        const verificationResult = verificationResults[index];
        if (verificationResult?.accessible) {
          verified.push(file);
        } else {
          missing.push(file);
        }
      });

    } catch (error) {
      console.error('File verification failed:', error);
      // If verification fails, assume all files are missing to be safe
      missing.push(...files);
    }

    return { verified, missing };
  }

  /**
   * Get list of all scan operations
   */
  async listScans(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/library/scans`);
      
      if (!response.ok) {
        throw new Error('Failed to list scans');
      }

      const result = await response.json();
      return result.data.scans;
    } catch (error) {
      console.error('Failed to list scans:', error);
      return [];
    }
  }

  /**
   * Check if scanner supports the given file extension
   */
  private isVideoFile(filename: string): boolean {
    const ext = filename.toLowerCase().split('.').pop();
    return ext ? SUPPORTED_VIDEO_EXTENSIONS.includes(ext) : false;
  }

  /**
   * Check if file should be excluded based on patterns
   */
  private shouldExclude(path: string): boolean {
    const normalizedPath = path.toLowerCase();
    return DEFAULT_EXCLUDE_PATTERNS.some(pattern => {
      if (pattern.startsWith('*')) {
        return normalizedPath.endsWith(pattern.slice(1));
      }
      return normalizedPath.includes(pattern);
    });
  }
}
import axios from 'axios';
import { collection, query, where, limit, getDocs, orderBy, startAfter, DocumentSnapshot } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';

export interface ScannedFile {
  id: string;
  path: string;
  name: string;
  extension: string;
  media_type: string;
  scanId: string;
  libraryPath?: string;
  discoveredAt: Date;
  status: string;
  metadata?: {
    size: number;
    modified_time: string;
  };
  media_metadata?: any;
  parsed_info?: {
    title: string;
    year?: number;
    season?: number;
    episode?: number;
  };
}

export interface ScannedDirectory {
  id: string;
  path: string;
  name: string;
  media_type: string;
  scanId: string;
  libraryPath?: string;
  discoveredAt: Date;
  status: string;
  metadata?: {
    size: number;
    modified_time: string;
  };
}

export interface ScanResult {
  id: string;
  scanId: string;
  libraryPath: string;
  status: string;
  totalItems: number;
  processedItems: number;
  filesFound: number;
  directoriesFound: number;
  startTime: number;
  endTime?: number;
  elapsedTime: number;
  errors: any[];
}

export interface FileOperationResult {
  success: boolean;
  message: string;
  newPath?: string;
  sourcePath?: string;
  destinationPath?: string;
  operation?: string;
  movedItems?: Array<{
    source: string;
    destination: string;
    type: string;
  }>;
  itemsCount?: number;
}

class LibraryBrowserService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://your-api-domain.com/api' 
      : 'http://localhost:8082/api';
  }

  /**
   * Get scanned files from Firestore directly
   */
  async getScannedFiles(params?: {
    scanId?: string;
    libraryPath?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ files: ScannedFile[]; count: number; offset: number; limit: number }> {
    try {
      // Create base query
      let q = query(
        collection(db, 'scanned_files'),
        orderBy('discoveredAt', 'desc'),
        limit(params?.limit || 100)
      );

      // Add filters if provided
      if (params?.scanId) {
        q = query(q, where('scanId', '==', params.scanId));
      }
      if (params?.libraryPath) {
        q = query(q, where('libraryPath', '==', params.libraryPath));
      }

      const snapshot = await getDocs(q);
      const files: ScannedFile[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as ScannedFile));

      return {
        files,
        count: files.length,
        offset: params?.offset || 0,
        limit: params?.limit || 100
      };
    } catch (error) {
      console.error('Error getting scanned files:', error);
      throw error;
    }
  }

  /**
   * Get scanned directories from Firestore directly
   */
  async getScannedDirectories(params?: {
    scanId?: string;
    libraryPath?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ directories: ScannedDirectory[]; count: number; offset: number; limit: number }> {
    try {
      // Create base query
      let q = query(
        collection(db, 'scanned_directories'),
        orderBy('discoveredAt', 'desc'),
        limit(params?.limit || 100)
      );

      // Add filters if provided
      if (params?.scanId) {
        q = query(q, where('scanId', '==', params.scanId));
      }
      if (params?.libraryPath) {
        q = query(q, where('libraryPath', '==', params.libraryPath));
      }

      const snapshot = await getDocs(q);
      const directories: ScannedDirectory[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as ScannedDirectory));

      return {
        directories,
        count: directories.length,
        offset: params?.offset || 0,
        limit: params?.limit || 100
      };
    } catch (error) {
      console.error('Error getting scanned directories:', error);
      throw error;
    }
  }

  /**
   * Get scan results
   */
  async getScanResults(libraryPathId?: string): Promise<ScanResult[]> {
    try {
      // This would need to be implemented in the FirestoreService
      const response = await axios.get(`${this.baseUrl}/library/scan-results`, {
        params: { libraryPathId }
      });
      return response.data.data;
    } catch (error) {
      console.error('Error getting scan results:', error);
      throw error;
    }
  }

  /**
   * Rename a file
   */
  async renameFile(currentPath: string, newName: string): Promise<FileOperationResult> {
    try {
      const response = await axios.post(`${this.baseUrl}/files/rename`, {
        currentPath,
        newName
      });
      return response.data.data;
    } catch (error) {
      console.error('Error renaming file:', error);
      throw error;
    }
  }

  /**
   * Move a file or directory
   */
  async moveFile(
    sourcePath: string, 
    destinationPath: string, 
    mergeContents: boolean = false
  ): Promise<FileOperationResult> {
    try {
      const response = await axios.post(`${this.baseUrl}/files/move`, {
        sourcePath,
        destinationPath,
        mergeContents
      });
      return response.data.data;
    } catch (error) {
      console.error('Error moving file:', error);
      throw error;
    }
  }

  /**
   * Rename a directory
   */
  async renameDirectory(currentPath: string, newName: string): Promise<FileOperationResult> {
    try {
      const response = await axios.post(`${this.baseUrl}/files/folders/rename`, {
        currentPath,
        newName
      });
      return response.data.data;
    } catch (error) {
      console.error('Error renaming directory:', error);
      throw error;
    }
  }

  /**
   * Move a directory
   */
  async moveDirectory(
    sourcePath: string, 
    destinationPath: string, 
    mergeContents: boolean = false
  ): Promise<FileOperationResult> {
    try {
      const response = await axios.post(`${this.baseUrl}/files/folders/move`, {
        sourcePath,
        destinationPath,
        mergeContents
      });
      return response.data.data;
    } catch (error) {
      console.error('Error moving directory:', error);
      throw error;
    }
  }

  /**
   * Get directory contents (live file system listing)
   */
  async getDirectoryContents(path: string): Promise<{ files: any[]; directories: any[] }> {
    try {
      const response = await axios.post(`${this.baseUrl}/files/folders/list`, {
        path
      });
      return response.data.data;
    } catch (error) {
      console.error('Error getting directory contents:', error);
      throw error;
    }
  }

  /**
   * Check if a path exists
   */
  async pathExists(path: string): Promise<boolean> {
    try {
      const response = await axios.post(`${this.baseUrl}/files/path/exists`, {
        path
      });
      return response.data.data.exists;
    } catch (error) {
      console.error('Error checking path existence:', error);
      return false;
    }
  }

  /**
   * Get children of a specific folder from Firestore
   */
  async getFolderChildren(folderPath: string): Promise<{ files: ScannedFile[]; directories: ScannedDirectory[] }> {
    try {
      // Get files in this folder
      const filesQuery = query(
        collection(db, 'scanned_files'),
        where('path', '>=', folderPath),
        where('path', '<', folderPath + '\uffff'),
        orderBy('path', 'asc')
      );

      // Get directories in this folder
      const dirsQuery = query(
        collection(db, 'scanned_directories'),
        where('path', '>=', folderPath),
        where('path', '<', folderPath + '\uffff'),
        orderBy('path', 'asc')
      );

      const [filesSnapshot, dirsSnapshot] = await Promise.all([
        getDocs(filesQuery),
        getDocs(dirsQuery)
      ]);

      const files: ScannedFile[] = filesSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as ScannedFile))
        .filter(file => {
          // Only include direct children (not nested subdirectory contents)
          const relativePath = file.path.substring(folderPath.length);
          return relativePath.split('/').filter(Boolean).length === 1;
        });

      const directories: ScannedDirectory[] = dirsSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as ScannedDirectory))
        .filter(dir => {
          // Only include direct children
          const relativePath = dir.path.substring(folderPath.length);
          return relativePath.split('/').filter(Boolean).length === 1;
        });

      return { files, directories };
    } catch (error) {
      console.error('Error getting folder children:', error);
      throw error;
    }
  }

  /**
   * Move multiple items (files and folders) to a destination folder
   */
  async moveMultipleItems(
    items: Array<{id: string, path: string, type: 'file' | 'directory'}>, 
    destinationPath: string,
    mergeContents: boolean = true
  ): Promise<FileOperationResult[]> {
    try {
      // Use bulk move for better performance if backend supports it
      const sourcePaths = items.map(item => item.path);
      
      try {
        const bulkResult = await this.bulkMove(sourcePaths, destinationPath, mergeContents);
        
        // Convert bulk result to individual results format
        const results: FileOperationResult[] = [];
        
        if (bulkResult.successful_moves) {
          bulkResult.successful_moves.forEach((move: any) => {
            results.push({
              success: true,
              sourcePath: move.source_path || move.source,
              destinationPath: move.destination_path || move.destination,
              operation: move.operation || 'move',
              message: 'Move successful'
            });
          });
        }
        
        if (bulkResult.failed_moves) {
          bulkResult.failed_moves.forEach((failure: any) => {
            results.push({
              success: false,
              sourcePath: failure.source_path,
              message: `Failed to move: ${failure.error}`,
              operation: 'move'
            });
          });
        }
        
        return results;
      } catch (bulkError) {
        console.warn('Bulk move failed, falling back to individual moves:', bulkError);
        
        // Fallback to individual moves
        const results: FileOperationResult[] = [];

        for (const item of items) {
          try {
            let result: FileOperationResult;
            
            if (item.type === 'file') {
              // Extract filename from path
              const fileName = item.path.split(/[/\\]/).pop() || '';
              const newPath = destinationPath + '/' + fileName;
              result = await this.moveFile(item.path, newPath, mergeContents);
            } else {
              // Extract folder name from path
              const folderName = item.path.split(/[/\\]/).pop() || '';
              const newPath = destinationPath + '/' + folderName;
              result = await this.moveDirectory(item.path, newPath, mergeContents);
            }
            
            results.push(result);
          } catch (error) {
            results.push({
              success: false,
              message: `Failed to move ${item.path}: ${error}`
            });
          }
        }

        return results;
      }
    } catch (error) {
      console.error('Error moving multiple items:', error);
      throw error;
    }
  }

  /**
   * Bulk move multiple files/folders using the optimized backend endpoint
   */
  async bulkMove(
    sourcePaths: string[], 
    destinationPath: string, 
    mergeContents: boolean = true
  ): Promise<any> {
    try {
      const response = await axios.post(`${this.baseUrl}/files/bulk/move`, {
        sourcePaths,
        destinationPath,
        mergeContents
      });
      return response.data.data;
    } catch (error) {
      console.error('Error in bulk move:', error);
      throw error;
    }
  }

  /**
   * Get all root folders from a library path
   */
  async getRootFolders(libraryPath: string): Promise<ScannedDirectory[]> {
    try {
      const query = {
        libraryPath,
        // Only get direct children of the library path
        parentPath: libraryPath
      };

      const dirsQuery = collection(db, 'scanned_directories');
      const snapshot = await getDocs(dirsQuery);

      const allDirs: ScannedDirectory[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as ScannedDirectory));

      // Filter to only root folders (direct children of library path)
      const rootFolders = allDirs.filter(dir => {
        const relativePath = dir.path.substring(libraryPath.length);
        const pathParts = relativePath.split(/[/\\]/).filter(Boolean);
        return pathParts.length === 1; // Only direct children
      });

      return rootFolders;
    } catch (error) {
      console.error('Error getting root folders:', error);
      throw error;
    }
  }
}

export default LibraryBrowserService;
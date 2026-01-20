import { MediaFileInfo, FolderStructure } from '../../types/library/LibraryTypes';

/**
 * Service for file system operations including file/folder renaming, moving, and validation
 */
export class FileSystemService {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8082') {
    this.baseUrl = baseUrl;
  }

  /**
   * Rename a file while preserving the extension
   */
  async renameFile(currentPath: string, newName: string, preserveExtension: boolean = true): Promise<{ success: boolean; newPath?: string; error?: string }> {
    try {
      const extension = preserveExtension ? this.getFileExtension(currentPath) : '';
      const finalName = preserveExtension && extension ? `${newName}${extension}` : newName;
      
      const response = await fetch(`${this.baseUrl}/files/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPath,
          newName: finalName
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.error || 'Failed to rename file'
        };
      }

      const result = await response.json();
      return {
        success: true,
        newPath: result.newPath
      };
    } catch (error) {
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Rename a folder
   */
  async renameFolder(currentPath: string, newName: string): Promise<{ success: boolean; newPath?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/folders/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPath,
          newName
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.error || 'Failed to rename folder'
        };
      }

      const result = await response.json();
      return {
        success: true,
        newPath: result.newPath
      };
    } catch (error) {
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Move a file to a new location
   */
  async moveFile(sourcePath: string, destinationPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/files/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourcePath,
          destinationPath
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.error || 'Failed to move file'
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Move a folder to a new location
   */
  async moveFolder(sourcePath: string, destinationPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/folders/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourcePath,
          destinationPath
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.error || 'Failed to move folder'
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Create a new folder
   */
  async createFolder(parentPath: string, folderName: string): Promise<{ success: boolean; folderPath?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/folders/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parentPath,
          folderName
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.error || 'Failed to create folder'
        };
      }

      const result = await response.json();
      return {
        success: true,
        folderPath: result.folderPath
      };
    } catch (error) {
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/files/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filePath
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.error || 'Failed to delete file'
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(path: string): Promise<{ 
    success: boolean; 
    items?: { name: string; isDirectory: boolean; size?: number; lastModified?: Date }[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/folders/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.error || 'Failed to list directory'
        };
      }

      const result = await response.json();
      return {
        success: true,
        items: result.items
      };
    } catch (error) {
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Check if a path exists
   */
  async pathExists(path: string): Promise<{ exists: boolean; isDirectory?: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/path/exists`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          exists: false,
          error: errorData.error || 'Failed to check path'
        };
      }

      const result = await response.json();
      return {
        exists: result.exists,
        isDirectory: result.isDirectory
      };
    } catch (error) {
      return {
        exists: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get file metadata including size, creation date, etc.
   */
  async getFileMetadata(filePath: string): Promise<{
    success: boolean;
    metadata?: {
      size: number;
      lastModified: Date;
      created: Date;
      extension: string;
    };
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/files/metadata`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filePath })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.error || 'Failed to get file metadata'
        };
      }

      const result = await response.json();
      return {
        success: true,
        metadata: {
          size: result.size,
          lastModified: new Date(result.lastModified),
          created: new Date(result.created),
          extension: result.extension
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Validate file name for file system compatibility
   */
  validateFileName(fileName: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(fileName)) {
      errors.push('File name contains invalid characters: < > : " / \\ | ? *');
    }

    // Check for reserved names (Windows)
    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    const nameWithoutExtension = fileName.replace(/\.[^/.]+$/, '');
    if (reservedNames.includes(nameWithoutExtension.toUpperCase())) {
      errors.push('File name is a reserved system name');
    }

    // Check length
    if (fileName.length > 255) {
      errors.push('File name is too long (maximum 255 characters)');
    }

    if (fileName.trim().length === 0) {
      errors.push('File name cannot be empty');
    }

    // Check for trailing dots or spaces
    if (fileName.endsWith('.') || fileName.endsWith(' ')) {
      errors.push('File name cannot end with a dot or space');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Suggest a valid file name based on media metadata
   */
  suggestFileName(title: string, year?: number, season?: number, episode?: number, extension?: string): string {
    let suggestedName = this.sanitizeFileName(title);

    if (year) {
      suggestedName += ` (${year})`;
    }

    if (season !== undefined && episode !== undefined) {
      const seasonStr = season.toString().padStart(2, '0');
      const episodeStr = episode.toString().padStart(2, '0');
      suggestedName += ` S${seasonStr}E${episodeStr}`;
    }

    if (extension) {
      suggestedName += extension.startsWith('.') ? extension : `.${extension}`;
    }

    return suggestedName;
  }

  /**
   * Suggest a valid folder name based on media metadata
   */
  suggestFolderName(title: string, year?: number, season?: number): string {
    let suggestedName = this.sanitizeFileName(title);

    if (year && !season) {
      suggestedName += ` (${year})`;
    }

    if (season !== undefined) {
      const seasonStr = season.toString().padStart(2, '0');
      suggestedName = `Season ${seasonStr}`;
    }

    return suggestedName;
  }

  /**
   * Update file paths after a rename or move operation
   */
  updateMediaFileInfo(fileInfo: MediaFileInfo, newPath: string): MediaFileInfo {
    return {
      ...fileInfo,
      filePath: newPath,
      fileName: this.getFileName(newPath),
      fileExtension: this.getFileExtension(newPath),
      lastScanned: new Date()
    };
  }

  /**
   * Update folder structure after a rename or move operation
   */
  updateFolderStructure(folder: FolderStructure, newPath: string): FolderStructure {
    return {
      ...folder,
      rootPath: newPath,
      folderName: this.getFolderName(newPath),
      // Update all file paths within the folder
      files: folder.files.map(file => {
        const relativePath = file.filePath.replace(folder.rootPath, '');
        const newFilePath = newPath + relativePath;
        return this.updateMediaFileInfo(file, newFilePath);
      })
    };
  }

  // Private helper methods

  private sanitizeFileName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
      .replace(/\.$/, '')          // Remove trailing dot
      .replace(/\s+$/, '')         // Remove trailing spaces
      .replace(/\s+/g, ' ')        // Normalize spaces
      .trim();
  }

  private getFileExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot >= 0 ? filePath.substring(lastDot) : '';
  }

  private getFileName(filePath: string): string {
    return filePath.split(/[/\\]/).pop() || '';
  }

  private getFolderName(path: string): string {
    return path.split(/[/\\]/).pop() || '';
  }
}

export default FileSystemService;
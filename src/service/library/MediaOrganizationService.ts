/**
 * Media Organization Service
 * Handles Jellyfin-compliant folder organization and file assignment
 * Based on DATA_STRUCTURE_REDESIGN.md Phase 3
 */

import { 
  MediaAssignment, 
  TargetFolderStructure, 
  OrganizationOperation,
  AssignmentOrganizationStatus 
} from '../../types/library/MediaAssignment.type';
import { MediaFile } from '../../types/library/MediaFile.type';
import { JellyfinFolder } from '../../types/library/JellyfinFolder.type';
import { Movie } from '../../types/collections/Movie.type';
import { Episode } from '../../types/collections/Episode.type';
import { Series } from '../../types/collections/Series.type';
import { Season } from '../../types/collections/Season.type';
import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  getDoc, 
  getDocs, 
  query, 
  where 
} from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import axios from 'axios';

interface OrganizationResult {
  success: boolean;
  foldersCreated: string[];
  filesMoved: number;
  errors: string[];
  jellyfinFolderId?: string;
}

class MediaOrganizationService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://your-api-domain.com/api' 
      : 'http://localhost:8082';
  }

  /**
   * Check if backend service is available and healthy
   */
  async checkBackendHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, {
        timeout: 5000
      });
      return response.data.status === 'healthy';
    } catch (error) {
      console.error('Backend health check failed:', error);
      return false;
    }
  }

  /**
   * Generate Jellyfin-compliant folder structure for movie
   * Format: "Movie Title (Year) [imdbid-tt1234567]"
   */
  generateMovieStructure(
    movie: Movie, 
    file: MediaFile, 
    version?: string,
    libraryRoot?: string
  ): TargetFolderStructure {
    let folderName = this.sanitizeFilename(movie.title);
    
    // Add year if available
    if (movie.releaseDate) {
      const year = new Date(movie.releaseDate).getFullYear();
      folderName += ` (${year})`;
    }
    
    // Add IMDB ID if available
    if (movie.externalIds?.imdbId) {
      folderName += ` [imdbid-${movie.externalIds.imdbId}]`;
    }
    
    // Generate filename
    let filename = folderName;
    if (version) {
      filename += ` - ${version}`;
    }
    filename += file.fileExtension;
    
    const root = libraryRoot || this.extractLibraryRoot(file.folderPath);
    const mediaFolder = `${root}/${folderName}`;
    
    return {
      libraryRoot: root,
      mediaFolder: folderName,
      fullPath: `${mediaFolder}/${filename}`,
      folderName,
      fileName: filename
    };
  }

  /**
   * Generate Jellyfin-compliant folder structure for episode
   * Format: "Series Name (Year)/Season 01/Series Name (Year) S01E01 Title.mkv"
   */
  generateEpisodeStructure(
    series: Series,
    season: Season,
    episode: Episode,
    file: MediaFile,
    libraryRoot?: string
  ): TargetFolderStructure {
    // Series folder
    let seriesFolder = this.sanitizeFilename(series.title);
    
    if (series.runningYears?.length > 0) {
      seriesFolder += ` (${series.runningYears[0]})`;
    }
    
    if (series.externalIds?.imdbId) {
      seriesFolder += ` [imdbid-${series.externalIds.imdbId}]`;
    }
    
    // Season folder with zero-padding
    const seasonFolder = `Season ${season.seasonNumber.toString().padStart(2, '0')}`;
    
    // Episode filename
    const episodeNum = episode.episodeNumber.toString().padStart(2, '0');
    const seasonNum = season.seasonNumber.toString().padStart(2, '0');
    let filename = `${seriesFolder} S${seasonNum}E${episodeNum}`;
    
    if (episode.title) {
      filename += ` ${this.sanitizeFilename(episode.title)}`;
    }
    
    filename += file.fileExtension;
    
    const root = libraryRoot || this.extractLibraryRoot(file.folderPath);
    const mediaFolder = `${root}/${seriesFolder}/${seasonFolder}`;
    
    return {
      libraryRoot: root,
      mediaFolder: `${seriesFolder}/${seasonFolder}`,
      fullPath: `${mediaFolder}/${filename}`,
      folderName: seriesFolder,
      fileName: filename
    };
  }

  /**
   * Create Jellyfin folder entry in database
   */
  async createJellyfinFolder(
    assignment: MediaAssignment,
    mediaData: Movie | Series
  ): Promise<JellyfinFolder> {
    const isMovie = assignment.mediaType === 'movie';
    
    const jellyfinFolder: Omit<JellyfinFolder, 'id'> = {
      folderPath: assignment.targetFolderStructure.fullPath,
      folderName: assignment.targetFolderStructure.folderName,
      folderType: isMovie ? 'movie' : 'series',
      mediaType: isMovie ? 'movie' : 'series',
      mediaId: assignment.mediaId,
      mediaTitle: (mediaData as any).title,
      year: isMovie 
        ? new Date((mediaData as Movie).releaseDate).getFullYear()
        : (mediaData as Series).runningYears?.length > 0 
          ? parseInt((mediaData as Series).runningYears[0]) 
          : undefined,
      imdbId: (mediaData as any).externalIds?.imdbId,
      jellyfinName: assignment.targetFolderStructure.folderName,
      videoFiles: [assignment.targetFolderStructure.fileName],
      subtitleFiles: [],
      audioFiles: [],
      imageFiles: [],
      extraFolders: [],
      createdDate: new Date(),
      lastVerified: new Date(),
      isValid: true,
      validationErrors: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Only add seasonNumber for episodes
    if (!isMovie && assignment.seasonNumber !== undefined) {
      (jellyfinFolder as any).seasonNumber = assignment.seasonNumber;
    }

    const folderRef = await addDoc(collection(db, 'jellyfin_folders'), jellyfinFolder);
    return { id: folderRef.id, ...jellyfinFolder };
  }

  /**
   * Organize files according to assignment
   */
  async organizeFiles(assignmentId: string): Promise<OrganizationResult> {
    try {
      // Check backend health before proceeding
      const isHealthy = await this.checkBackendHealth();
      if (!isHealthy) {
        throw new Error('Backend service is not available. Please ensure the Python backend is running on http://localhost:8082');
      }

      const assignmentDoc = await getDoc(doc(db, 'media_assignments', assignmentId));
      if (!assignmentDoc.exists()) {
        throw new Error('Assignment not found');
      }

      const assignment = { id: assignmentDoc.id, ...assignmentDoc.data() } as MediaAssignment;
      const { targetFolderStructure, mediaFileIds } = assignment;

      // Update status to in_progress
      await updateDoc(doc(db, 'media_assignments', assignmentId), {
        organizationStatus: 'in_progress' as AssignmentOrganizationStatus,
        updatedAt: new Date()
      });

      const operations: OrganizationOperation[] = [];
      const foldersCreated: string[] = [];
      const errors: string[] = [];
      let filesMoved = 0;

      try {
        // Step 1: Create folder structure
        const createFolderResponse = await axios.post(`${this.baseUrl}/api/files/folders/create`, {
          parentPath: targetFolderStructure.libraryRoot,
          folderName: targetFolderStructure.mediaFolder
        });

        if (createFolderResponse.data.success) {
          foldersCreated.push(createFolderResponse.data.data.folderPath);
          operations.push({
            timestamp: new Date(),
            operation: 'create_folder',
            sourcePath: '',
            destinationPath: createFolderResponse.data.data.folderPath,
            status: 'success'
          });
        }

        // Step 2: Move each file
        for (const fileId of mediaFileIds) {
          try {
            const fileDoc = await getDoc(doc(db, 'scanned_files', fileId));
            if (!fileDoc.exists()) {
              errors.push(`File not found: ${fileId}`);
              continue;
            }

            const file = fileDoc.data();
            const sourcePath = file.path || file.filePath;
            
            // Build destination path properly
            const destinationPath = `${targetFolderStructure.libraryRoot}\\${targetFolderStructure.mediaFolder}\\${targetFolderStructure.fileName}`;
            
            const moveResponse = await axios.post(`${this.baseUrl}/api/files/move`, {
              sourcePath: sourcePath,
              destinationPath: destinationPath,
              mergeContents: false
            });

            if (moveResponse.data.success) {
              filesMoved++;
              operations.push({
                timestamp: new Date(),
                operation: 'move_file',
                sourcePath: sourcePath,
                destinationPath: destinationPath,
                status: 'success'
              });

              // Update file path in scanned_files
              await updateDoc(doc(db, 'scanned_files', fileId), {
                path: destinationPath,
                organizationStatus: 'completed',
                updatedAt: new Date()
              });
            } else {
              const errorMsg = moveResponse.data.error?.message || 'Unknown error';
              errors.push(`Failed to move ${file.name}: ${errorMsg}`);
              operations.push({
                timestamp: new Date(),
                operation: 'move_file',
                sourcePath: sourcePath,
                destinationPath: destinationPath,
                status: 'failed',
                errorMessage: errorMsg
              });
            }
          } catch (fileError: any) {
            errors.push(`Error processing file ${fileId}: ${fileError.message}`);
            operations.push({
              timestamp: new Date(),
              operation: 'move_file',
              sourcePath: 'unknown',
              destinationPath: targetFolderStructure.fullPath,
              status: 'failed',
              errorMessage: fileError.message
            });
          }
        }

        // Step 3: Create Jellyfin folder entry
        let jellyfinFolderId: string | undefined;
        if (filesMoved > 0) {
          const mediaDoc = await getDoc(
            doc(db, assignment.mediaType === 'movie' ? 'movies' : 'series', assignment.mediaId)
          );
          
          if (mediaDoc.exists()) {
            const jellyfinFolder = await this.createJellyfinFolder(
              assignment, 
              mediaDoc.data() as any
            );
            jellyfinFolderId = jellyfinFolder.id;
          }
        }

        // Step 4: Update assignment
        const updateData: any = {
          organizationStatus: errors.length === 0 ? 'completed' : 'failed' as AssignmentOrganizationStatus,
          organizationDate: new Date(),
          operations,
          updatedAt: new Date()
        };
        
        // Only include organizationError if there are errors
        if (errors.length > 0) {
          updateData.organizationError = errors.join('; ');
        }
        
        await updateDoc(doc(db, 'media_assignments', assignmentId), updateData);

        return {
          success: errors.length === 0,
          foldersCreated,
          filesMoved,
          errors,
          jellyfinFolderId
        };

      } catch (error: any) {
        await updateDoc(doc(db, 'media_assignments', assignmentId), {
          organizationStatus: 'failed' as AssignmentOrganizationStatus,
          organizationError: error.message,
          updatedAt: new Date()
        });
        throw error;
      }
    } catch (error) {
      console.error('Error organizing files:', error);
      throw error;
    }
  }

  /**
   * Validate Jellyfin folder structure
   */
  async validateJellyfinStructure(folderId: string): Promise<{isValid: boolean; errors: string[]}> {
    const folderDoc = await getDoc(doc(db, 'jellyfin_folders', folderId));
    if (!folderDoc.exists()) {
      return { isValid: false, errors: ['Folder not found'] };
    }

    const folder = folderDoc.data() as JellyfinFolder;
    const errors: string[] = [];

    // Check naming format
    if (!folder.folderName.includes('(') || !folder.folderName.includes(')')) {
      errors.push('Missing year in folder name');
    }

    // Check for video files
    if (folder.videoFiles.length === 0) {
      errors.push('No video files in folder');
    }

    // Validate file exists via backend
    try {
      // This would call backend to verify file exists
      // For now, we'll assume it's valid
    } catch (error) {
      errors.push('Failed to verify file existence');
    }

    const isValid = errors.length === 0;

    // Update folder validation status
    await updateDoc(doc(db, 'jellyfin_folders', folderId), {
      isValid,
      validationErrors: errors,
      lastVerified: new Date(),
      updatedAt: new Date()
    });

    return { isValid, errors };
  }

  /**
   * Sanitize filename for filesystem
   */
  private sanitizeFilename(name: string): string {
    // Remove invalid characters: < > : " / \ | ? *
    return name.replace(/[<>:"/\\|?*]/g, '').trim();
  }

  /**
   * Extract library root from current path
   */
  private extractLibraryRoot(folderPath: string): string {
    // Simplified - in production, query library_paths collection
    const parts = folderPath.split(/[\\/]/);
    return parts.slice(0, -1).join('/');
  }

  /**
   * Get all Jellyfin folders for a media item
   */
  async getJellyfinFolders(mediaType: 'movie' | 'series', mediaId: string): Promise<JellyfinFolder[]> {
    const q = query(
      collection(db, 'jellyfin_folders'),
      where('mediaType', '==', mediaType),
      where('mediaId', '==', mediaId)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JellyfinFolder));
  }
}

export default MediaOrganizationService;

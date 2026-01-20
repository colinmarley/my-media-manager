/**
 * Media Assignment Service
 * 
 * Service for assigning scanned files to OMDB/TVDB media data,
 * generating properly formatted filenames, and managing file operations.
 */

import axios from 'axios';
import { 
  FileAssignment, 
  MediaSearchParams, 
  MediaSuggestion, 
  NamingFormat, 
  DEFAULT_NAMING_FORMATS,
  FolderStructureTemplate,
  DEFAULT_FOLDER_STRUCTURES,
  MediaAssignmentType,
  FileOperationRequest,
  FileOperationResponse,
  BatchAssignmentOperation,
  BatchOperationResult,
  BatchOperationSummary
} from '../../types/library/MediaAssignment';
import { ScannedFile } from './LibraryBrowserService';
import { OmdbResponseFull, OmdbSearchResponse } from '../../types/OmdbResponse.type';
import { searchByText, retrieveMediaDataById, retrieveMovieDataByTitle, retrieveShowDataByTitle } from '../omdb/OmdbService';

class MediaAssignmentService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://your-api-domain.com/api'
      : 'http://localhost:8082/api';
  }

  /**
   * Search for media data using OMDB
   */
  async searchMedia(params: MediaSearchParams): Promise<MediaSuggestion[]> {
    try {
      const suggestions: MediaSuggestion[] = [];

      // Search by IMDb ID if provided
      if (params.imdbId) {
        const data = await retrieveMediaDataById(params.imdbId);
        suggestions.push({
          source: 'omdb',
          data: {
            Title: data.Title,
            Year: data.Year,
            imdbID: data.imdbID,
            Type: data.Type,
            Poster: data.Poster
          },
          confidence: 100,
          matchReason: 'IMDb ID match',
          type: data.Type === 'movie' ? 'movie' : data.Type === 'series' ? 'series' : 'episode'
        });
        return suggestions;
      }

      // Search by text
      const results = await searchByText(params.query);
      
      for (const result of results) {
        // Calculate confidence based on various factors
        let confidence = 70; // Base confidence for text search
        
        // Boost confidence if year matches
        if (params.year && result.Year === params.year.toString()) {
          confidence += 20;
        }
        
        // Boost confidence if type matches
        if (params.type && result.Type === params.type) {
          confidence += 10;
        }

        const matchReasons: string[] = [];
        if (params.year && result.Year === params.year.toString()) {
          matchReasons.push('Year match');
        }
        if (params.type && result.Type === params.type) {
          matchReasons.push('Type match');
        }
        if (matchReasons.length === 0) {
          matchReasons.push('Title match');
        }

        suggestions.push({
          source: 'omdb',
          data: result,
          confidence: Math.min(confidence, 100),
          matchReason: matchReasons.join(', '),
          type: result.Type === 'movie' ? 'movie' : result.Type === 'series' ? 'series' : 'episode'
        });
      }

      // Sort by confidence
      return suggestions.sort((a, b) => b.confidence - a.confidence);
    } catch (error) {
      console.error('Error searching media:', error);
      throw error;
    }
  }

  /**
   * Get full media data by IMDb ID
   */
  async getMediaData(imdbId: string): Promise<OmdbResponseFull> {
    return retrieveMediaDataById(imdbId);
  }

  /**
   * Get series data for episode assignment
   */
  async getSeriesData(seriesTitle: string): Promise<OmdbResponseFull> {
    return retrieveShowDataByTitle(seriesTitle);
  }

  /**
   * Parse filename to extract media information
   */
  parseFilename(filename: string): {
    title: string;
    year?: number;
    season?: number;
    episode?: number;
    type: MediaAssignmentType;
  } {
    // Remove extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

    // Try to match episode pattern (S##E##)
    const episodeMatch = nameWithoutExt.match(/S(\d{1,2})E(\d{1,2})/i);
    if (episodeMatch) {
      const season = parseInt(episodeMatch[1], 10);
      const episode = parseInt(episodeMatch[2], 10);
      const title = nameWithoutExt.substring(0, episodeMatch.index).trim();
      
      return {
        title: title.replace(/[._-]/g, ' ').trim(),
        season,
        episode,
        type: 'episode'
      };
    }

    // Try to match year pattern (####)
    const yearMatch = nameWithoutExt.match(/\((\d{4})\)/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1], 10);
      const title = nameWithoutExt.substring(0, yearMatch.index).trim();
      
      return {
        title: title.replace(/[._-]/g, ' ').trim(),
        year,
        type: 'movie'
      };
    }

    // Default to movie type if no pattern matches
    return {
      title: nameWithoutExt.replace(/[._-]/g, ' ').trim(),
      type: 'movie'
    };
  }

  /**
   * Generate formatted filename based on media data and naming format
   */
  generateFilename(
    assignment: FileAssignment,
    format?: NamingFormat
  ): string {
    const namingFormat = format || DEFAULT_NAMING_FORMATS[assignment.assignmentType || 'movie'];
    const omdbData = assignment.omdbData;
    
    if (!omdbData) {
      throw new Error('No OMDB data available for filename generation');
    }

    let filename = namingFormat.template;
    const extension = assignment.file.extension;

    // Apply case style to title
    const applyCase = (text: string): string => {
      switch (namingFormat.options.caseStyle) {
        case 'title':
          return text.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          ).join(' ');
        case 'upper':
          return text.toUpperCase();
        case 'lower':
          return text.toLowerCase();
        default:
          return text;
      }
    };

    // Replace placeholders
    if (assignment.assignmentType === 'movie') {
      filename = filename
        .replace('{title}', applyCase(omdbData.Title))
        .replace('{year}', omdbData.Year);
    } else if (assignment.assignmentType === 'episode') {
      const seriesTitle = assignment.seriesData?.Title || omdbData.Title;
      const season = assignment.seasonNumber?.toString().padStart(2, '0') || '01';
      const episode = assignment.episodeNumber?.toString().padStart(2, '0') || '01';
      
      filename = filename
        .replace('{series}', applyCase(seriesTitle))
        .replace('{season}', season)
        .replace('{episode}', episode)
        .replace('{title}', applyCase(omdbData.Title));
    } else if (assignment.assignmentType === 'series') {
      filename = filename
        .replace('{title}', applyCase(omdbData.Title))
        .replace('{year}', omdbData.Year);
    }

    // Add extension
    return `${filename}${extension}`;
  }

  /**
   * Generate folder path based on media data and folder structure template
   */
  generateFolderPath(
    assignment: FileAssignment,
    libraryRoot: string,
    template?: FolderStructureTemplate
  ): string {
    const folderTemplate = template || DEFAULT_FOLDER_STRUCTURES[assignment.assignmentType || 'movie'];
    const omdbData = assignment.omdbData;
    
    if (!omdbData) {
      throw new Error('No OMDB data available for folder generation');
    }

    let folderPath = folderTemplate.template;

    // Replace placeholders
    if (assignment.assignmentType === 'movie') {
      folderPath = folderPath
        .replace('{libraryRoot}', libraryRoot)
        .replace('{title}', omdbData.Title)
        .replace('{year}', omdbData.Year);
    } else if (assignment.assignmentType === 'episode') {
      const seriesTitle = assignment.seriesData?.Title || omdbData.Title;
      const season = assignment.seasonNumber?.toString().padStart(2, '0') || '01';
      const seriesYear = assignment.seriesData?.Year || omdbData.Year;
      
      folderPath = folderPath
        .replace('{libraryRoot}', libraryRoot)
        .replace('{series}', seriesTitle)
        .replace('{year}', seriesYear)
        .replace('{season}', season);
    } else if (assignment.assignmentType === 'series') {
      folderPath = folderPath
        .replace('{libraryRoot}', libraryRoot)
        .replace('{title}', omdbData.Title)
        .replace('{year}', omdbData.Year);
    }

    // Normalize path separators
    return folderPath.replace(/\\/g, '/');
  }

  /**
   * Generate full proposed path (folder + filename)
   */
  generateProposedPath(
    assignment: FileAssignment,
    libraryRoot: string,
    namingFormat?: NamingFormat,
    folderTemplate?: FolderStructureTemplate
  ): { filename: string; folder: string; fullPath: string } {
    const filename = this.generateFilename(assignment, namingFormat);
    const folder = this.generateFolderPath(assignment, libraryRoot, folderTemplate);
    const fullPath = `${folder}${filename}`;

    return { filename, folder, fullPath };
  }

  /**
   * Validate file assignment
   */
  validateAssignment(assignment: FileAssignment): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!assignment.omdbData) {
      errors.push('No OMDB data assigned');
    }

    if (!assignment.assignmentType) {
      errors.push('No assignment type specified');
    }

    if (assignment.assignmentType === 'episode') {
      if (!assignment.seasonNumber) {
        errors.push('Season number required for episodes');
      }
      if (!assignment.episodeNumber) {
        errors.push('Episode number required for episodes');
      }
      if (!assignment.seriesData) {
        errors.push('Series data required for episodes');
      }
    }

    if (assignment.proposedName && !this.isValidFilename(assignment.proposedName)) {
      errors.push('Invalid proposed filename (contains illegal characters)');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if filename is valid (no illegal characters)
   */
  private isValidFilename(filename: string): boolean {
    // Check for illegal characters in Windows/Unix
    const illegalChars = /[<>:"/\\|?*\x00-\x1F]/;
    return !illegalChars.test(filename);
  }

  /**
   * Rename file via backend API
   */
  async renameFile(request: FileOperationRequest): Promise<FileOperationResponse> {
    try {
      const response = await axios.post(`${this.baseUrl}/file-operations/rename`, {
        file_id: request.fileId,
        new_name: request.newName
      });

      return {
        success: response.data.success,
        fileId: request.fileId,
        operation: 'rename',
        originalPath: response.data.old_path || '',
        newPath: response.data.new_path,
        error: response.data.error,
        timestamp: new Date()
      };
    } catch (error: any) {
      return {
        success: false,
        fileId: request.fileId,
        operation: 'rename',
        originalPath: '',
        error: error.message || 'Failed to rename file',
        timestamp: new Date()
      };
    }
  }

  /**
   * Move file via backend API
   */
  async moveFile(request: FileOperationRequest): Promise<FileOperationResponse> {
    try {
      const response = await axios.post(`${this.baseUrl}/file-operations/move`, {
        file_id: request.fileId,
        target_path: request.targetPath,
        create_folder: request.createFolder || false
      });

      return {
        success: response.data.success,
        fileId: request.fileId,
        operation: 'move',
        originalPath: response.data.source_path || '',
        newPath: response.data.destination_path,
        error: response.data.error,
        timestamp: new Date()
      };
    } catch (error: any) {
      return {
        success: false,
        fileId: request.fileId,
        operation: 'move',
        originalPath: '',
        error: error.message || 'Failed to move file',
        timestamp: new Date()
      };
    }
  }

  /**
   * Execute batch assignment operation
   */
  async executeBatchOperation(
    operation: BatchAssignmentOperation
  ): Promise<BatchAssignmentOperation> {
    const startTime = new Date();
    const results: BatchOperationResult[] = [];

    for (const assignment of operation.files) {
      try {
        let result: BatchOperationResult = {
          fileId: assignment.file.id,
          fileName: assignment.file.name,
          success: false,
          originalPath: assignment.file.path,
          operation: operation.operation
        };

        if (operation.dryRun) {
          // Dry run - just validate and preview
          const validation = this.validateAssignment(assignment);
          result.success = validation.valid;
          if (!validation.valid) {
            result.error = validation.errors.join('; ');
          } else {
            result.newPath = assignment.proposedPath;
          }
        } else {
          // Execute actual operation
          switch (operation.operation) {
            case 'rename':
              if (assignment.proposedName) {
                const response = await this.renameFile({
                  fileId: assignment.file.id,
                  operation: 'rename',
                  newName: assignment.proposedName
                });
                result.success = response.success;
                result.newPath = response.newPath;
                result.error = response.error;
              }
              break;

            case 'move':
              if (assignment.proposedPath) {
                const response = await this.moveFile({
                  fileId: assignment.file.id,
                  operation: 'move',
                  targetPath: assignment.proposedPath,
                  createFolder: operation.createFolders
                });
                result.success = response.success;
                result.newPath = response.newPath;
                result.error = response.error;
              }
              break;

            default:
              result.error = `Unsupported operation: ${operation.operation}`;
          }
        }

        results.push(result);

        if (!result.success && !operation.continueOnError) {
          break;
        }
      } catch (error: any) {
        results.push({
          fileId: assignment.file.id,
          fileName: assignment.file.name,
          success: false,
          originalPath: assignment.file.path,
          operation: operation.operation,
          error: error.message || 'Operation failed'
        });

        if (!operation.continueOnError) {
          break;
        }
      }
    }

    const endTime = new Date();
    const summary: BatchOperationSummary = {
      total: operation.files.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      skipped: operation.files.length - results.length,
      errors: results.filter(r => !r.success).map(r => ({
        fileId: r.fileId,
        error: r.error || 'Unknown error'
      })),
      startTime,
      endTime,
      durationMs: endTime.getTime() - startTime.getTime()
    };

    return {
      ...operation,
      results,
      summary
    };
  }

  /**
   * Create file assignment from scanned file
   */
  createAssignment(file: ScannedFile): FileAssignment {
    // Parse filename to get initial data
    const parsed = this.parseFilename(file.name);

    return {
      file,
      status: 'unassigned',
      assignmentType: parsed.type,
      seasonNumber: parsed.season,
      episodeNumber: parsed.episode,
      confidence: 0,
      suggestions: [],
      validationErrors: []
    };
  }

  /**
   * Auto-suggest matches for a file based on its filename
   */
  async autoSuggestMatches(file: ScannedFile): Promise<MediaSuggestion[]> {
    const parsed = this.parseFilename(file.name);
    
    return this.searchMedia({
      query: parsed.title,
      type: parsed.type,
      year: parsed.year,
      season: parsed.season,
      episode: parsed.episode
    });
  }
}

export default MediaAssignmentService;

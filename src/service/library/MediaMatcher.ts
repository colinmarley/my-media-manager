import { MediaFileInfo, MediaMatch, MatchSuggestion } from '../../types/library/LibraryTypes';
import { Movie } from '../../types/collections/Movie.type';
import { Series } from '../../types/collections/Series.type';
import { retrieveMovieDataByTitle, retrieveShowDataByTitle } from '../omdb/OmdbService';

/**
 * Service for matching discovered media files with database entries
 */
export class MediaMatcher {
  private matchThreshold: number;

  constructor(matchThreshold: number = 80) {
    this.matchThreshold = matchThreshold;
  }

  /**
   * Match a file against existing movies in the database
   */
  async matchFileToMovies(fileInfo: MediaFileInfo, movies: Movie[]): Promise<MediaMatch> {
    const fileName = this.removeExtension(fileInfo.fileName);
    const parsedInfo = this.parseMovieFileName(fileName);
    
    const suggestions: MatchSuggestion[] = [];
    let bestMatch: MatchSuggestion | null = null;

    // Search existing movies
    for (const movie of movies) {
      const confidence = this.calculateMovieMatchConfidence(parsedInfo, movie);
      if (confidence > 0) {
        const suggestion: MatchSuggestion = {
          mediaId: movie.id,
          title: movie.title,
          year: this.extractYearFromReleaseDate(movie.releaseDate),
          confidence,
          reason: this.getMatchReason(confidence, parsedInfo, movie.title)
        };
        suggestions.push(suggestion);

        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = suggestion;
        }
      }
    }

    // If no good matches found, try OMDB
    if (!bestMatch || bestMatch.confidence < this.matchThreshold) {
      const omdbMatches = await this.searchOMDB(parsedInfo);
      suggestions.push(...omdbMatches);
      
      if (omdbMatches.length > 0) {
        const bestOMDBMatch = omdbMatches.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );
        if (!bestMatch || bestOMDBMatch.confidence > bestMatch.confidence) {
          bestMatch = bestOMDBMatch;
        }
      }
    }

    // Sort suggestions by confidence
    suggestions.sort((a, b) => b.confidence - a.confidence);

    const match: MediaMatch = {
      fileInfo,
      confidence: bestMatch?.confidence || 0,
      mediaId: bestMatch?.mediaId,
      mediaType: 'movie',
      suggestions: suggestions.slice(0, 5), // Limit to top 5 suggestions
      status: this.determineMatchStatus(bestMatch?.confidence || 0)
    };

    return match;
  }

  /**
   * Match a file against existing series in the database
   */
  async matchFileToSeries(fileInfo: MediaFileInfo, series: Series[]): Promise<MediaMatch> {
    const fileName = this.removeExtension(fileInfo.fileName);
    const parsedInfo = this.parseSeriesFileName(fileName);
    
    const suggestions: MatchSuggestion[] = [];
    let bestMatch: MatchSuggestion | null = null;

    // Search existing series
    for (const show of series) {
      const confidence = this.calculateSeriesMatchConfidence(parsedInfo, show);
      if (confidence > 0) {
        const suggestion: MatchSuggestion = {
          mediaId: show.id,
          title: show.title,
          year: this.extractYearFromRunningYears(show.runningYears),
          confidence,
          reason: this.getMatchReason(confidence, parsedInfo, show.title)
        };
        suggestions.push(suggestion);

        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = suggestion;
        }
      }
    }

    // If no good matches found, try OMDB
    if (!bestMatch || bestMatch.confidence < this.matchThreshold) {
      const omdbMatches = await this.searchOMDBSeries(parsedInfo);
      suggestions.push(...omdbMatches);
      
      if (omdbMatches.length > 0) {
        const bestOMDBMatch = omdbMatches.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );
        if (!bestMatch || bestOMDBMatch.confidence > bestMatch.confidence) {
          bestMatch = bestOMDBMatch;
        }
      }
    }

    // Sort suggestions by confidence
    suggestions.sort((a, b) => b.confidence - a.confidence);

    const match: MediaMatch = {
      fileInfo,
      confidence: bestMatch?.confidence || 0,
      mediaId: bestMatch?.mediaId,
      mediaType: parsedInfo.season !== undefined ? 'episode' : 'series',
      suggestions: suggestions.slice(0, 5),
      status: this.determineMatchStatus(bestMatch?.confidence || 0)
    };

    return match;
  }

  /**
   * Batch match multiple files
   */
  async matchFiles(files: MediaFileInfo[], movies: Movie[], series: Series[]): Promise<MediaMatch[]> {
    const matches: MediaMatch[] = [];
    
    for (const file of files) {
      const mediaType = this.determineFileMediaType(file.fileName);
      
      let match: MediaMatch;
      if (mediaType === 'series' || mediaType === 'episode') {
        match = await this.matchFileToSeries(file, series);
      } else {
        match = await this.matchFileToMovies(file, movies);
      }
      
      matches.push(match);
    }

    return matches;
  }

  /**
   * Manually create a match between file and media entry
   */
  createManualMatch(fileInfo: MediaFileInfo, mediaId: string, mediaType: 'movie' | 'series' | 'episode', title: string): MediaMatch {
    return {
      fileInfo,
      confidence: 100,
      mediaId,
      mediaType,
      suggestions: [{
        mediaId,
        title,
        confidence: 100,
        reason: 'Manual match by user'
      }],
      status: 'matched'
    };
  }

  // Private helper methods

  private parseMovieFileName(fileName: string): { title: string; year?: number } {
    const result: { title: string; year?: number } = { title: fileName };

    // Pattern: Movie Title (2023)
    const yearPattern = /^(.+?)\s*\((\d{4})\)/;
    const yearMatch = fileName.match(yearPattern);
    if (yearMatch) {
      result.title = yearMatch[1].trim();
      result.year = parseInt(yearMatch[2]);
    }

    return result;
  }

  private parseSeriesFileName(fileName: string): { 
    title: string; 
    year?: number; 
    season?: number; 
    episode?: number; 
  } {
    const result: { title: string; year?: number; season?: number; episode?: number } = { title: fileName };

    // Pattern: Show Title S01E01
    const episodePattern = /^(.+?)\s*S(\d+)E(\d+)/i;
    const episodeMatch = fileName.match(episodePattern);
    if (episodeMatch) {
      result.title = episodeMatch[1].trim();
      result.season = parseInt(episodeMatch[2]);
      result.episode = parseInt(episodeMatch[3]);
      return result;
    }

    // Pattern: Show Title (2023)
    const yearPattern = /^(.+?)\s*\((\d{4})\)/;
    const yearMatch = fileName.match(yearPattern);
    if (yearMatch) {
      result.title = yearMatch[1].trim();
      result.year = parseInt(yearMatch[2]);
    }

    return result;
  }

  private calculateMovieMatchConfidence(
    parsedInfo: { title: string; year?: number }, 
    movie: Movie
  ): number {
    let confidence = 0;

    // Title similarity (0-70 points)
    const titleSimilarity = this.calculateStringSimilarity(parsedInfo.title, movie.title);
    confidence += titleSimilarity * 70;

    // Year match (0-30 points)
    if (parsedInfo.year) {
      const movieYear = this.extractYearFromReleaseDate(movie.releaseDate);
      if (movieYear === parsedInfo.year) {
        confidence += 30;
      } else if (movieYear && Math.abs(movieYear - parsedInfo.year) === 1) {
        confidence += 15; // Close year match
      }
    }

    return Math.round(confidence);
  }

  private calculateSeriesMatchConfidence(
    parsedInfo: { title: string; year?: number; season?: number; episode?: number }, 
    series: Series
  ): number {
    let confidence = 0;

    // Title similarity (0-70 points)
    const titleSimilarity = this.calculateStringSimilarity(parsedInfo.title, series.title);
    confidence += titleSimilarity * 70;

    // Year match (0-20 points)
    if (parsedInfo.year) {
      const seriesYear = this.extractYearFromRunningYears(series.runningYears);
      if (seriesYear === parsedInfo.year) {
        confidence += 20;
      } else if (seriesYear && Math.abs(seriesYear - parsedInfo.year) <= 2) {
        confidence += 10; // Close year match
      }
    }

    // Season/episode match (0-10 points)
    if (parsedInfo.season !== undefined && series.seasons.length >= parsedInfo.season) {
      confidence += 10;
    }

    return Math.round(confidence);
  }

  private calculateStringSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 1.0;

    // Levenshtein distance
    const matrix: number[][] = [];
    for (let i = 0; i <= s2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= s1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s2.length; i++) {
      for (let j = 1; j <= s1.length; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    const maxLength = Math.max(s1.length, s2.length);
    return (maxLength - matrix[s2.length][s1.length]) / maxLength;
  }

  private async searchOMDB(parsedInfo: { title: string; year?: number }): Promise<MatchSuggestion[]> {
    try {
      const omdbData = await retrieveMovieDataByTitle(parsedInfo.title);
      
      if (omdbData && omdbData.Response === 'True') {
        const year = omdbData.Year ? parseInt(omdbData.Year) : undefined;
        const confidence = this.calculateOMDBConfidence(parsedInfo, omdbData.Title, year);
        
        return [{
          mediaId: `omdb-${omdbData.imdbID}`,
          title: omdbData.Title,
          year,
          confidence,
          reason: 'OMDB search result'
        }];
      }
    } catch (error) {
      console.error('OMDB search failed:', error);
    }
    
    return [];
  }

  private async searchOMDBSeries(parsedInfo: { title: string; year?: number }): Promise<MatchSuggestion[]> {
    try {
      const omdbData = await retrieveShowDataByTitle(parsedInfo.title);
      
      if (omdbData && omdbData.Response === 'True') {
        const year = this.parseOMDBYear(omdbData.Year);
        const confidence = this.calculateOMDBConfidence(parsedInfo, omdbData.Title, year);
        
        return [{
          mediaId: `omdb-${omdbData.imdbID}`,
          title: omdbData.Title,
          year,
          confidence,
          reason: 'OMDB search result'
        }];
      }
    } catch (error) {
      console.error('OMDB series search failed:', error);
    }
    
    return [];
  }

  private calculateOMDBConfidence(parsedInfo: { title: string; year?: number }, omdbTitle: string, omdbYear?: number): number {
    let confidence = 0;

    // Title similarity
    const titleSimilarity = this.calculateStringSimilarity(parsedInfo.title, omdbTitle);
    confidence += titleSimilarity * 70;

    // Year match
    if (parsedInfo.year && omdbYear) {
      if (parsedInfo.year === omdbYear) {
        confidence += 30;
      } else if (Math.abs(parsedInfo.year - omdbYear) === 1) {
        confidence += 15;
      }
    } else if (parsedInfo.year || omdbYear) {
      confidence += 10; // Partial year information
    }

    return Math.round(confidence);
  }

  private determineFileMediaType(fileName: string): 'movie' | 'series' | 'episode' {
    // Check for episode pattern
    if (/S\d+E\d+/i.test(fileName)) {
      return 'episode';
    }

    // Check for movie pattern (includes year)
    if (/\(\d{4}\)/.test(fileName)) {
      return 'movie';
    }

    // Default to series for ambiguous cases
    return 'series';
  }

  private determineMatchStatus(confidence: number): 'matched' | 'unmatched' | 'conflict' | 'manual_review' {
    if (confidence >= this.matchThreshold) {
      return 'matched';
    } else if (confidence >= this.matchThreshold * 0.6) {
      return 'manual_review';
    } else {
      return 'unmatched';
    }
  }

  private getMatchReason(confidence: number, parsedInfo: any, title: string): string {
    if (confidence >= 90) {
      return 'Excellent match - title and metadata align perfectly';
    } else if (confidence >= 80) {
      return 'Very good match - strong title similarity with matching metadata';
    } else if (confidence >= 70) {
      return 'Good match - similar title with some metadata alignment';
    } else if (confidence >= 50) {
      return 'Moderate match - partial title similarity';
    } else {
      return 'Weak match - limited similarity detected';
    }
  }

  private removeExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  }

  private extractYearFromReleaseDate(releaseDate: string): number | undefined {
    // Assuming format "DayAsNumber-Month-Year"
    const parts = releaseDate.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[2]);
      return isNaN(year) ? undefined : year;
    }
    return undefined;
  }

  private extractYearFromRunningYears(runningYears: string[]): number | undefined {
    if (runningYears.length > 0) {
      const firstYear = parseInt(runningYears[0]);
      return isNaN(firstYear) ? undefined : firstYear;
    }
    return undefined;
  }

  private parseOMDBYear(yearString: string): number | undefined {
    // Handle formats like "2020" or "2020-2023"
    const match = yearString.match(/(\d{4})/);
    return match ? parseInt(match[1]) : undefined;
  }
}

export default MediaMatcher;
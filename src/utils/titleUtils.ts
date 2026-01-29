/**
 * Utility functions for handling titles in the application
 */

/**
 * Prepares title data for Firestore storage
 * Ensures titleLower field is set for efficient case-insensitive search
 * 
 * @param title - The original title
 * @returns Object with title and titleLower fields
 */
export function prepareTitleForStorage(title: string): { title: string; titleLower: string } {
  return {
    title: title,
    titleLower: title.toLowerCase()
  };
}

/**
 * Validates and prepares movie data before saving to Firestore
 * Ensures titleLower field is present
 * 
 * @param movieData - Partial movie data
 * @returns Movie data with titleLower field
 */
export function prepareMovieData<T extends { title: string }>(movieData: T): T & { titleLower: string } {
  return {
    ...movieData,
    titleLower: movieData.title.toLowerCase()
  };
}

/**
 * Validates and prepares series data before saving to Firestore
 * Ensures titleLower field is present
 * 
 * @param seriesData - Partial series data
 * @returns Series data with titleLower field
 */
export function prepareSeriesData<T extends { title: string }>(seriesData: T): T & { titleLower: string } {
  return {
    ...seriesData,
    titleLower: seriesData.title.toLowerCase()
  };
}

/**
 * Normalizes a search query for case-insensitive matching
 * 
 * @param query - The search query
 * @returns Normalized lowercase query
 */
export function normalizeSearchQuery(query: string): string {
  return query.toLowerCase().trim();
}

/**
 * Series Data Service
 * Handles creation of seasons and episodes from TMDB data when a series is saved
 */

import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import { Season } from '@/types/collections/Season.type';
import { Episode } from '@/types/collections/Episode.type';
import TmdbService from '../tmdb/TmdbService';

interface TMDBSeason {
  id: number;
  name: string;
  season_number: number;
  episode_count: number;
  air_date: string;
  overview: string;
  poster_path: string;
  episodes?: TMDBEpisode[];
}

interface TMDBEpisode {
  id: number;
  name: string;
  episode_number: number;
  season_number: number;
  air_date: string;
  overview: string;
  runtime: number;
  still_path: string;
  vote_average: number;
  vote_count: number;
}

class SeriesDataService {
  /**
   * Create seasons and episodes for a newly saved series
   * @param seriesId - Firebase document ID of the series
   * @param seriesTitle - Title of the series
   * @param imdbId - IMDb ID to lookup in TMDB
   * @returns Promise with count of seasons and episodes created
   */
  async createSeasonsAndEpisodes(
    seriesId: string,
    seriesTitle: string,
    imdbId: string
  ): Promise<{ seasonsCreated: number; episodesCreated: number }> {
    try {
      console.log(`Creating seasons/episodes for series: ${seriesTitle} (${imdbId})`);
      
      // 1. Find TMDB series ID from IMDb ID
      const tmdbSeries = await TmdbService.findTVSeriesByImdbId(imdbId);
      
      if (!tmdbSeries || !tmdbSeries.id) {
        console.warn(`No TMDB series found for IMDb ID: ${imdbId}`);
        return { seasonsCreated: 0, episodesCreated: 0 };
      }

      const tmdbSeriesId = tmdbSeries.id;
      console.log(`Found TMDB series ID: ${tmdbSeriesId}`);

      // 2. Get full series details to know how many seasons
      const seriesDetails = await TmdbService.getTVSeriesDetails(tmdbSeriesId);
      const totalSeasons = seriesDetails.number_of_seasons || 0;
      
      if (totalSeasons === 0) {
        console.warn(`No seasons found for series: ${seriesTitle}`);
        return { seasonsCreated: 0, episodesCreated: 0 };
      }

      let seasonsCreated = 0;
      let episodesCreated = 0;

      // 3. Loop through each season and create season + episodes
      for (let seasonNum = 1; seasonNum <= totalSeasons; seasonNum++) {
        try {
          const seasonData = await TmdbService.getSeasonDetails(tmdbSeriesId, seasonNum);
          
          // Create season document
          const seasonId = await this.createSeasonDocument(
            seriesId,
            seriesTitle,
            seasonData,
            tmdbSeriesId
          );
          
          seasonsCreated++;
          console.log(`Created season ${seasonNum}: ${seasonId}`);

          // Create episode documents for this season
          if (seasonData.episodes && seasonData.episodes.length > 0) {
            for (const episodeData of seasonData.episodes) {
              await this.createEpisodeDocument(
                seriesId,
                seasonId,
                seriesTitle,
                episodeData,
                tmdbSeriesId
              );
              episodesCreated++;
            }
            console.log(`Created ${seasonData.episodes.length} episodes for season ${seasonNum}`);
          }
        } catch (error) {
          console.error(`Error processing season ${seasonNum}:`, error);
          // Continue with next season even if one fails
        }
      }

      console.log(`Total created: ${seasonsCreated} seasons, ${episodesCreated} episodes`);
      return { seasonsCreated, episodesCreated };

    } catch (error) {
      console.error('Error creating seasons and episodes:', error);
      throw error;
    }
  }

  /**
   * Create a season document in Firebase
   */
  private async createSeasonDocument(
    seriesId: string,
    seriesTitle: string,
    tmdbSeason: TMDBSeason,
    tmdbSeriesId: number
  ): Promise<string> {
    const seasonData: any = {
      seriesId,
      seriesTitle,
      seasonNumber: tmdbSeason.season_number ?? 0,
      seasonName: tmdbSeason.name || `Season ${tmdbSeason.season_number ?? 0}`,
      totalEpisodes: tmdbSeason.episode_count || 0,
      episodeIds: [], // Will be populated as episodes are created
      releaseYear: tmdbSeason.air_date ? new Date(tmdbSeason.air_date).getFullYear().toString() : '',
      
      // Initialize with empty/default values
      countries: [],
      directors: [],
      cast: [],
      writers: [],
      languages: [],
      imageFiles: tmdbSeason.poster_path ? [{
        fileName: tmdbSeason.poster_path.split('/').pop() || `season-${tmdbSeason.season_number ?? 0}-poster.jpg`,
        fileSize: '0',
        format: 'jpg',
        resolution: '2000x3000'
      }] : [],
      releases: [],
      jellyfinFolderName: `Season ${(tmdbSeason.season_number ?? 0).toString().padStart(2, '0')}`,
      
      // Assignment summary
      episodesWithFiles: 0,
      totalFiles: 0,
      totalFileSize: 0,
      
      // OMDB data (empty for now)
      omdbData: {} as any,
      
      // Timestamps
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Only include optional fields if they have values
    if (tmdbSeason.name !== `Season ${tmdbSeason.season_number}`) {
      seasonData.alternateTitle = tmdbSeason.name;
    }
    
    if (tmdbSeason.overview) {
      seasonData.overview = tmdbSeason.overview;
    }
    
    if (tmdbSeason.air_date) {
      seasonData.firstAired = new Date(tmdbSeason.air_date);
    }

    const docRef = await addDoc(collection(db, 'seasons'), seasonData);
    return docRef.id;
  }

  /**
   * Create an episode document in Firebase
   */
  private async createEpisodeDocument(
    seriesId: string,
    seasonId: string,
    seriesTitle: string,
    tmdbEpisode: TMDBEpisode,
    tmdbSeriesId: number
  ): Promise<string> {
    const episodeData: any = {
      seriesId,
      seasonId,
      seriesTitle,
      seasonNumber: tmdbEpisode.season_number ?? 0,
      episodeNumber: tmdbEpisode.episode_number ?? 0,
      title: tmdbEpisode.name || 'Untitled Episode',
      
      // Initialize with empty/default values
      countries: [],
      directors: [],
      writers: [],
      languages: [],
      cast: [],
      imageFiles: tmdbEpisode.still_path ? [{
        fileName: tmdbEpisode.still_path.split('/').pop() || `s${tmdbEpisode.season_number ?? 0}e${tmdbEpisode.episode_number ?? 0}-still.jpg`,
        fileSize: '0',
        format: 'jpg',
        resolution: '1920x1080'
      }] : [],
      
      // File assignment
      hasFile: false,
      fileCount: 0,
      
      // External IDs
      externalIds: {
        tmdbId: tmdbEpisode.id ?? 0
      },
      
      // OMDB data (empty for now)
      omdbData: {} as any,
      
      // Timestamps
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Only include optional fields if they have values
    if (tmdbEpisode.overview) {
      episodeData.overview = tmdbEpisode.overview;
    }
    
    if (tmdbEpisode.air_date) {
      episodeData.airDate = new Date(tmdbEpisode.air_date);
    }
    
    if (tmdbEpisode.runtime) {
      episodeData.runtime = tmdbEpisode.runtime;
      episodeData.runtimeFormatted = `${tmdbEpisode.runtime}m`;
    }

    const docRef = await addDoc(collection(db, 'episodes'), episodeData);
    return docRef.id;
  }
}

export default new SeriesDataService();

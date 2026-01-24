/**
 * Frontend Data Migration Utility
 * 
 * This script provides utilities for migrating Firestore data from
 * the old structure to the new enhanced media architecture.
 * 
 * Run from Next.js app:
 *   npm run migrate
 * 
 * Or directly with ts-node:
 *   ts-node src/scripts/migrate-to-new-structure.ts [--dry-run] [--verbose]
 */

import { db } from '../../firebaseConfig';
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  writeBatch,
  updateDoc,
  query,
  where,
  Timestamp
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';

interface MigrationStats {
  moviesUpdated: number;
  seriesUpdated: number;
  seasonsCreated: number;
  episodesUpdated: number;
  mediaFilesCreated: number;
  assignmentsCreated: number;
  errors: string[];
}

class FrontendDataMigration {
  private db: typeof db;
  private dryRun: boolean;
  private verbose: boolean;
  private stats: MigrationStats;

  constructor(dryRun: boolean = false, verbose: boolean = false) {
    this.dryRun = dryRun;
    this.verbose = verbose;
    this.stats = {
      moviesUpdated: 0,
      seriesUpdated: 0,
      seasonsCreated: 0,
      episodesUpdated: 0,
      mediaFilesCreated: 0,
      assignmentsCreated: 0,
      errors: []
    };

    // Use the existing client-side Firebase configuration
    this.db = db;
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (this.verbose || level === 'error') {
      const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '→';
      console.log(`${prefix} ${message}`);
    }
  }

  async migrateAll(): Promise<void> {
    console.log('\n' + '='.repeat(70));
    console.log('MEDIA ARCHITECTURE MIGRATION v2.0 (Frontend)');
    console.log('='.repeat(70));

    if (this.dryRun) {
      console.log('\n⚠️  DRY RUN MODE - No changes will be made');
    }

    console.log('\nStarting migration...\n');

    try {
      // Step 1: Migrate movies
      console.log('📽️  Step 1/5: Migrating movies...');
      await this.migrateMovies();
      console.log(`   ✓ Updated ${this.stats.moviesUpdated} movies`);

      // Step 2: Migrate series and extract seasons
      console.log('\n📺 Step 2/5: Migrating series and extracting seasons...');
      await this.migrateSeries();
      console.log(`   ✓ Updated ${this.stats.seriesUpdated} series`);
      console.log(`   ✓ Created ${this.stats.seasonsCreated} season documents`);

      // Step 3: Migrate episodes
      console.log('\n🎬 Step 3/5: Migrating episodes...');
      await this.migrateEpisodes();
      console.log(`   ✓ Updated ${this.stats.episodesUpdated} episodes`);

      // Step 4: Create media_files
      console.log('\n📁 Step 4/5: Creating media_files collection...');
      await this.createMediaFiles();
      console.log(`   ✓ Created ${this.stats.mediaFilesCreated} media file documents`);

      // Step 5: Create media_assignments
      console.log('\n🔗 Step 5/5: Creating media_assignments...');
      await this.createMediaAssignments();
      console.log(`   ✓ Created ${this.stats.assignmentsCreated} assignment documents`);

      // Summary
      console.log('\n' + '='.repeat(70));
      console.log('MIGRATION COMPLETE');
      console.log('='.repeat(70));
      this.printSummary();

      if (this.dryRun) {
        console.log('\n⚠️  This was a DRY RUN - no actual changes were made');
        console.log('Run without --dry-run to apply changes');
      }

    } catch (error) {
      console.error('\n❌ Migration failed:', error);
      this.stats.errors.push(String(error));
      throw error;
    }
  }

  private async migrateMovies(): Promise<void> {
    try {
      const moviesSnapshot = await getDocs(collection(this.db, 'movies'));
      
      for (const movieDoc of moviesSnapshot.docs) {
        try {
          const movie = movieDoc.data();
          const movieId = movieDoc.id;
          
          this.log(`Migrating movie: ${movie.title || 'Unknown'}`);
          
          const updates: any = {};
          
          // Initialize assignmentSummary if has libraryFiles
          const libraryFiles = movie.libraryFiles || [];
          if (libraryFiles.length > 0) {
            const totalSize = libraryFiles.reduce((sum: number, f: any) => sum + (f.size || 0), 0);
            updates.assignmentSummary = {
              totalFiles: libraryFiles.length,
              versions: [],
              hasPhysicalCopy: movie.physicalCopy || false,
              totalFileSize: totalSize,
              lastUpdated: new Date().toISOString()
            };
          }
          
          // Initialize JellyfinInfo
          updates.jellyfinInfo = {
            folderId: null,
            folderPath: null,
            folderName: null,
            isOrganized: false
          };
          
          // Initialize ExternalIds
          if (!movie.externalIds) {
            updates.externalIds = {
              imdbId: movie.imdbId || null,
              tmdbId: movie.tmdbId || null,
              rottenTomatoesId: null,
              metacriticId: null,
              letterboxdId: null
            };
          }
          
          // Add content rating
          if (!movie.contentRating && movie.rated) {
            updates.contentRating = {
              country: 'US',
              rating: movie.rated,
              ratingSystem: 'MPAA'
            };
          }
          
          if (Object.keys(updates).length > 0 && !this.dryRun) {
            const movieRef = doc(this.db, 'movies', movieId);
            const batch = writeBatch(this.db);
            batch.update(movieRef, updates);
            await batch.commit();
          }
          
          this.stats.moviesUpdated++;
          
        } catch (error) {
          const errorMsg = `Failed to migrate movie ${movieDoc.id}: ${error}`;
          this.log(errorMsg, 'error');
          this.stats.errors.push(errorMsg);
        }
      }
    } catch (error) {
      console.error('Movie migration failed:', error);
      throw error;
    }
  }

  private async migrateSeries(): Promise<void> {
    try {
      const seriesSnapshot = await getDocs(collection(this.db, 'series'));
      
      for (const seriesDoc of seriesSnapshot.docs) {
        try {
          const series = seriesDoc.data();
          const seriesId = seriesDoc.id;
          
          this.log(`Migrating series: ${series.title || 'Unknown'}`);
          
          const seasons = series.seasons || [];
          const seasonIds: string[] = [];
          
          // Create standalone season documents
          for (const seasonData of seasons) {
            const seasonId = uuidv4();
            seasonIds.push(seasonId);
            
            const seasonDoc = {
              id: seasonId,
              seriesId: seriesId,
              seriesTitle: series.title,
              seasonNumber: seasonData.seasonNumber || 0,
              title: seasonData.title || `Season ${seasonData.seasonNumber || 0}`,
              overview: seasonData.overview || null,
              airDate: seasonData.airDate || null,
              episodeCount: seasonData.episodeCount || 0,
              episodeIds: [],
              posterPath: seasonData.posterPath || null,
              episodesWithFiles: 0,
              totalFiles: 0,
              totalFileSize: 0,
              jellyfinFolderId: null,
              jellyfinFolderName: null,
              dateCreated: new Date().toISOString(),
              dateUpdated: new Date().toISOString()
            };
            
            if (!this.dryRun) {
              const batch = writeBatch(this.db);
              const seasonRef = doc(this.db, 'seasons', seasonId);
              batch.set(seasonRef, seasonDoc);
              await batch.commit();
            }
            
            this.stats.seasonsCreated++;
          }
          
          // Update series document
          const updates: any = {
            seriesSummary: {
              totalSeasons: seasons.length,
              totalEpisodes: seasons.reduce((sum: number, s: any) => sum + (s.episodeCount || 0), 0),
              totalRuntime: 0,
              status: series.status || 'Unknown',
              lastAirDate: series.lastAirDate || null
            },
            seriesAssignmentSummary: {
              seasonsWithFiles: 0,
              episodesWithFiles: 0,
              totalFiles: 0,
              totalFileSize: 0,
              lastUpdated: new Date().toISOString()
            },
            seriesJellyfinInfo: {
              folderId: null,
              folderPath: null,
              seasonFolders: [],
              isOrganized: false
            },
            seasonIds: seasonIds
          };
          
          if (!series.externalIds) {
            updates.externalIds = {
              imdbId: series.imdbId || null,
              tmdbId: series.tmdbId || null,
              tvdbId: series.tvdbId || null,
              tvMazeId: null
            };
          }
          
          if (!this.dryRun) {
            const batch = writeBatch(this.db);
            const seriesRef = doc(this.db, 'series', seriesId);
            batch.update(seriesRef, updates);
            await batch.commit();
          }
          
          this.stats.seriesUpdated++;
          
        } catch (error) {
          const errorMsg = `Failed to migrate series ${seriesDoc.id}: ${error}`;
          this.log(errorMsg, 'error');
          this.stats.errors.push(errorMsg);
        }
      }
    } catch (error) {
      console.error('Series migration failed:', error);
      throw error;
    }
  }

  private async migrateEpisodes(): Promise<void> {
    try {
      const episodesSnapshot = await getDocs(collection(this.db, 'episodes'));
      
      for (const episodeDoc of episodesSnapshot.docs) {
        try {
          const episode = episodeDoc.data();
          
          const updates: any = {
            hasFile: false,
            fileId: null,
            fileCount: 0,
            jellyfinFilename: null
          };
          
          if (!episode.externalIds) {
            updates.externalIds = {
              imdbId: episode.imdbId || null,
              tmdbId: episode.tmdbId || null,
              tvdbId: episode.tvdbId || null
            };
          }
          
          if (Object.keys(updates).length > 0 && !this.dryRun) {
            const episodeRef = doc(this.db, 'episodes', episodeDoc.id);
            await updateDoc(episodeRef, updates);
          }
          
          this.stats.episodesUpdated++;
          
        } catch (error) {
          const errorMsg = `Failed to migrate episode ${episodeDoc.id}: ${error}`;
          this.log(errorMsg, 'error');
          this.stats.errors.push(errorMsg);
        }
      }
    } catch (error) {
      console.error('Episode migration failed:', error);
      throw error;
    }
  }

  private async createMediaFiles(): Promise<void> {
    try {
      const moviesSnapshot = await getDocs(collection(this.db, 'movies'));
      
      for (const movieDoc of moviesSnapshot.docs) {
        const movie = movieDoc.data();
        const libraryFiles = movie.libraryFiles || [];
        
        if (libraryFiles.length === 0) continue;
        
        for (const fileData of libraryFiles) {
          try {
            const fileId = uuidv4();
            
            const fileDoc = {
              id: fileId,
              userId: movie.userId || 'migrated',
              libraryPath: movie.libraryPath || '',
              filePath: fileData.path || '',
              fileName: fileData.name || '',
              fileExtension: fileData.extension || '',
              fileSize: fileData.size || 0,
              dateAdded: new Date().toISOString(),
              dateModified: fileData.modified || new Date().toISOString(),
              dateCreated: fileData.created || new Date().toISOString(),
              containerFormat: null,
              duration: null,
              overallBitrate: null,
              videoMetadata: null,
              audioTracks: [],
              subtitleTracks: [],
              checksum: null,
              isAssigned: true,
              assignmentId: null,
              mediaType: 'movie',
              mediaId: movieDoc.id,
              parsedTitle: null,
              parsedYear: null,
              parsedQuality: null,
              releaseGroup: null
            };
            
            if (!this.dryRun) {
              const batch = writeBatch(this.db);
              const fileRef = doc(this.db, 'media_files', fileId);
              batch.set(fileRef, fileDoc);
              await batch.commit();
            }
            
            this.stats.mediaFilesCreated++;
            
          } catch (error) {
            const errorMsg = `Failed to create media_file: ${error}`;
            this.log(errorMsg, 'error');
            this.stats.errors.push(errorMsg);
          }
        }
      }
    } catch (error) {
      console.error('Media files creation failed:', error);
      throw error;
    }
  }

  private async createMediaAssignments(): Promise<void> {
    try {
      const filesQuery = query(
        collection(this.db, 'media_files'),
        where('isAssigned', '==', true),
        where('assignmentId', '==', null)
      );
      const filesSnapshot = await getDocs(filesQuery);
      
      for (const fileDoc of filesSnapshot.docs) {
        try {
          const file = fileDoc.data();
          const assignmentId = uuidv4();
          
          const assignmentDoc = {
            id: assignmentId,
            userId: file.userId || 'migrated',
            fileId: fileDoc.id,
            mediaType: file.mediaType || 'movie',
            mediaId: file.mediaId,
            version: '1080p',
            status: 'assigned',
            dateAssigned: new Date().toISOString(),
            isOrganized: false,
            targetFolder: null,
            sourceFile: {
              filePath: file.filePath,
              fileName: file.fileName,
              fileSize: file.fileSize || 0
            },
            organizationHistory: []
          };
          
          if (!this.dryRun) {
            const batch = writeBatch(this.db);
            const assignmentRef = doc(this.db, 'media_assignments', assignmentId);
            batch.set(assignmentRef, assignmentDoc);
            
            const fileRef = doc(this.db, 'media_files', fileDoc.id);
            batch.update(fileRef, {
              assignmentId,
              organizationStatus: 'pending',
              updatedAt: new Date().toISOString()
            });
            
            await batch.commit();
          }
          
          this.stats.assignmentsCreated++;
          
        } catch (error) {
          const errorMsg = `Failed to create assignment: ${error}`;
          this.log(errorMsg, 'error');
          this.stats.errors.push(errorMsg);
        }
      }
    } catch (error) {
      console.error('Assignment creation failed:', error);
      throw error;
    }
  }

  private printSummary(): void {
    console.log('\nMigration Statistics:');
    console.log(`  Movies updated:          ${this.stats.moviesUpdated}`);
    console.log(`  Series updated:          ${this.stats.seriesUpdated}`);
    console.log(`  Seasons created:         ${this.stats.seasonsCreated}`);
    console.log(`  Episodes updated:        ${this.stats.episodesUpdated}`);
    console.log(`  Media files created:     ${this.stats.mediaFilesCreated}`);
    console.log(`  Assignments created:     ${this.stats.assignmentsCreated}`);
    
    if (this.stats.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered:     ${this.stats.errors.length}`);
      if (this.verbose) {
        console.log('\nError details:');
        this.stats.errors.slice(0, 10).forEach(error => {
          console.log(`  - ${error}`);
        });
        if (this.stats.errors.length > 10) {
          console.log(`  ... and ${this.stats.errors.length - 10} more`);
        }
      }
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose') || args.includes('-v');

  const migration = new FrontendDataMigration(dryRun, verbose);
  
  try {
    await migration.migrateAll();
    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { FrontendDataMigration };

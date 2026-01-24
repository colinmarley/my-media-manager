"""
Data Migration Script for Media Architecture v2

This script migrates existing data from the old structure to the new
enhanced media architecture with Jellyfin integration.

Migrations:
1. Movies: Add new fields, deprecate old fields, preserve data
2. Series: Extract seasons to standalone collection
3. Create media_files from existing libraryFiles
4. Create media_assignments for existing file links
5. Initialize assignment summaries

Usage:
    python migrate_to_new_structure.py [--dry-run] [--verbose]

Author: Media Manager Team
Version: 2.0.0
"""

import argparse
import sys
from datetime import datetime
from typing import Dict, List, Any, Optional
import uuid

# Add parent directory to path for imports
sys.path.append('..')

from services.firestore_service import FirestoreService
from config.settings import settings
from utils.logging import logger


class DataMigration:
    """Handles migration of existing data to new architecture"""
    
    def __init__(self, dry_run: bool = False, verbose: bool = False):
        """
        Initialize migration service.
        
        Args:
            dry_run: If True, simulate migration without making changes
            verbose: If True, log detailed progress
        """
        self.dry_run = dry_run
        self.verbose = verbose
        self.firestore = FirestoreService(settings.firebase_project_id)
        self.stats = {
            'movies_updated': 0,
            'series_updated': 0,
            'seasons_created': 0,
            'episodes_updated': 0,
            'media_files_created': 0,
            'assignments_created': 0,
            'errors': []
        }
    
    def log(self, message: str, level: str = 'info'):
        """Log message if verbose mode enabled"""
        if self.verbose:
            if level == 'info':
                logger.info(message)
            elif level == 'warning':
                logger.warning(message)
            elif level == 'error':
                logger.error(message)
    
    def migrate_all(self):
        """Run all migration steps in correct order"""
        print("\n" + "="*70)
        print("MEDIA ARCHITECTURE MIGRATION v2.0")
        print("="*70)
        
        if self.dry_run:
            print("\n⚠️  DRY RUN MODE - No changes will be made")
        
        print("\nStarting migration...\n")
        
        try:
            # Step 1: Migrate movies
            print("📽️  Step 1/5: Migrating movies...")
            self.migrate_movies()
            print(f"   ✓ Updated {self.stats['movies_updated']} movies")
            
            # Step 2: Migrate series and extract seasons
            print("\n📺 Step 2/5: Migrating series and extracting seasons...")
            self.migrate_series()
            print(f"   ✓ Updated {self.stats['series_updated']} series")
            print(f"   ✓ Created {self.stats['seasons_created']} season documents")
            
            # Step 3: Migrate episodes
            print("\n🎬 Step 3/5: Migrating episodes...")
            self.migrate_episodes()
            print(f"   ✓ Updated {self.stats['episodes_updated']} episodes")
            
            # Step 4: Create media_files from libraryFiles
            print("\n📁 Step 4/5: Creating media_files collection...")
            self.create_media_files()
            print(f"   ✓ Created {self.stats['media_files_created']} media file documents")
            
            # Step 5: Create media_assignments
            print("\n🔗 Step 5/5: Creating media_assignments...")
            self.create_media_assignments()
            print(f"   ✓ Created {self.stats['assignments_created']} assignment documents")
            
            # Summary
            print("\n" + "="*70)
            print("MIGRATION COMPLETE")
            print("="*70)
            self.print_summary()
            
            if self.dry_run:
                print("\n⚠️  This was a DRY RUN - no actual changes were made")
                print("Run without --dry-run to apply changes")
            
        except Exception as e:
            logger.error("Migration failed", error=str(e))
            print(f"\n❌ Migration failed: {str(e)}")
            self.stats['errors'].append(str(e))
            raise
    
    def migrate_movies(self):
        """Migrate movie documents to new structure"""
        try:
            # Get all movies
            movies = self.firestore.get_collection('movies')
            
            for movie in movies:
                try:
                    movie_id = movie.get('id')
                    if not movie_id:
                        continue
                    
                    self.log(f"Migrating movie: {movie.get('title', 'Unknown')}", 'info')
                    
                    # Prepare update data
                    updates = {}
                    
                    # Initialize assignmentSummary if has libraryFiles
                    library_files = movie.get('libraryFiles', [])
                    if library_files:
                        total_size = sum(f.get('size', 0) for f in library_files if isinstance(f, dict))
                        updates['assignmentSummary'] = {
                            'totalFiles': len(library_files),
                            'versions': [],  # Will be populated during assignment
                            'hasPhysicalCopy': movie.get('physicalCopy', False),
                            'totalFileSize': total_size,
                            'lastUpdated': datetime.utcnow().isoformat()
                        }
                    
                    # Initialize JellyfinInfo
                    updates['jellyfinInfo'] = {
                        'folderId': None,
                        'folderPath': None,
                        'folderName': None,
                        'isOrganized': False
                    }
                    
                    # Initialize ExternalIds if not present
                    if 'externalIds' not in movie:
                        updates['externalIds'] = {
                            'imdbId': movie.get('imdbId'),
                            'tmdbId': movie.get('tmdbId'),
                            'rottenTomatoesId': None,
                            'metacriticId': None,
                            'letterboxdId': None
                        }
                    
                    # Add content rating structure
                    if 'contentRating' not in movie and movie.get('rated'):
                        updates['contentRating'] = {
                            'country': 'US',
                            'rating': movie.get('rated'),
                            'ratingSystem': 'MPAA'
                        }
                    
                    # Apply updates
                    if updates and not self.dry_run:
                        self.firestore.update_document('movies', movie_id, updates)
                    
                    self.stats['movies_updated'] += 1
                    
                except Exception as e:
                    error_msg = f"Failed to migrate movie {movie.get('id')}: {str(e)}"
                    self.log(error_msg, 'error')
                    self.stats['errors'].append(error_msg)
                    continue
                    
        except Exception as e:
            logger.error("Movie migration failed", error=str(e))
            raise
    
    def migrate_series(self):
        """Migrate series and extract seasons to standalone collection"""
        try:
            # Get all series
            series_list = self.firestore.get_collection('series')
            
            for series in series_list:
                try:
                    series_id = series.get('id')
                    if not series_id:
                        continue
                    
                    self.log(f"Migrating series: {series.get('title', 'Unknown')}", 'info')
                    
                    # Extract seasons array
                    seasons = series.get('seasons', [])
                    season_ids = []
                    
                    # Create standalone season documents
                    for season_data in seasons:
                        if not isinstance(season_data, dict):
                            continue
                        
                        season_id = str(uuid.uuid4())
                        season_ids.append(season_id)
                        
                        # Create season document
                        season_doc = {
                            'id': season_id,
                            'seriesId': series_id,
                            'seriesTitle': series.get('title'),
                            'seasonNumber': season_data.get('seasonNumber', 0),
                            'title': season_data.get('title', f"Season {season_data.get('seasonNumber', 0)}"),
                            'overview': season_data.get('overview'),
                            'airDate': season_data.get('airDate'),
                            'episodeCount': season_data.get('episodeCount', 0),
                            'episodeIds': [],  # Will be populated when migrating episodes
                            'posterPath': season_data.get('posterPath'),
                            'episodesWithFiles': 0,
                            'totalFiles': 0,
                            'totalFileSize': 0,
                            'jellyfinFolderId': None,
                            'jellyfinFolderName': None,
                            'dateCreated': datetime.utcnow().isoformat(),
                            'dateUpdated': datetime.utcnow().isoformat()
                        }
                        
                        if not self.dry_run:
                            self.firestore.create_document('seasons', season_id, season_doc)
                        
                        self.stats['seasons_created'] += 1
                    
                    # Update series document
                    updates = {
                        'seriesSummary': {
                            'totalSeasons': len(seasons),
                            'totalEpisodes': sum(s.get('episodeCount', 0) for s in seasons if isinstance(s, dict)),
                            'totalRuntime': 0,  # Will be calculated from episodes
                            'status': series.get('status', 'Unknown'),
                            'lastAirDate': series.get('lastAirDate')
                        },
                        'seriesAssignmentSummary': {
                            'seasonsWithFiles': 0,
                            'episodesWithFiles': 0,
                            'totalFiles': 0,
                            'totalFileSize': 0,
                            'lastUpdated': datetime.utcnow().isoformat()
                        },
                        'seriesJellyfinInfo': {
                            'folderId': None,
                            'folderPath': None,
                            'seasonFolders': [],
                            'isOrganized': False
                        },
                        'seasonIds': season_ids
                    }
                    
                    # Initialize external IDs
                    if 'externalIds' not in series:
                        updates['externalIds'] = {
                            'imdbId': series.get('imdbId'),
                            'tmdbId': series.get('tmdbId'),
                            'tvdbId': series.get('tvdbId'),
                            'tvMazeId': None
                        }
                    
                    if not self.dry_run:
                        self.firestore.update_document('series', series_id, updates)
                    
                    self.stats['series_updated'] += 1
                    
                except Exception as e:
                    error_msg = f"Failed to migrate series {series.get('id')}: {str(e)}"
                    self.log(error_msg, 'error')
                    self.stats['errors'].append(error_msg)
                    continue
                    
        except Exception as e:
            logger.error("Series migration failed", error=str(e))
            raise
    
    def migrate_episodes(self):
        """Migrate episode documents"""
        try:
            episodes = self.firestore.get_collection('episodes')
            
            for episode in episodes:
                try:
                    episode_id = episode.get('id')
                    if not episode_id:
                        continue
                    
                    updates = {
                        'hasFile': False,
                        'fileId': None,
                        'fileCount': 0,
                        'jellyfinFilename': None
                    }
                    
                    # Initialize external IDs
                    if 'externalIds' not in episode:
                        updates['externalIds'] = {
                            'imdbId': episode.get('imdbId'),
                            'tmdbId': episode.get('tmdbId'),
                            'tvdbId': episode.get('tvdbId')
                        }
                    
                    if not self.dry_run:
                        self.firestore.update_document('episodes', episode_id, updates)
                    
                    self.stats['episodes_updated'] += 1
                    
                except Exception as e:
                    error_msg = f"Failed to migrate episode {episode.get('id')}: {str(e)}"
                    self.log(error_msg, 'error')
                    self.stats['errors'].append(error_msg)
                    continue
                    
        except Exception as e:
            logger.error("Episode migration failed", error=str(e))
            raise
    
    def create_media_files(self):
        """Create media_files collection from existing libraryFiles"""
        try:
            # Get all movies with libraryFiles
            movies = self.firestore.get_collection('movies')
            
            for movie in movies:
                library_files = movie.get('libraryFiles', [])
                if not library_files:
                    continue
                
                for file_data in library_files:
                    if not isinstance(file_data, dict):
                        continue
                    
                    try:
                        file_id = str(uuid.uuid4())
                        
                        file_doc = {
                            'id': file_id,
                            'userId': movie.get('userId', 'migrated'),
                            'libraryPath': movie.get('libraryPath', ''),
                            'filePath': file_data.get('path', ''),
                            'fileName': file_data.get('name', ''),
                            'fileExtension': file_data.get('extension', ''),
                            'fileSize': file_data.get('size', 0),
                            'dateAdded': datetime.utcnow().isoformat(),
                            'dateModified': file_data.get('modified', datetime.utcnow().isoformat()),
                            'dateCreated': file_data.get('created', datetime.utcnow().isoformat()),
                            'containerFormat': None,
                            'duration': None,
                            'overallBitrate': None,
                            'videoMetadata': None,
                            'audioTracks': [],
                            'subtitleTracks': [],
                            'checksum': None,
                            'isAssigned': True,  # Already linked to movie
                            'assignmentId': None,  # Will be set when creating assignments
                            'mediaType': 'movie',
                            'mediaId': movie.get('id'),
                            'parsedTitle': None,
                            'parsedYear': None,
                            'parsedQuality': None,
                            'releaseGroup': None
                        }
                        
                        if not self.dry_run:
                            self.firestore.create_document('media_files', file_id, file_doc)
                        
                        self.stats['media_files_created'] += 1
                        
                    except Exception as e:
                        error_msg = f"Failed to create media_file: {str(e)}"
                        self.log(error_msg, 'error')
                        self.stats['errors'].append(error_msg)
                        continue
                        
        except Exception as e:
            logger.error("Media files creation failed", error=str(e))
            raise
    
    def create_media_assignments(self):
        """Create media_assignments for existing file links"""
        try:
            # Get all media_files that are assigned but have no assignmentId
            media_files = self.firestore.get_collection('media_files')
            
            for file_doc in media_files:
                if not file_doc.get('isAssigned') or file_doc.get('assignmentId'):
                    continue
                
                try:
                    assignment_id = str(uuid.uuid4())
                    
                    assignment_doc = {
                        'id': assignment_id,
                        'userId': file_doc.get('userId', 'migrated'),
                        'fileId': file_doc['id'],
                        'mediaType': file_doc.get('mediaType', 'movie'),
                        'mediaId': file_doc.get('mediaId'),
                        'version': '1080p',  # Default version
                        'status': 'assigned',
                        'dateAssigned': datetime.utcnow().isoformat(),
                        'isOrganized': False,
                        'targetFolder': None,
                        'sourceFile': {
                            'filePath': file_doc.get('filePath'),
                            'fileName': file_doc.get('fileName'),
                            'fileSize': file_doc.get('fileSize', 0)
                        },
                        'organizationHistory': []
                    }
                    
                    if not self.dry_run:
                        self.firestore.create_document('media_assignments', assignment_id, assignment_doc)
                        # Update media_file with assignmentId
                        self.firestore.update_document('media_files', file_doc['id'], {
                            'assignmentId': assignment_id
                        })
                    
                    self.stats['assignments_created'] += 1
                    
                except Exception as e:
                    error_msg = f"Failed to create assignment: {str(e)}"
                    self.log(error_msg, 'error')
                    self.stats['errors'].append(error_msg)
                    continue
                    
        except Exception as e:
            logger.error("Assignment creation failed", error=str(e))
            raise
    
    def print_summary(self):
        """Print migration summary statistics"""
        print("\nMigration Statistics:")
        print(f"  Movies updated:          {self.stats['movies_updated']}")
        print(f"  Series updated:          {self.stats['series_updated']}")
        print(f"  Seasons created:         {self.stats['seasons_created']}")
        print(f"  Episodes updated:        {self.stats['episodes_updated']}")
        print(f"  Media files created:     {self.stats['media_files_created']}")
        print(f"  Assignments created:     {self.stats['assignments_created']}")
        
        if self.stats['errors']:
            print(f"\n⚠️  Errors encountered:     {len(self.stats['errors'])}")
            if self.verbose:
                print("\nError details:")
                for error in self.stats['errors'][:10]:  # Show first 10
                    print(f"  - {error}")
                if len(self.stats['errors']) > 10:
                    print(f"  ... and {len(self.stats['errors']) - 10} more")


def main():
    """Main entry point for migration script"""
    parser = argparse.ArgumentParser(description='Migrate media data to new architecture v2')
    parser.add_argument('--dry-run', action='store_true', help='Simulate migration without making changes')
    parser.add_argument('--verbose', '-v', action='store_true', help='Enable verbose logging')
    
    args = parser.parse_args()
    
    # Create migration instance
    migration = DataMigration(dry_run=args.dry_run, verbose=args.verbose)
    
    try:
        # Run migration
        migration.migrate_all()
        
        print("\n✅ Migration completed successfully!")
        sys.exit(0)
        
    except Exception as e:
        print(f"\n❌ Migration failed: {str(e)}")
        sys.exit(1)


if __name__ == '__main__':
    main()

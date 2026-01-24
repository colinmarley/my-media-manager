# Data Migration Guide

This guide explains how to migrate your existing media library data to the new enhanced architecture (v2.0) with Jellyfin integration.

## Overview

The migration process updates your existing Firestore data to include:
- Enhanced movie metadata with Jellyfin integration
- Standalone season documents (extracted from series)
- New media_files collection with comprehensive file metadata
- Media assignment tracking system
- Jellyfin folder organization support

## Before You Begin

### Prerequisites

1. **Backup your Firestore database**
   ```bash
   # Use Firebase Console or gcloud CLI
   gcloud firestore export gs://your-bucket/backup-$(date +%Y%m%d)
   ```

2. **Set up Firebase Admin credentials**
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
   ```

3. **Install dependencies**
   ```bash
   # Backend (Python)
   cd backend
   pip install -r requirements.txt

   # Frontend (TypeScript)
   cd ..
   npm install
   ```

## Migration Methods

You can run the migration from either the backend (Python) or frontend (TypeScript). Choose the method that fits your workflow.

### Method 1: Backend Migration (Python)

**Recommended for:** Server-side execution, batch processing, production environments

```bash
cd backend/scripts

# Dry run - preview changes without applying them
python migrate_to_new_structure.py --dry-run --verbose

# Execute migration
python migrate_to_new_structure.py --verbose
```

**Features:**
- ✅ Direct Firestore access via Firebase Admin SDK
- ✅ Detailed logging and error reporting
- ✅ Progress tracking for each step
- ✅ Dry-run mode for testing

### Method 2: Frontend Migration (TypeScript)

**Recommended for:** Local development, Next.js integration

```bash
# From project root
npx ts-node src/scripts/migrate-to-new-structure.ts --dry-run --verbose

# Or add to package.json scripts:
npm run migrate:dry-run
npm run migrate
```

**Features:**
- ✅ TypeScript type safety
- ✅ Frontend environment integration
- ✅ Same functionality as backend script

## Migration Steps

The migration process runs in 5 sequential steps:

### Step 1: Migrate Movies (📽️)
- Adds `assignmentSummary` field
- Adds `jellyfinInfo` field for folder tracking
- Creates `externalIds` structure (IMDB, TMDB, etc.)
- Adds `contentRating` structure
- Preserves all existing data

### Step 2: Migrate Series & Extract Seasons (📺)
- Extracts `seasons` array to standalone documents
- Creates new `seasons` collection
- Adds `seriesSummary` field
- Adds `seriesAssignmentSummary` field
- Adds `seriesJellyfinInfo` with season folders
- Links seasons to series via `seasonIds` array

### Step 3: Migrate Episodes (🎬)
- Adds `hasFile`, `fileId`, `fileCount` fields
- Adds `jellyfinFilename` field
- Creates `externalIds` structure
- Prepares for file assignment tracking

### Step 4: Create media_files Collection (📁)
- Converts existing `libraryFiles` to new format
- Creates comprehensive file metadata documents
- Links files to movies via `mediaId`
- Prepares for enhanced metadata extraction

### Step 5: Create media_assignments Collection (🔗)
- Creates assignment documents for existing file links
- Links media_files to movies/episodes
- Initializes organization tracking
- Sets up workflow for Jellyfin organization

## Command Line Options

Both scripts support the following options:

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview changes without modifying database |
| `--verbose` / `-v` | Enable detailed logging |

### Examples

```bash
# Preview migration without changes
python migrate_to_new_structure.py --dry-run

# Run migration with detailed logs
python migrate_to_new_structure.py --verbose

# Combine options
python migrate_to_new_structure.py --dry-run --verbose
```

## What Gets Migrated

### Existing Collections (Updated)
- ✅ **movies** - Enhanced with new fields, old data preserved
- ✅ **series** - Enhanced with summaries, seasons extracted
- ✅ **episodes** - Enhanced with file tracking

### New Collections (Created)
- ✨ **seasons** - Standalone season documents
- ✨ **media_files** - Comprehensive file metadata
- ✨ **media_assignments** - File-to-media linking
- ✨ **jellyfin_folders** - Folder structure tracking (empty initially)

## Migration Output

The migration script provides detailed progress reporting:

```
======================================================================
MEDIA ARCHITECTURE MIGRATION v2.0
======================================================================

⚠️  DRY RUN MODE - No changes will be made

Starting migration...

📽️  Step 1/5: Migrating movies...
   ✓ Updated 42 movies

📺 Step 2/5: Migrating series and extracting seasons...
   ✓ Updated 15 series
   ✓ Created 73 season documents

🎬 Step 3/5: Migrating episodes...
   ✓ Updated 312 episodes

📁 Step 4/5: Creating media_files collection...
   ✓ Created 87 media file documents

🔗 Step 5/5: Creating media_assignments...
   ✓ Created 87 assignment documents

======================================================================
MIGRATION COMPLETE
======================================================================

Migration Statistics:
  Movies updated:          42
  Series updated:          15
  Seasons created:         73
  Episodes updated:        312
  Media files created:     87
  Assignments created:     87

✅ Migration completed successfully!
```

## Post-Migration Steps

After running the migration:

1. **Deploy Firestore Security Rules**
   ```bash
   firebase deploy --only firestore:rules
   ```

2. **Update Frontend Application**
   ```bash
   git pull origin refactor
   npm install
   npm run dev
   ```

3. **Re-scan Media Library** (Optional)
   - Use the library scanner to extract enhanced metadata
   - Populates video/audio/subtitle information
   - Extracts codecs, resolution, HDR, 3D, etc.

4. **Verify Data**
   - Check Firestore console
   - Verify new collections exist
   - Spot-check a few documents

## Rollback Procedure

If you need to rollback:

1. **Restore from Backup**
   ```bash
   gcloud firestore import gs://your-bucket/backup-20260123
   ```

2. **Delete New Collections** (if needed)
   ```javascript
   // Use Firebase Console or script
   db.collection('media_files').get().then(snapshot => {
     snapshot.forEach(doc => doc.ref.delete());
   });
   ```

## Troubleshooting

### Error: "Firebase Admin not initialized"
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
```

### Error: "Permission denied"
Ensure your service account has Firestore write permissions.

### Error: "Document not found"
Some documents may have been deleted. Check logs for details.

### Partial Migration Failures
The script tracks errors and continues. Check the error summary at the end.

## Migration Safety

✅ **Safe Operations:**
- Old fields are NOT deleted (backward compatible)
- Existing data is preserved
- New fields are added alongside old ones
- Dry-run mode available for testing

⚠️ **Important Notes:**
- Always backup before migration
- Test with --dry-run first
- Review error logs if any
- Migration is idempotent (safe to re-run)

## Getting Help

If you encounter issues:

1. Check migration logs for error details
2. Run with `--verbose` for more information
3. Verify Firebase Admin credentials
4. Check Firestore security rules
5. Review `IMPLEMENTATION_PROGRESS.md` for architecture details

## Next Steps

After successful migration:

1. ✅ Data structure updated
2. 🎯 Start assigning files to media
3. 📁 Organize files into Jellyfin structure
4. 🔍 Extract enhanced metadata
5. 📺 Configure Jellyfin media server

See `DATA_STRUCTURE_REDESIGN.md` for complete architecture documentation.

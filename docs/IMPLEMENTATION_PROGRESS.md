# Implementation Progress

## ✅ Completed

### Phase 1: TypeScript Interfaces & Types

1. **New Collections Created:**
   - ✅ `MediaFile.type.ts` - Complete interface with video metadata, audio/subtitle tracks
   - ✅ `MediaAssignment.type.ts` - Assignment linking system
   - ✅ `JellyfinFolder.type.ts` - Jellyfin folder management

2. **Updated Existing Types:**
   - ✅ `Movie.type.ts` - Added assignment summary, Jellyfin info, external IDs, content ratings, collections
   - ✅ `Series.type.ts` - Added series summary, assignment summary, Jellyfin info with season folders
   - ✅ `Season.type.ts` - Enhanced with Jellyfin integration, episode tracking
   - ✅ `Episode.type.ts` - Added external IDs, file assignment, Jellyfin filename

3. **Services Created:**
   - ✅ `MediaOrganizationService.ts` - Handles Jellyfin folder generation, file organization, validation

---

## 🚧 Next Steps (In Priority Order)

### 1. Backend Metadata Extraction (High Priority)
**File:** `backend/services/filesystem_manager.py`

Need to enhance the scanner to extract:
- Video metadata (codec, resolution, bitrate, HDR, 3D)
- Audio tracks (codec, channels, language)
- Subtitle tracks (format, language, SDH)
- File checksums (MD5/SHA256)

**Python Libraries Needed:**
```python
pip install pymediainfo ffmpeg-python
```

**Implementation:**
```python
def extract_media_metadata(file_path: str) -> dict:
    # Use ffprobe/pymediainfo to extract all technical specs
    # Return dict matching VideoMetadata, AudioTrack, SubtitleTrack interfaces
```

### 2. Firestore Security Rules
**File:** Create `firestore.rules`

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Media files - authenticated users can read/write
    match /media_files/{fileId} {
      allow read, write: if request.auth != null;
    }
    
    // Media assignments - authenticated users can create/update
    match /media_assignments/{assignmentId} {
      allow read, write: if request.auth != null;
    }
    
    // Jellyfin folders - authenticated users can read/write
    match /jellyfin_folders/{folderId} {
      allow read, write: if request.auth != null;
    }
    
    // Movies/Series - existing rules apply
    match /movies/{movieId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    match /series/{seriesId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    match /seasons/{seasonId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    match /episodes/{episodeId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

### 3. Backend API Endpoints
**File:** Create `backend/api/media_operations.py`

Need endpoints for:
```python
POST /api/media/files/scan           # Scan with enhanced metadata
GET  /api/media/files/{id}           # Get file with full metadata
POST /api/media/assign/movie         # Assign files to movie
POST /api/media/assign/episode       # Assign files to episode
POST /api/media/organize/{assignmentId}  # Trigger file organization
GET  /api/media/jellyfin/validate/{folderId}  # Validate Jellyfin structure
```

### 4. UI Components for Assignment
**Files to Create:**
- `src/app/admin/libraryBrowser/_components/FileMetadataViewer.tsx` - Display detailed file specs
- `src/app/admin/libraryBrowser/_components/MediaAssignmentDialog.tsx` - Assign files to media
- `src/app/admin/libraryBrowser/_components/JellyfinOrganizer.tsx` - Trigger organization

**Component Structure:**
```tsx
<FileMetadataViewer file={mediaFile}>
  - Video specs (codec, resolution, HDR, 3D)
  - Audio tracks list
  - Subtitle tracks list
  - File system info
</FileMetadataViewer>

<MediaAssignmentDialog files={selectedFiles}>
  - Search for movie/episode
  - Select version (1080p, 4K, etc.)
  - Preview Jellyfin folder structure
  - Assign button
</MediaAssignmentDialog>

<JellyfinOrganizer assignment={assignment}>
  - Show target structure
  - Preview operations
  - Organize button
  - Progress tracking
</JellyfinOrganizer>
```

### 5. Update MediaAssignment Component
**File:** `src/app/admin/libraryBrowser/_components/MediaAssignment.tsx`

Add features:
- Display enhanced file metadata (codec, resolution, file size)
- Show assignment status
- "Assign to Media" button
- "Organize Files" button
- Preview Jellyfin folder structure before organizing

### 6. Migration Scripts
**File:** Create `src/scripts/migrate-to-new-structure.ts`

```typescript
// Migrate existing data to new structure
async function migrateMovies() {
  // For each movie with libraryFiles
  // Create media_files entries
  // Create media_assignments
  // Update movie with assignmentSummary
}

async function migrateSeasons() {
  // Extract seasons from series.seasons array
  // Create standalone season documents
  // Update series with seriesSummary
}
```

---

## 📝 Implementation Commands

### To Continue Implementation:

**1. Backend Metadata Extraction:**
```bash
cd backend
pip install pymediainfo ffmpeg-python
```
Then update `backend/services/filesystem_manager.py` to use the new interfaces.

**2. Create Backend Endpoints:**
```bash
# Create new router file
touch backend/api/media_operations.py
```

**3. Build UI Components:**
```typescript
// Reference the new types and services:
import { MediaFile } from '@/types/library/MediaFile.type';
import { MediaAssignment } from '@/types/library/MediaAssignment.type';
import MediaOrganizationService from '@/service/library/MediaOrganizationService';
```

**4. Test Jellyfin Structure Generation:**
```typescript
const orgService = new MediaOrganizationService();
const structure = orgService.generateMovieStructure(movie, file, "1080p");
console.log(structure);
// Should output: "Movie Title (2020) [imdbid-tt123]/Movie Title (2020) - 1080p.mkv"
```

---

## 🎯 Success Criteria

### Phase 1 Complete When:
- ✅ All TypeScript interfaces created
- ✅ All types updated with new fields
- ✅ MediaOrganizationService working
- ⏳ Backend extracts full metadata
- ⏳ Firestore rules deployed

### Phase 2 Complete When:
- ⏳ Can assign files to movies/episodes via UI
- ⏳ Can preview Jellyfin folder structure
- ⏳ Can trigger organization from UI
- ⏳ Can see enhanced metadata in file list

### Phase 3 Complete When:
- ⏳ Files automatically organized to Jellyfin structure
- ⏳ Jellyfin folders validated
- ⏳ Assignment tracking working
- ⏳ Can handle multiple versions

### Phase 4 Complete When:
- ⏳ Existing data migrated
- ⏳ Old fields removed
- ⏳ All features working end-to-end

---

## 💡 Quick Win: Test Current Implementation

You can already test the Jellyfin folder generation:

```typescript
import MediaOrganizationService from '@/service/library/MediaOrganizationService';
import { Movie } from '@/types/collections/Movie.type';
import { MediaFile } from '@/types/library/MediaFile.type';

const service = new MediaOrganizationService();

// Mock movie
const movie: Movie = {
  id: 'test123',
  title: 'The Matrix',
  releaseDate: '31-March-1999',
  externalIds: { imdbId: 'tt0133093' },
  // ... other required fields
};

// Mock file
const file: MediaFile = {
  id: 'file123',
  fileName: 'matrix.mkv',
  fileExtension: '.mkv',
  folderPath: '/media/downloads/matrix',
  // ... other required fields
};

// Generate structure
const structure = service.generateMovieStructure(movie, file, '4K');

console.log(structure);
// Output:
// {
//   libraryRoot: '/media/downloads',
//   mediaFolder: 'The Matrix (1999) [imdbid-tt0133093]',
//   fullPath: '/media/downloads/The Matrix (1999) [imdbid-tt0133093]/The Matrix (1999) [imdbid-tt0133093] - 4K.mkv',
//   folderName: 'The Matrix (1999) [imdbid-tt0133093]',
//   fileName: 'The Matrix (1999) [imdbid-tt0133093] - 4K.mkv'
// }
```

---

## 📚 Reference Documents

- Main Design: [DATA_STRUCTURE_REDESIGN.md](./DATA_STRUCTURE_REDESIGN.md)
- Jellyfin Naming: https://jellyfin.org/docs/general/server/media/movies/
- Firebase Collections: [FIREBASE_COLLECTIONS.md](./FIREBASE_COLLECTIONS.md)

---

**Last Updated:** January 23, 2026
**Branch:** refactor
**Status:** Phase 1 mostly complete, ready for Phase 2

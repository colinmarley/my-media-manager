# Media Assignment Flow Implementation Guide

## Overview

This implementation provides a comprehensive media assignment workflow that allows users to:
1. Search for movies/TV shows as they type (Firebase autocomplete)
2. Search external APIs (OMDB) with a button click
3. View combined results from both sources
4. Automatically save new media to Firebase when assigned
5. Assign scanned files to media metadata

## Architecture

### Components

**MediaAssignmentDialog** (`src/app/admin/libraryBrowser/_components/MediaAssignmentDialog.tsx`)
- Main UI component for media assignment
- Autocomplete search (Firebase - as user types)
- Button-triggered OMDB search
- Results display with source indicators
- File assignment interface

**MediaAssignmentSearchService** (`src/service/library/MediaAssignmentSearchService.ts`)
- Handles all search operations
- Firebase queries with `titleLower` field
- OMDB API integration
- Result deduplication
- Automatic saving to Firebase

**OmdbService** (`src/service/omdb/OmdbService.ts`)
- OMDB API wrapper
- Existing service, no changes needed

## User Flow

### 1. User Types in Search Box (Autocomplete)
```
User types "matrix" →
├─ Triggers handleAutocompleteSearch()
├─ Searches Firebase collections only (fast)
├─ Uses titleLower field for case-insensitive prefix matching
└─ Shows results with ✓ indicator (in collection)
```

### 2. User Clicks Search Button
```
User clicks search icon →
├─ Triggers handleOMDBSearch()
├─ Searches both Firebase AND OMDB
├─ Combines and deduplicates results
├─ Shows results with:
    ├─ ✓ = In your Firebase collection
    └─ ⬇ = From OMDB (will be added to collection)
```

### 3. User Selects a Result
```
User selects from dropdown →
├─ If source === 'firebase':
│   └─ Use existing data directly
└─ If source === 'omdb':
    ├─ Fetch full OMDB data (retrieveMediaDataById)
    ├─ Convert to Movie/Series format
    ├─ Save to Firebase (with titleLower field)
    └─ Use newly saved data
```

### 4. User Assigns Files
```
User clicks "Assign" →
├─ Create assignment records
├─ Link scanned files to media
├─ Generate Jellyfin folder structure
└─ Save assignment to database
```

## Key Features

### Dual Search Strategy

**Autocomplete Search** (As User Types)
- **Source**: Firebase only
- **Speed**: Very fast (indexed queries)
- **Triggers**: Every keystroke (debounced)
- **Results**: Up to 10 items from user's collection
- **Purpose**: Quick access to existing media

**Button Search** (Explicit Search)
- **Source**: Firebase + OMDB combined
- **Speed**: Slower (external API call)
- **Triggers**: User clicks search button
- **Results**: Up to 10 Firebase + 20 OMDB
- **Purpose**: Find new media not in collection

### Automatic Firebase Integration

When user selects an OMDB result:
1. Full data fetched from OMDB API
2. Converted to proper Firebase format
3. `titleLower` field added automatically
4. Saved to `movies` or `series` collection
5. Selection updated to use Firebase document

This means OMDB results become permanent part of the user's collection.

### Result Indicators

```
✓ The Matrix (1999)        ← In your collection (Firebase)
⬇ The Matrix Reloaded (2003) ← From OMDB (will be added)
```

Visual indicators help users understand data sources.

## Implementation Details

### Search Service Methods

**searchFirebase(query, type)**
- Fast Firebase-only search
- Uses `titleLower` field with range queries
- Returns up to 10 results
- Used for autocomplete

**searchOMDB(query, type)**
- External OMDB API search
- Filters by media type
- Returns results not in Firebase
- Used for button search

**combinedSearch(query, type)**
- Runs both searches in parallel
- Deduplicates by IMDb ID
- Prioritizes Firebase results
- Used for comprehensive search

**saveMovieToFirebase(omdbData)**
- Converts OMDB format to Movie type
- Adds `titleLower` field
- Saves to `movies` collection
- Returns new document ID

**saveSeriesToFirebase(omdbData)**
- Converts OMDB format to Series type
- Adds `titleLower` field
- Saves to `series` collection
- Returns new document ID

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User Types "matrix"                       │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
           ┌───────────────────────┐
           │  Autocomplete Search  │
           │    (Firebase Only)    │
           └───────────┬───────────┘
                       ↓
              ┌────────────────┐
              │  Show Results  │
              │    ✓ Matrix    │
              └────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                User Clicks Search Button                     │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
         ┌─────────────────────────┐
         │   Combined Search       │
         │  Firebase + OMDB API    │
         └──────────┬──────────────┘
                    ↓
     ┌──────────────────────────┐
     │   Deduplicate Results    │
     │   (by IMDb ID)           │
     └──────────┬───────────────┘
                ↓
      ┌─────────────────────┐
      │   Show Combined     │
      │  ✓ Matrix (1999)    │
      │  ⬇ Matrix 2 (2003)  │
      └─────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              User Selects OMDB Result (⬇)                   │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
              ┌────────────────────┐
              │  Fetch Full Data   │
              │    from OMDB       │
              └─────────┬──────────┘
                        ↓
              ┌────────────────────┐
              │  Convert Format    │
              │  Add titleLower    │
              └─────────┬──────────┘
                        ↓
              ┌────────────────────┐
              │ Save to Firebase   │
              │  movies/series     │
              └─────────┬──────────┘
                        ↓
              ┌────────────────────┐
              │ Use Saved Document │
              │  for Assignment    │
              └────────────────────┘
```

## Configuration

### Environment Variables Required

```env
# OMDB API
NEXT_PUBLIC_OMDB_API_KEY=your_api_key_here
NEXT_PUBLIC_OMDB_BASE_URL=http://www.omdbapi.com/

# Firebase (already configured)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
```

### Firebase Collections Structure

**movies** collection:
```typescript
{
  id: string;                 // Auto-generated
  title: string;              // "The Matrix"
  titleLower: string;         // "the matrix" (for search)
  externalIds: {
    imdbId: string;          // "tt0133093"
  },
  omdbData: OmdbResponseFull, // Full OMDB response
  // ... other Movie fields
}
```

**series** collection:
```typescript
{
  id: string;
  title: string;
  titleLower: string;
  externalIds: {
    imdbId: string;
  },
  omdbData: OmdbResponseFull,
  // ... other Series fields
}
```

## Testing the Implementation

### Test Case 1: Search Existing Movie
1. Type "matrix" in search box
2. Should see autocomplete results from Firebase (✓)
3. Select "The Matrix (1999)"
4. Should load immediately (no OMDB call)

### Test Case 2: Search New Movie
1. Type "inception" in search box
2. Click search button (🔍)
3. Should see combined results
4. Select OMDB result (⬇)
5. Should fetch, save, and load movie data

### Test Case 3: Media Type Toggle
1. Select "Movie" radio button
2. Search "breaking bad"
3. Should see no results (type mismatch)
4. Select "TV Episode" radio button
5. Search again
6. Should see series results

### Test Case 4: Assignment Flow
1. Search and select a movie
2. Choose quality version (1080p)
3. Review Jellyfin folder structure preview
4. Click "Assign"
5. Files should be linked to media

## Error Handling

### Network Errors
```typescript
try {
  const results = await searchOMDB(query);
} catch (error) {
  setError('Search failed. Please check your connection.');
}
```

### OMDB API Errors
- Rate limiting: Handled by displaying error message
- Invalid API key: Shows configuration error
- No results: Displays "No results found" message

### Firebase Errors
- Permission denied: Check Firestore rules
- Network timeout: Retry with exponential backoff
- Index missing: Automatic index creation prompt

## Performance Optimization

### Autocomplete Debouncing
```typescript
// Add debounce to prevent excessive Firebase queries
const debouncedSearch = debounce(handleAutocompleteSearch, 300);
```

### Result Caching
```typescript
// Cache recent searches to avoid duplicate queries
const searchCache = new Map<string, SearchResult[]>();
```

### Lazy Loading
- Only fetch full OMDB data when result is selected
- Don't preload all images
- Use pagination for large result sets

## Future Enhancements

### 1. Episode Selection UI
Currently shows placeholder. Implement:
- Season selector dropdown
- Episode grid/list
- Bulk episode assignment

### 2. Additional APIs
- **TVDB**: For TV show metadata
- **TMDB**: For additional movie data
- **AniList**: For anime content

### 3. Smart Matching
- Parse filename to pre-fill search
- Suggest best match automatically
- Confidence scores for auto-assignment

### 4. Batch Operations
- Assign multiple files at once
- Bulk import from scan results
- Queue-based processing

## Troubleshooting

### Search returns no results
- Check OMDB API key is valid
- Verify network connectivity
- Check search query length (min 2 chars)
- Try different search terms

### Can't save to Firebase
- Check Firestore security rules
- Verify authentication state
- Check Firebase quotas
- Review browser console for errors

### Autocomplete not working
- Verify `titleLower` field exists on documents
- Run migration script if needed
- Check Firebase indexes are deployed
- Clear browser cache

### Duplicate results showing
- Check IMDb ID deduplication logic
- Verify Firebase documents have imdbId
- Review search query formatting

## Related Files

- `/src/service/library/MediaAssignmentSearchService.ts` - Search service
- `/src/app/admin/libraryBrowser/_components/MediaAssignmentDialog.tsx` - UI component
- `/src/service/omdb/OmdbService.ts` - OMDB API wrapper
- `/src/utils/titleUtils.ts` - Title handling utilities
- `/scripts/add-titlelower-field.ts` - Migration script
- `/firestore.indexes.json` - Firestore index configuration

## Support

For issues or questions:
1. Check Firebase Console for errors
2. Review browser network tab
3. Check Firestore security rules
4. Verify API keys in environment variables
5. Review console logs for debugging info

## Summary

This implementation provides a production-ready media assignment flow that:
- ✅ Searches Firebase as users type (fast autocomplete)
- ✅ Searches OMDB on button click (comprehensive results)
- ✅ Automatically saves new media to Firebase
- ✅ Provides clear visual indicators for data sources
- ✅ Handles errors gracefully
- ✅ Supports both movies and TV series
- ✅ Integrates with existing codebase seamlessly

The dual-search strategy ensures users can quickly find existing media while also discovering new content from external APIs, with automatic persistence to their personal collection.

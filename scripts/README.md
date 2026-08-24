# Title Search Optimization Migration

This directory contains the migration script to add the `titleLower` field to existing movies and series documents in Firestore.

## Overview

The `titleLower` field enables efficient case-insensitive search queries in Firestore. Without it, searches would require:
- Client-side filtering (slow for large datasets)
- Complex query patterns (limited functionality)

With `titleLower`, we can use Firestore's native range queries for fast, server-side prefix matching.

## Prerequisites

1. **Firebase Admin SDK Service Account Key**
   - Go to Firebase Console: [https://console.firebase.google.com](https://console.firebase.google.com)
   - Select your project
   - Navigate to: Project Settings → Service Accounts
   - Click "Generate New Private Key"
   - Save the JSON file as `service-account-key.json` in the project root
   - ⚠️ **Never commit this file to git** (it's in .gitignore)

2. **Node.js Dependencies**
   ```bash
   npm install firebase-admin --save-dev
   npm install -D @types/node
   ```

## Running the Migration

### Option 1: Using ts-node (Recommended)
```bash
npx ts-node scripts/add-titlelower-field.ts
```

### Option 2: Compile then run
```bash
npx tsc scripts/add-titlelower-field.ts
node scripts/add-titlelower-field.js
```

## What the Script Does

1. Connects to your Firestore database using Admin SDK
2. Processes `movies` collection:
   - Reads all documents
   - Adds `titleLower: title.toLowerCase()` field
   - Skips documents that already have the field
   - Updates in batches of 500 for efficiency
3. Processes `series` collection (same steps)
4. Reports summary of updates

## After Migration

1. **Deploy Firestore Indexes**
   ```bash
   firebase deploy --only firestore:indexes
   ```
   This creates indexes on the `titleLower` field for both collections.

2. **Wait for Index Building**
   - Go to Firebase Console → Firestore Database → Indexes
   - Wait for indexes to show "Enabled" status (may take a few minutes)

3. **Test Search Functionality**
   - Open the Media Assignment Dialog
   - Try searching for movies/series
   - Verify search is working and fast

## Going Forward

When creating or updating movies/series documents, always use the utility functions:

```typescript
import { prepareMovieData, prepareSeriesData } from '@/utils/titleUtils';

// Creating a new movie
const movieData = prepareMovieData({
  title: "The Matrix",
  // ... other fields
});
await firestore.collection('movies').add(movieData);

// Updating a movie title
const updates = prepareTitleForStorage("The Matrix Reloaded");
await firestore.collection('movies').doc(id).update(updates);
```

These utilities automatically set the `titleLower` field.

## Troubleshooting

### Error: "Service account key not found"
- Make sure `service-account-key.json` exists in the project root
- Check the path in the migration script matches your setup

### Error: "Permission denied"
- Verify the service account has Firestore read/write permissions
- Check Firebase Console → IAM & Admin → Service Accounts

### Error: "Cannot find module firebase-admin"
- Run: `npm install firebase-admin --save-dev`

### Script hangs or times out
- Large collections may take several minutes
- The script uses batched writes (500 per batch) for efficiency
- Check Firebase Console quota limits if dealing with thousands of documents

## Technical Details

### Index Configuration
The `firestore.indexes.json` includes:
```json
{
  "collectionGroup": "movies",
  "fields": [
    { "fieldPath": "titleLower", "order": "ASCENDING" }
  ]
}
```

### Query Pattern
The search uses range queries:
```typescript
query(
  collection(db, 'movies'),
  orderBy('titleLower'),
  startAt(searchLower),
  endAt(searchLower + '\uf8ff'),
  limit(20)
)
```

This finds all documents where `titleLower` starts with the search query.

### Performance
- **Before**: O(n) client-side filtering
- **After**: O(log n) index-based search
- Typical search: <100ms even with thousands of documents

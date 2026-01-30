# Quick Start: Title Search Optimization

## 🚀 Implementation Complete!

The following changes have been made to enable efficient case-insensitive search:

### ✅ What Was Done

1. **Type Definitions Updated**
   - Added `titleLower: string` field to `Movie` type
   - Added `titleLower: string` field to `Series` type

2. **Search Logic Updated**
   - MediaAssignmentDialog now uses Firebase Firestore directly
   - Uses range queries on `titleLower` field for efficient prefix matching
   - Searches up to 20 results, sorted alphabetically

3. **Firestore Indexes Added**
   - Index on `movies.titleLower`
   - Index on `series.titleLower`

4. **Migration Script Created**
   - `scripts/add-titlelower-field.ts` - Adds `titleLower` to existing documents
   - `scripts/README.md` - Detailed migration instructions

5. **Utility Functions Created**
   - `src/utils/titleUtils.ts` - Helper functions for handling titles

---

## 📋 Next Steps (In Order)

### Step 1: Get Firebase Service Account Key
```bash
# 1. Go to Firebase Console
# 2. Project Settings → Service Accounts
# 3. Click "Generate New Private Key"
# 4. Save as: service-account-key.json (in project root)
```

### Step 2: Install Dependencies
```bash
npm install firebase-admin --save-dev
npm install -D @types/node
```

### Step 3: Run Migration Script
```bash
npx ts-node scripts/add-titlelower-field.ts
```

### Step 4: Deploy Firestore Indexes
```bash
firebase deploy --only firestore:indexes
```

### Step 5: Wait for Indexes
- Go to Firebase Console → Firestore Database → Indexes
- Wait until status shows "Enabled" (usually 2-5 minutes)

### Step 6: Test Search
- Open your app
- Go to Library Browser → Select files → Assign to Media
- Try searching for a movie or series
- Search should now work instantly!

---

## 🔧 When Adding New Movies/Series

Always set the `titleLower` field when creating or updating:

```typescript
import { prepareMovieData } from '@/utils/titleUtils';

// Creating new movie
const movie = prepareMovieData({
  title: "The Matrix",
  // ... other fields
});
await addDoc(collection(db, 'movies'), movie);

// Or manually:
await addDoc(collection(db, 'movies'), {
  title: "The Matrix",
  titleLower: "the matrix",
  // ... other fields
});
```

---

## 📊 Performance Benefits

**Before:**
- Fetched ALL documents from Firestore
- Filtered on client-side
- Slow with large collections
- Network-intensive

**After:**
- Server-side index-based search
- Returns only matching documents (max 20)
- Fast even with thousands of movies
- Minimal network usage

---

## 🐛 Troubleshooting

### Search still returns HTML error
- Make sure you ran the migration script
- Verify indexes are deployed and enabled
- Check browser console for detailed errors

### "Missing index" error in console
- Indexes may still be building
- Check Firebase Console → Indexes tab
- Wait for "Enabled" status

### No results found
- Verify your Firestore collections have data
- Check that documents have `title` field
- Run migration script to add `titleLower` field

---

## 📚 Files Changed

- ✅ `src/types/collections/Movie.type.ts`
- ✅ `src/types/collections/Series.type.ts`
- ✅ `src/app/admin/libraryBrowser/_components/MediaAssignmentDialog.tsx`
- ✅ `firestore.indexes.json`
- ✅ `scripts/add-titlelower-field.ts` (new)
- ✅ `scripts/README.md` (new)
- ✅ `src/utils/titleUtils.ts` (new)

---

## 💡 How It Works

The search uses Firestore range queries:

```typescript
// User types: "mat"
const searchLower = "mat";

query(
  collection(db, 'movies'),
  orderBy('titleLower'),        // Use indexed field
  startAt(searchLower),          // Start at "mat"
  endAt(searchLower + '\uf8ff'), // End at "mat" + high unicode
  limit(20)                      // Max 20 results
)

// Returns: "The Matrix", "Matilda", "Match Point", etc.
```

The `\uf8ff` character is a high Unicode character that ensures we capture all strings starting with the search term.

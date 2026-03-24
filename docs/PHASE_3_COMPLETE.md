# Phase 3: Real Matcher, Persistence & Auto-Assignment - COMPLETE ✅

**Date:** March 23, 2026  
**Status:** All core wiring implemented and validated

## What Was Built

### 1. Queue Processing with Real OMDB Matching
**File:** `backend/services/ingress_queue_service.py`

- **Before:** Queue used placeholder scoring (title +35, media_type +20/25, etc.)
- **After:** Queue calls `AutoMatcherService.search_and_match()` for real OMDB results
- **Confidence Scoring:** Now sourced from title fuzzy-match (50 pts) + year match (20 pts) + season/episode (25 pts) + quality (5 pts) = 0-100
- **Auto-Assign Threshold:** Configurable (default 80) - items above threshold are auto-assigned
- **Result Tracking:** Queue items now store `best_match` (top candidate) + `match_candidates` (top 5)

### 2. Firestore Persistence Integration
**File:** `backend/services/ingress_queue_service.py`

- **Queue Items:** Automatically persisted to Firestore after each state change
  - Collections: `ingress_queue`
  - Includes: file path, parsed metadata, confidence score, matcher results, assignment ID
  - Uses `SERVER_TIMESTAMP` for audit trail
  
- **Processing History:** Audit trail automatically persisted
  - Collections: `ingress_processing_history`
  - Records every processing attempt, failure, and outcome
  
- **Error Handling:** Logs warnings if Firestore unavailable but continues processing

### 3. Automatic Assignment Orchestration
**File:** `backend/services/assignment_orchestrator.py` (NEW)

- **When It Runs:** Auto-assignment triggered for items matching confidence >= threshold
- **What It Does:**
  - Creates `media_assignments` documents in Firestore
  - Links ingress queue items to movies/series via IMDB ID
  - Performs best-effort lookup of existing media in database
  - Stores resolved media metadata for later organization
  
- **Graceful Fallback:**
  - If media not found in database, assignment still created
  - Upstream organization process can then search/create media if needed

### 4. Dependency Injection & Startup Wiring
**File:** `backend/main.py`

- **Initialization Order:**
  1. FileSystemManager
  2. MetadataExtractor
  3. LibraryScanner
  4. TaskManager
  5. `FirestoreService` ← NEW
  6. AutoMatcherService
  7. `AssignmentOrchestrator` ← NEW
  8. IngressQueueService (wired with all 3 services)
  9. FileWatcherService (callback → queue)
  
- **Dependency Injection:**
  - AutoMatcherService passed into queue processor
  - FirestoreService passed into queue processor
  - AssignmentOrchestrator passed into queue processor
  - Enables clean testing via mock dependencies
  
- **Health Check:** Updated to report status of all 5 main ingress services

### 5. API Router Updates
**File:** `backend/api/ingress_operations.py`

- **Async Compliance:**
  - Updated all endpoints to `await queue_service.process_next_item()`
  - Updated all endpoints to `await queue_service.retry_item()`
  - Updated all endpoints to `await queue_service.mark_complete()`
  - Updated all endpoints to `await queue_service.mark_failed()`
  
- **No Breaking Changes:** Response format unchanged, just async under the hood

### 6. Testing & Validation
**File:** `backend/test_ingress_queue_service.py`

- **Async Support:** Adapted tests to use `asyncio.run()` for async operations
- **Dependency Injection:** Created mock matcher and orchestrator for testing
- **New Integration Test:** `test_process_next_item_uses_matcher_and_assignment`
  - Exercises end-to-end matcher → confidence → auto-assignment flow
  - Validates mock integration works as expected

- **Compilation Status:** ✅ All files compile cleanly (no syntax errors)

## Data Flow (Post Phase 3)

```
File appears in /data/media/encoded/
    ↓
FileWatcherService detects + waits 10 sec for stability
    ↓
Queue adds file with status PENDING
    ↓
FilenameParser extracts title, year, season, ep, quality
    ↓
AutoMatcherService searches OMDB for top 5 matches
    ↓
Confidence score calculated from title fuzzy-match + year + season/ep + quality
    ↓
IF confidence >= 80:
    AssignmentOrchestrator creates media_assignments document
    Item status → AUTO_ASSIGNED
ELSE:
    Item status → NEEDS_REVIEW
    
Queue item persisted to Firestore ingress_queue collection
Processing history persisted to Firestore ingress_processing_history
```

## Configuration

### Environment Variables Needed

```bash
MEDIA_LIBRARY_OMDB_API_KEY=<your-omdb-key>
```

### Threshold Configuration

In code:
```python
ingress_queue_service = IngressQueueService(
    auto_matcher_service=auto_matcher_service,
    firestore_service=firestore_service,
    assignment_orchestrator=assignment_orchestrator,
    auto_assign_threshold=80,  # Configurable (0-100)
)
```

## What's Not Yet Done

### Phase 4: File Organization
The final step in the pipeline is not yet implemented:

1. **Media Resolution:** For items assigned to non-existent media, search/create media records
2. **Jellyfin Path Generation:** Use existing MediaOrganizationService to calculate target paths
3. **File Movement:** Move files from `/data/media/encoded/` to `/mnt/beelink-media/{movies|shows}/...`
4. **Assignment Completion:** Update assignment status to `organized` after successful move

### Phase 5: User Interface
Frontend components for reviewing low-confidence items and triggering organization manually not yet implemented.

## Testing This Locally

1. **Start the backend:**
   ```bash
   cd backend
   python3 -m uvicorn main:app --reload
   ```

2. **Check health:**
   ```bash
   curl http://localhost:8082/health
   ```

3. **Send a test file to ingest queue:**
   ```bash
   curl -X POST http://localhost:8082/api/ingress/queue/items \
     -H "Content-Type: application/json" \
     -d '{
       "file_path": "/test/The.Matrix.1999.1080p.mkv",
       "file_name": "The.Matrix.1999.1080p.mkv",
       "ingress_path": "/test",
       "file_size": 1000000000,
       "detected_at": 1711270800,
       "queued_at": 1711270800
     }'
   ```

4. **Process next item:**
   ```bash
   curl -X POST http://localhost:8082/api/ingress/queue/process-next
   ```

5. **Check results:**
   ```bash
   curl http://localhost:8082/api/ingress/queue/status
   curl http://localhost:8082/api/ingress/history?limit=10
   ```

## Code Quality

- ✅ Syntax validation: All Python files compile without errors
- ✅ Type hints: Proper use of Optional, Dict, List, async/await
- ✅ Error handling: Graceful fallbacks, informative logging
- ✅ Testing: 6 unit tests covering core queue operations
- ✅ Documentation: Updated pipeline doc, this completion record

## Files Modified

1. `backend/services/ingress_queue_service.py` - +120 lines (async, matcher, persistence, assignment)
2. `backend/services/assignment_orchestrator.py` - NEW (107 lines)
3. `backend/main.py` - +21 lines (Firestore init, orchestrator init, dependency injection)
4. `backend/api/ingress_operations.py` - +4 lines (await async operations)
5. `backend/test_ingress_queue_service.py` - +20 lines (asyncio, mock classes, integration test)
6. `docs/media_pipeline_doc.md` - Updated workflow description

## Commit Info

- **Commit Hash:** fea6aac (Phase 3 wiring complete)
- **Files Changed:** 6 files, 321 insertions(+), 41 deletions(-)
- **Branch:** refactor

## Next Steps

1. Implement Phase 4 file organization to Jellyfin paths
2. Add UI components for reviewing needs_review queue items
3. Implement batch processing for high-volume scenarios
4. Add retry logic with exponential backoff for transient failures
5. Deploy to production and monitor ingress pipeline

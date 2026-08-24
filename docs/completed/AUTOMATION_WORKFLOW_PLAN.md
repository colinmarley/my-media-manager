# Automated Media Ingress Workflow - Implementation Plan

## Overview

This document outlines the changes needed to transform the current manual media assignment workflow into an automated system that monitors an ingress folder, automatically assigns metadata, and organizes files into the Jellyfin library structure.

## Current Workflow vs. Automated Workflow

### Current Workflow (Manual)
```
1. User navigates to Library Browser
2. User manually scans a library path
3. User selects files
4. User searches for media (OMDB/Firebase)
5. User manually assigns files to media
6. User triggers organization
7. Files moved to Jellyfin structure
```

### New Automated Workflow
```
1. Files arrive in /data/media/encoded/ (from HandBrake)
2. File Watcher Service detects new files
3. System parses filename for metadata
4. System searches OMDB/TMDB automatically
5. System calculates confidence score
6. High confidence: Auto-assign & organize
7. Low confidence: Queue for manual review
8. Files moved to Jellyfin library on NAS
```

---

## Architecture Changes

### New Components Required

#### 1. File Watcher Service (Backend - Python)
**Location**: `backend/services/file_watcher_service.py`

**Responsibilities**:
- Monitor ingress folder(s) for new files
- Detect file creation/modification events
- Debounce events (wait for file write completion)
- Queue files for processing
- Support multiple ingress paths (movies/, shows/)

**Key Methods**:
```python
start_watching(ingress_paths: List[str])
stop_watching()
on_file_created(file_path: str)
on_file_modified(file_path: str)
is_file_stable(file_path: str) -> bool  # Ensure write complete
queue_for_processing(file_path: str)
```

**Technology Options**:
- `watchdog` library for cross-platform file watching
- Polling alternative for network shares
- Event debouncing (5-10 second stability check)

---

#### 2. Filename Parser Service (Backend - Python)
**Location**: `backend/services/filename_parser.py`

**Responsibilities**:
- Parse movie filenames: `Movie Name (2024) [1080p].mkv`
- Parse TV show filenames: `Show Name - s01e01.mkv`
- Extract title, year, season, episode, quality
- Detect movie vs. episode from filename pattern
- Handle common naming conventions

**Key Methods**:
```python
parse_filename(filename: str) -> ParsedMediaInfo
detect_media_type(filename: str) -> MediaType  # movie | episode
extract_movie_info(filename: str) -> MovieInfo
extract_episode_info(filename: str) -> EpisodeInfo
normalize_title(title: str) -> str  # Remove special chars
```

**Parsing Patterns**:
```python
# Movies
- "Movie Name (2024).mkv"
- "Movie.Name.2024.1080p.mkv"
- "Movie_Name_2024_BluRay.mkv"

# TV Shows
- "Show Name - s01e01.mkv"
- "Show.Name.S01E01.mkv"
- "Show Name 1x01.mkv"
- "Show Name - 01x01 - Episode Title.mkv"
```

---

#### 3. Auto-Matcher Service (Backend - Python)
**Location**: `backend/services/auto_matcher_service.py`

**Responsibilities**:
- Search OMDB/TMDB based on parsed info
- Match results against parsed data
- Calculate confidence scores
- Handle ambiguous matches
- Store match candidates

**Key Methods**:
```python
search_and_match(parsed_info: ParsedMediaInfo) -> MatchResults
calculate_confidence(parsed_info, search_result) -> ConfidenceScore
find_best_match(candidates: List[SearchResult]) -> BestMatch
get_all_candidates(parsed_info) -> List[MatchCandidate]
```

**Confidence Scoring Algorithm**:
```python
Base Score: 0-100

Title Match:
  - Exact match: +40 points
  - Fuzzy match (>90%): +35 points
  - Fuzzy match (>75%): +25 points
  - Fuzzy match (<75%): +10 points

Year Match (for movies):
  - Exact year: +30 points
  - ±1 year: +20 points
  - ±2 years: +10 points
  - No year in filename: +15 points (assume correct)

Episode Validation (for TV):
  - Season/Episode exists in series: +30 points
  - Season exists but episode TBD: +20 points

Thresholds:
  - ≥80: Auto-assign (high confidence)
  - 60-79: Auto-assign with flag (medium confidence)
  - 40-59: Queue for review (low confidence)
  - <40: Queue for review (very low confidence)
```

---

#### 4. Auto-Assignment Service (Backend - Python)
**Location**: `backend/services/auto_assignment_service.py`

**Responsibilities**:
- Create media assignments automatically
- Trigger file organization
- Update Firebase collections
- Handle assignment failures
- Maintain processing history

**Key Methods**:
```python
auto_assign(file_path: str, match_result: MatchResult) -> Assignment
create_assignment_record(file, media, confidence)
organize_immediately(assignment_id: str)
handle_assignment_failure(file_path, error)
retry_failed_assignment(assignment_id: str)
```

---

#### 5. Ingress Processing Queue (Backend - Python)
**Location**: `backend/services/ingress_queue_service.py`

**Responsibilities**:
- Manage processing queue
- Priority handling
- Retry logic for failures
- Status tracking
- Processing history

**Key Methods**:
```python
add_to_queue(file_info: FileInfo, priority: int)
process_next_item() -> ProcessingResult
get_queue_status() -> QueueStatus
retry_item(item_id: str)
mark_complete(item_id: str)
mark_failed(item_id: str, reason: str)
get_processing_history(filters) -> List[ProcessedItem]
```

**Queue States**:
- `pending`: Waiting to be processed
- `processing`: Currently being processed
- `auto_assigned`: Successfully auto-assigned
- `needs_review`: Confidence too low
- `failed`: Processing error
- `completed`: Successfully organized

---

#### 6. Processing Orchestrator (Backend - Python)
**Location**: `backend/services/processing_orchestrator.py`

**Responsibilities**:
- Coordinate entire automation pipeline
- Execute processing steps in sequence
- Handle errors and retries
- Log all actions
- Emit events for monitoring

**Processing Flow**:
```python
async def process_ingress_file(file_path: str):
    1. Validate file (exists, accessible, stable)
    2. Parse filename → ParsedInfo
    3. Search for matches → MatchResults
    4. Calculate confidence → ConfidenceScore
    5. If confidence ≥ threshold:
         a. Create assignment
         b. Organize file
         c. Update Firebase
         d. Mark complete
    6. If confidence < threshold:
         a. Add to review queue
         b. Notify user
    7. Handle errors:
         a. Log error
         b. Add to retry queue
         c. Notify admin
```

---

### Database Changes

#### New Firebase Collections

##### `ingress_queue`
```typescript
{
  id: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  detectedAt: Date;
  queuedAt: Date;
  status: 'pending' | 'processing' | 'auto_assigned' | 'needs_review' | 'failed' | 'completed';
  priority: number;  // 1-10, higher = more urgent
  
  // Parsed information
  parsedInfo: {
    mediaType: 'movie' | 'episode';
    title: string;
    year?: number;
    season?: number;
    episode?: number;
    quality?: string;
  };
  
  // Match results
  matchResults?: {
    candidates: MatchCandidate[];
    bestMatch?: {
      mediaId: string;
      mediaTitle: string;
      confidenceScore: number;
      source: 'omdb' | 'tmdb' | 'firebase';
    };
  };
  
  // Assignment (if auto-assigned)
  assignmentId?: string;
  
  // Error handling
  attempts: number;
  lastAttempt?: Date;
  lastError?: string;
  
  // Processing history
  processedAt?: Date;
  processingDuration?: number;  // milliseconds
  
  createdAt: Date;
  updatedAt: Date;
}
```

##### `ingress_processing_history`
```typescript
{
  id: string;
  queueItemId: string;
  filePath: string;
  fileName: string;
  
  status: 'success' | 'failed' | 'needs_review';
  confidenceScore?: number;
  autoAssigned: boolean;
  
  assignedTo?: {
    mediaType: 'movie' | 'episode';
    mediaId: string;
    mediaTitle: string;
  };
  
  finalPath?: string;  // Where file was organized to
  
  processingSteps: {
    step: string;
    status: 'success' | 'failed';
    duration: number;
    error?: string;
  }[];
  
  processedAt: Date;
  processingDuration: number;
}
```

##### `ingress_config`
```typescript
{
  id: 'default';
  
  // Ingress paths to monitor
  ingressPaths: {
    movies: string;      // /data/media/encoded/movies
    shows: string;       // /data/media/encoded/shows
  };
  
  // Destination paths (NAS)
  destinationPaths: {
      movies: string;      // /ark/media/jellyfin/movies
      shows: string;       // /ark/media/jellyfin/shows
  };
  
  // Automation settings
  autoAssignEnabled: boolean;
  autoOrganizeEnabled: boolean;
  confidenceThreshold: number;  // 80 (auto-assign if ≥ this)
  
  // Processing settings
  fileStabilityWaitSeconds: number;  // 10
  maxRetryAttempts: number;  // 3
  retryDelaySeconds: number;  // 60
  
  // Monitoring
  enabled: boolean;
  pollIntervalSeconds?: number;  // For polling mode instead of file watching
  
  updatedAt: Date;
  updatedBy: string;
}
```

---

### Frontend Changes

#### New Pages/Components

##### 1. Ingress Monitor Dashboard
**Location**: `src/app/admin/ingress/page.tsx`

**Features**:
- Real-time queue status
- Processing statistics
- Recent activity feed
- Success/failure rates
- Average processing time

**UI Sections**:
```
┌─────────────────────────────────────────┐
│ Ingress Monitor Dashboard               │
├─────────────────────────────────────────┤
│ Statistics Cards:                       │
│ [Pending: 5] [Processing: 2]            │
│ [Auto-Assigned: 142] [Needs Review: 3]  │
│                                         │
│ Recent Activity:                        │
│ ✅ Movie Name (2024) - Auto-assigned   │
│ ⚠️  Show Name S01E05 - Needs review     │
│ ✅ Another Movie - Auto-assigned        │
│                                         │
│ [View Queue] [View History]             │
└─────────────────────────────────────────┘
```

##### 2. Review Queue
**Location**: `src/app/admin/ingress/review/page.tsx`

**Features**:
- List of items needing manual review
- Show all match candidates with scores
- Quick assignment interface
- Bulk actions
- Search/filter/sort

**UI Layout**:
```
┌─────────────────────────────────────────┐
│ Items Needing Review (3)                │
├─────────────────────────────────────────┤
│ File: Movie_Name_2024.mkv               │
│ Parsed: Movie Name (2024)               │
│                                         │
│ Match Candidates:                       │
│ ⭐ Movie Name (2024) - Score: 75        │
│    [Assign] [View Details]              │
│ ⭐ Movie Name 2 (2024) - Score: 60      │
│    [Assign] [View Details]              │
│ ⭐ Similar Movie (2023) - Score: 45     │
│    [Assign] [View Details]              │
│                                         │
│ [Search Again] [Skip] [Delete File]     │
├─────────────────────────────────────────┤
│ [Next Item]                              │
└─────────────────────────────────────────┘
```

##### 3. Processing History
**Location**: `src/app/admin/ingress/history/page.tsx`

**Features**:
- Searchable processing history
- Filter by status, date, media type
- Export to CSV
- Reprocess failed items
- View detailed logs

##### 4. Ingress Configuration
**Location**: `src/app/admin/ingress/config/page.tsx`

**Features**:
- Configure ingress paths
- Configure destination paths
- Set confidence thresholds
- Enable/disable automation
- Adjust retry settings
- Test file watcher

---

### API Endpoints

#### Backend (Python FastAPI)

##### File Watcher Management
```python
POST   /api/ingress/start-watching  # Start file watcher
POST   /api/ingress/stop-watching   # Stop file watcher
GET    /api/ingress/status          # Get watcher status
```

##### Queue Management
```python
GET    /api/ingress/queue           # Get current queue
POST   /api/ingress/queue/process   # Manually trigger processing
GET    /api/ingress/queue/{id}      # Get queue item details
POST   /api/ingress/queue/{id}/retry # Retry failed item
DELETE /api/ingress/queue/{id}      # Remove from queue
```

##### Review Queue
```python
GET    /api/ingress/review          # Get items needing review
POST   /api/ingress/review/{id}/assign  # Manually assign
POST   /api/ingress/review/{id}/skip    # Skip item
POST   /api/ingress/review/{id}/search  # Re-search for matches
```

##### History & Statistics
```python
GET    /api/ingress/history         # Get processing history
GET    /api/ingress/stats           # Get statistics
GET    /api/ingress/stats/summary   # Get summary stats
```

##### Configuration
```python
GET    /api/ingress/config          # Get configuration
PUT    /api/ingress/config          # Update configuration
POST   /api/ingress/config/test     # Test ingress path access
```

---

## Implementation Phases

### Phase 1: Core Backend Services (Week 1-2)
**Priority**: High
**Estimated Effort**: 16-24 hours

**Tasks**:
1. ✅ Create `FilenameParser` service
   - Implement movie pattern matching
   - Implement TV show pattern matching
   - Add unit tests for common patterns

2. ✅ Create `AutoMatcher` service
   - Implement OMDB search integration
   - Implement confidence scoring algorithm
   - Add fuzzy matching for titles

3. ✅ Create `IngressQueue` service
   - Implement queue management
   - Add retry logic
   - Create database schema

4. ✅ Create `AutoAssignment` service
   - Implement auto-assignment logic
   - Integrate with existing MediaOrganizationService
   - Add error handling

**Deliverables**:
- Working backend services
- Unit tests (>80% coverage)
- API endpoints defined

---

### Phase 2: File Watching & Orchestration (Week 2-3)
**Priority**: High
**Estimated Effort**: 12-16 hours

**Tasks**:
1. ✅ Create `FileWatcher` service
   - Implement watchdog integration
   - Add file stability checking
   - Handle file events

2. ✅ Create `ProcessingOrchestrator`
   - Coordinate all processing steps
   - Implement error handling
   - Add comprehensive logging

3. ✅ Create API endpoints
   - Queue management endpoints
   - Review queue endpoints
   - Statistics endpoints

4. ✅ Testing & Integration
   - End-to-end testing
   - Performance testing
   - Error scenario testing

**Deliverables**:
- Working file watching system
- Complete processing pipeline
- Tested API endpoints

---

### Phase 3: Frontend UI (Week 3-4)
**Priority**: Medium
**Estimated Effort**: 16-20 hours

**Tasks**:
1. ✅ Create Ingress Monitor Dashboard
   - Real-time queue status
   - Statistics display
   - Activity feed

2. ✅ Create Review Queue UI
   - List view of items needing review
   - Match candidate selection
   - Quick assignment interface

3. ✅ Create Processing History
   - Searchable history table
   - Filters and sorting
   - Export functionality

4. ✅ Create Configuration UI
   - Path configuration
   - Threshold settings
   - Enable/disable controls

**Deliverables**:
- Complete UI for ingress monitoring
- Review queue interface
- Configuration interface

---

### Phase 4: Polish & Optimization (Week 4-5)
**Priority**: Low
**Estimated Effort**: 8-12 hours

**Tasks**:
1. ✅ Performance optimization
   - Batch processing capabilities
   - Caching for repeated searches
   - Database indexing

2. ✅ Enhanced error handling
   - Better error messages
   - Automatic recovery
   - User notifications

3. ✅ Documentation
   - API documentation
   - User guide
   - Configuration guide

4. ✅ Monitoring & Alerts
   - Email notifications (optional)
   - Slack integration (optional)
   - Processing metrics

**Deliverables**:
- Optimized system
- Complete documentation
- Optional monitoring integrations

---

## Configuration Examples

### Development Environment
```yaml
ingress_config:
  ingress_paths:
    movies: "C:/test_media/encoded/movies"
    shows: "C:/test_media/encoded/shows"
  destination_paths:
    movies: "C:/jellyfin_library/movies"
    shows: "C:/jellyfin_library/shows"
  auto_assign_enabled: true
  auto_organize_enabled: false  # Safety: manual review in dev
  confidence_threshold: 85
```

### Production Environment (AI Workstation)
```yaml
ingress_config:
  ingress_paths:
    movies: "/data/media/encoded/movies"
    shows: "/data/media/encoded/shows"
  destination_paths:
      movies: "/ark/media/jellyfin/movies"
      shows: "/ark/media/jellyfin/shows"
  auto_assign_enabled: true
  auto_organize_enabled: true
  confidence_threshold: 80
  file_stability_wait_seconds: 10
  max_retry_attempts: 3
```

---

## Testing Strategy

### Unit Tests
- Filename parsing patterns
- Confidence scoring algorithm
- Queue management logic
- Assignment creation

### Integration Tests
- Full processing pipeline
- File watcher events
- API endpoint responses
- Database operations

### End-to-End Tests
1. Place test file in ingress folder
2. Verify detection
3. Verify parsing
4. Verify metadata search
5. Verify auto-assignment
6. Verify file organization
7. Verify cleanup

### Performance Tests
- Process 100 files
- Measure average time per file
- Check memory usage
- Verify queue handling

---

## Success Metrics

### Processing Performance
- **Target**: < 10 seconds per file (search + assign)
- **Target**: 95%+ auto-assignment rate for well-named files
- **Target**: < 1% failure rate

### User Experience
- **Target**: < 5% manual review rate
- **Target**: Zero data loss
- **Target**: Clear error messages for all failures

### System Reliability
- **Target**: 99%+ uptime for file watcher
- **Target**: Automatic recovery from errors
- **Target**: No missed files

---

## Risk Mitigation

### Risk 1: File Watcher Crashes
**Mitigation**:
- Implement health checks
- Auto-restart on failure
- Fallback to polling mode
- Alert on prolonged downtime

### Risk 2: Incorrect Auto-Assignment
**Mitigation**:
- Conservative confidence thresholds
- Detailed logging of all assignments
- Easy rollback capability
- Manual review queue for uncertain matches

### Risk 3: Network Share Issues
**Mitigation**:
- Retry logic for network errors
- Queue persistence
- Graceful degradation
- Clear error reporting

### Risk 4: Performance Degradation
**Mitigation**:
- Rate limiting on external APIs
- Caching of search results
- Batch processing capabilities
- Resource monitoring

---

## Future Enhancements

### Phase 5+ (Optional)
1. **Machine Learning Integration**
   - Learn from manual corrections
   - Improve confidence scoring over time
   - Predict media type from file characteristics

2. **Advanced Filename Patterns**
   - Custom regex pattern configuration
   - Multi-language support
   - Scene release group detection

3. **Duplicate Detection**
   - Check for existing files before organizing
   - Quality comparison (keep higher quality)
   - Automatic upgrade workflows

4. **Webhook Integration**
   - Notify external systems on completion
   - Trigger Jellyfin library scan
   - Post-processing scripts

5. **Mobile App**
   - iOS/Android app for review queue
   - Push notifications for pending reviews
   - Quick assignment on mobile

---

## Migration Path

### For Existing Users
1. New features are opt-in (disabled by default)
2. Manual workflow remains unchanged
3. Users can enable automation gradually
4. Existing assignments unaffected

### For New Automation Users
1. Install and configure ingress paths
2. Set confidence thresholds
3. Enable file watching
4. Monitor review queue initially
5. Adjust thresholds based on results
6. Enable full automation when confident

---

## Development Checklist

### Backend
- [ ] Filename parser service
- [ ] Auto-matcher service with confidence scoring
- [ ] Ingress queue management
- [ ] Auto-assignment service
- [ ] File watcher service
- [ ] Processing orchestrator
- [ ] API endpoints
- [ ] Unit tests
- [ ] Integration tests

### Frontend
- [ ] Ingress monitor dashboard
- [ ] Review queue UI
- [ ] Processing history viewer
- [ ] Configuration interface
- [ ] Real-time updates (WebSocket/polling)
- [ ] Error handling
- [ ] Loading states

### Database
- [ ] Create ingress_queue collection
- [ ] Create ingress_processing_history collection
- [ ] Create ingress_config collection
- [ ] Add indexes for performance
- [ ] Migration scripts

### Documentation
- [ ] API documentation
- [ ] User guide
- [ ] Configuration guide
- [ ] Troubleshooting guide
- [ ] Architecture diagrams

### Deployment
- [ ] Environment configuration
- [ ] Service management (systemd/supervisor)
- [ ] Health monitoring
- [ ] Log aggregation
- [ ] Backup strategy

---

## Conclusion

This automation workflow will transform the media management system from a manual tool into an intelligent, automated pipeline that seamlessly integrates with your existing ripping and encoding infrastructure. The phased approach ensures controlled implementation while maintaining the existing manual workflow as a fallback.

Key benefits:
- ✅ Zero-touch processing for well-named files
- ✅ Minimal manual intervention required
- ✅ Complete audit trail and history
- ✅ Graceful handling of edge cases
- ✅ Configurable and flexible

Expected outcome: 90%+ of media files automatically processed from ingress to Jellyfin library with minimal user intervention.

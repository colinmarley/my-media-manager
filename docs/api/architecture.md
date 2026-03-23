# Backend Architecture Documentation

## Overview
The Media Library Management Backend is a FastAPI-based RESTful API service designed to manage, scan, and organize media library files. It provides comprehensive file operations, metadata extraction, and intelligent library scanning with duplicate detection capabilities.

## Technology Stack
- **Framework**: FastAPI 0.104+
- **Language**: Python 3.8+
- **Media Processing**: FFmpeg/FFprobe
- **Database**: Firebase Firestore (optional, for duplicate detection)
- **Async Support**: asyncio, aiofiles
- **File Operations**: send2trash, pathvalidate

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     FastAPI Application                      │
│                         (main.py)                            │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│     File     │    │   Library    │    │  Metadata    │
│  Operations  │    │  Operations  │    │  Operations  │
│    Router    │    │    Router    │    │    Router    │
└──────────────┘    └──────────────┘    └──────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ FileSystem   │    │   Library    │    │  Metadata    │
│   Manager    │    │   Scanner    │    │  Extractor   │
│   Service    │    │   Service    │    │   Service    │
└──────────────┘    └──────────────┘    └──────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                              ▼
                    ┌──────────────┐
                    │     Task     │
                    │   Manager    │
                    │   Service    │
                    └──────────────┘
```

## Core Components

### 1. Application Layer (main.py)
**Purpose**: FastAPI application initialization and lifecycle management

**Key Features**:
- Service initialization and dependency injection
- CORS configuration for frontend communication
- Centralized health check endpoint
- Graceful startup/shutdown handling

**Endpoints**:
- `GET /` - Root endpoint with API information
- `GET /health` - Service health check

### 2. API Routers

#### File Operations Router (`api/file_operations.py`)
**Purpose**: Direct file system operations

**Endpoints**:
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/files/rename` | Rename file while preserving extension |
| POST | `/api/files/move` | Move files/folders with merge support |
| POST | `/api/files/delete` | Delete files with trash support |
| POST | `/api/files/create-folder` | Create new folder |
| POST | `/api/files/list` | List directory contents |
| POST | `/api/files/metadata` | Get file metadata |
| POST | `/api/files/exists` | Check path existence |
| POST | `/api/files/bulk-move` | Move multiple files at once |
| POST | `/api/files/verify` | Verify multiple file paths |

**Features**:
- Path security validation
- Permission checking
- File locking detection
- Trash bin support (send2trash)
- Bulk operations

#### Library Operations Router (`api/library_operations.py`)
**Purpose**: Library scanning and management

**Endpoints**:
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/library/scan` | Start library scan |
| GET | `/api/library/scan/status/{scanId}` | Get scan progress |
| POST | `/api/library/scan/stop` | Stop running scan |
| GET | `/api/library/scans/active` | List active scans |
| POST | `/api/library/scans/cleanup` | Cleanup old scans |
| POST | `/api/library/files` | Get scanned files |
| POST | `/api/library/directories` | Get scanned directories |
| POST | `/api/library/verify-files` | Verify file existence |

**Features**:
- Asynchronous scanning with progress tracking
- Duplicate detection with difference reporting
- Configurable metadata extraction
- Offline/online duplicate checking modes
- Composite key-based duplicate detection (libraryPath:path)
- Scan result filtering

**Request Models**:
```python
StartScanRequest:
  - libraryPath: str              # Root path to scan
  - userId: Optional[str]          # User context for duplicates
  - extractMetadata: bool          # Extract detailed metadata
  - checkDuplicates: bool          # Enable duplicate detection
  - existingFiles: List[Dict]      # Frontend-provided existing files
  - existingDirectories: List[Dict] # Frontend-provided existing dirs
```

#### Metadata Operations Router (`api/metadata_operations.py`)
**Purpose**: Media file metadata extraction

**Endpoints**:
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/metadata/extract` | Extract media metadata |
| POST | `/api/metadata/batch-extract` | Batch extract metadata |
| POST | `/api/metadata/thumbnail` | Generate video thumbnail |
| POST | `/api/metadata/batch-thumbnails` | Generate multiple thumbnails |
| GET | `/api/metadata/supported-formats` | Get supported formats |

**Features**:
- FFprobe-based metadata extraction
- Video/audio/subtitle stream detection
- Thumbnail generation
- Batch processing support
- Format validation

### 3. Service Layer

#### FileSystemManager (`services/filesystem_manager.py`)
**Purpose**: Low-level file system operations

**Core Methods**:
```python
validate_path_security()       # Validate path against allowed bases
check_permissions()            # Check read/write/execute permissions
is_file_locked()              # Detect locked files
rename_file()                 # Rename with validation
move_file()                   # Move with merge support
delete_file()                 # Delete with trash support
create_folder()               # Create directories
list_directory()              # List contents with filtering
get_file_metadata()           # Extract file system metadata
calculate_checksum()          # Generate file checksums
```

**Security Features**:
- Path traversal prevention
- Permission validation
- File locking detection
- Allowed base path enforcement

#### LibraryScanner (`services/library_scanner.py`)
**Purpose**: Intelligent library scanning and cataloging

**Core Methods**:
```python
start_scan()                  # Initiate scan operation
get_scan_status()             # Retrieve scan progress
stop_scan()                   # Cancel running scan
_run_scan_async()             # Async scan execution
_scan_directory_async()       # Recursive directory scanning
_process_file()               # Process individual files
_process_directory()          # Process directories
_check_duplicates()           # Firestore-based duplicate check
_check_duplicates_with_existing() # Offline duplicate check
_compare_item_data()          # Compare file/directory data
cleanup_completed_scans()     # Remove old scan data
```

**Features**:
- Asynchronous recursive scanning
- Real-time progress tracking
- Configurable scan depth
- Media type detection
- Duplicate detection with two modes:
  - **Online**: Queries Firestore for existing files
  - **Offline**: Uses frontend-provided existing data
- Composite key duplicate detection (libraryPath + path)
- Difference reporting
- Scan result filtering
- Error tracking and recovery

**Scan Progress Tracking**:
```python
ScanProgress:
  - scan_id: str
  - status: str (pending/scanning/completed/failed/stopped)
  - current_path: str
  - total_items: int
  - processed_items: int
  - files_found: int
  - directories_found: int
  - scan_results: List[Dict]
  - duplicate_report: Dict
  - errors: List[Dict]
  - start_time/end_time: float
```

#### MetadataExtractor (`services/metadata_extractor.py`)
**Purpose**: Media file metadata extraction using FFmpeg

**Core Methods**:
```python
extract_video_metadata()      # Extract comprehensive video metadata
_extract_video_stream_info()  # Video stream details
_extract_audio_streams()      # Audio track information
_extract_subtitle_streams()   # Subtitle track information
get_video_thumbnail()         # Generate thumbnail at timestamp
generate_thumbnails_batch()   # Batch thumbnail generation
_parse_frame_rate()           # Parse frame rate strings
_format_duration()            # Format duration values
```

**Extracted Metadata**:
- Container format
- Video codec, resolution, bitrate, frame rate
- Audio codecs, channels, sample rates
- Subtitle tracks and languages
- Chapter information
- Duration and file size

#### TaskManager (`services/task_manager.py`)
**Purpose**: Asynchronous task execution and tracking

**Core Methods**:
```python
submit_task()                 # Submit new background task
get_task_status()            # Retrieve task status
cancel_task()                # Cancel running task
get_all_tasks()              # List all tasks
cleanup_old_tasks()          # Remove completed tasks
_run_task()                  # Execute task with progress
```

**Task States**:
- `pending`: Queued for execution
- `running`: Currently executing
- `completed`: Successfully finished
- `failed`: Execution error
- `cancelled`: User cancelled

#### FirestoreService (`services/firestore_service.py`)
**Purpose**: Firebase Firestore integration (optional)

**Core Methods**:
```python
initialize()                  # Initialize Firestore client
get_existing_file_paths()    # Query existing files
get_existing_directory_paths() # Query existing directories
save_scan_result()           # Save scan summary
```

**Collections**:
- `scanned_files`: Individual file records
- `scanned_directories`: Directory records
- `scan_results`: Scan operation summaries

## Configuration (`config/settings.py`)

### Server Settings
```python
host: "localhost"
port: 8082
reload: False
```

### Path Configuration
```python
allowed_base_paths: List[str]  # Whitelisted root paths
max_scan_depth: 10             # Maximum directory depth
```

### File Type Support
```python
supported_video_extensions: [.mp4, .mkv, .avi, ...]
supported_audio_extensions: [.mp3, .flac, .wav, ...]
supported_subtitle_extensions: [.srt, .vtt, .ass, ...]
```

### Performance Settings
```python
max_concurrent_scans: 2        # Parallel scan limit
scan_worker_threads: 4         # Thread pool size
metadata_extraction_timeout: 30 # FFprobe timeout
scan_timeout_minutes: 60       # Max scan duration
```

### Security Settings
```python
enable_file_integrity_checks: False
use_trash_for_deletes: True
```

## Utilities

### Logging (`utils/logging.py`)
- Structured JSON logging
- Request ID tracking
- Performance metrics
- Error tracking

### Exceptions (`utils/exceptions.py`)
Custom exception hierarchy:
- `PathSecurityError`: Invalid/unsafe paths
- `InsufficientPermissionsError`: Permission issues
- `FileOperationError`: File operation failures
- `ScanOperationError`: Scan-specific errors
- `MetadataExtractionError`: Metadata extraction failures

## Data Flow

### Library Scan Flow
```
1. Frontend sends StartScanRequest
   ├─ libraryPath: Root directory to scan
   ├─ existingFiles: Current files from Firebase
   └─ existingDirectories: Current directories from Firebase

2. LibraryScanner.start_scan()
   ├─ Validates path security
   ├─ Creates ScanProgress tracker
   └─ Launches async scan task

3. _run_scan_async()
   ├─ Counts total items (first pass)
   ├─ Scans directories recursively
   ├─ Processes files and directories
   └─ Checks for duplicates

4. Duplicate Detection
   ├─ Creates composite keys (libraryPath:path)
   ├─ Compares against existing data
   ├─ Generates difference report
   └─ Filters duplicate results

5. Returns scan results
   ├─ New files and directories
   ├─ Duplicate report with differences
   └─ Progress and error information
```

### Duplicate Detection Strategy
The system uses **composite key duplicate detection** to properly identify duplicates within the same library path:

**Composite Key Format**: `{libraryPath}:{path}`

**Example**:
- `/movies/action/movie.mp4` in Library A → Key: `/media/library-a:/movies/action/movie.mp4`
- `/movies/action/movie.mp4` in Library B → Key: `/media/library-b:/movies/action/movie.mp4`

These are treated as **separate files** (different composite keys), preventing false duplicates across different libraries.

**True Duplicate Example**:
- First scan: `/media/library-a:/movies/action/movie.mp4`
- Second scan: `/media/library-a:/movies/action/movie.mp4`
- Result: **Duplicate detected** (same composite key)

## API Response Format

All endpoints return standardized responses:

```json
{
  "success": true|false,
  "data": {
    // Response data
  },
  "error": {
    "type": "ErrorType",
    "message": "Error description",
    "code": "ERROR_CODE"
  },
  "timestamp": "1234567890"
}
```

## Error Handling

### Error Categories
1. **Path Security**: 403 Forbidden
2. **File Operations**: 400 Bad Request
3. **Permissions**: 403 Forbidden
4. **Not Found**: 404 Not Found
5. **Server Errors**: 500 Internal Server Error

### Error Response Structure
```json
{
  "detail": {
    "type": "ErrorType",
    "message": "Human-readable error",
    "code": "MACHINE_READABLE_CODE"
  }
}
```

## Performance Considerations

### Scanning Performance
- Asynchronous I/O for directory traversal
- Configurable depth limits
- Metadata extraction is optional
- Checksum calculation disabled by default
- Thread pool for parallel processing

### Memory Management
- Stream-based processing for large files
- Progress tracking without storing full results
- Automatic cleanup of old scan data
- Configurable scan limits

### Security Measures
- Path traversal prevention
- Allowed base path whitelist
- Permission validation
- File lock detection
- CORS configuration

## Development and Testing

### Running the Server
```bash
cd backend
python start.py
```

### Testing
```bash
# Run unit tests
python -m pytest tests/

# Test specific operations
python test_directory_scan.py
python test_api_scan.py
```

### Health Check
```bash
curl http://localhost:8082/health
```

## Future Enhancements

1. **Enhanced Duplicate Detection**
   - Content-based hashing
   - Fuzzy matching for similar files
   - Configurable duplicate strategies

2. **Performance Improvements**
   - Caching layer for metadata
   - Database indexing optimization
   - Parallel metadata extraction

3. **Additional Features**
   - File watch mode for real-time updates
   - Scheduled scans
   - Media conversion queue
   - Advanced filtering and search

4. **Security Enhancements**
   - Authentication/authorization
   - Rate limiting
   - Audit logging
   - Encrypted storage options

## Dependencies

### Core Dependencies
- `fastapi`: Web framework
- `uvicorn`: ASGI server
- `pydantic`: Data validation
- `ffmpeg-python`: Media processing
- `aiofiles`: Async file operations

### Optional Dependencies
- `firebase-admin`: Firestore integration
- `send2trash`: Safe file deletion
- `pathvalidate`: Path validation

## Configuration Files

- `backend/config/settings.py`: Main configuration
- `backend/.env`: Environment variables (optional)
- `backend/requirements.txt`: Python dependencies

## Logging

### Log Levels
- `INFO`: Normal operations
- `WARNING`: Non-critical issues
- `ERROR`: Operation failures
- `DEBUG`: Detailed debugging info

### Log Format
```json
{
  "timestamp": "2025-12-11T10:30:00",
  "level": "INFO",
  "message": "Scan started",
  "scan_id": "abc-123",
  "path": "/media/movies"
}
```

## Support and Maintenance

For issues, feature requests, or contributions, refer to the main project repository.

## License

See the project root LICENSE file for details.

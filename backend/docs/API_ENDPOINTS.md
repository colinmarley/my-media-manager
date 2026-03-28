# API Endpoints Quick Reference

## Base URL
```
http://localhost:8082
```

## Health & Status

### Get API Information
```http
GET /
```
Returns basic API information and version.

### Health Check
```http
GET /health
```
Returns service health status and availability of all components.

---

## File Operations (`/api/files`)

### Rename File
```http
POST /api/files/rename
Content-Type: application/json

{
  "currentPath": "/media/movies/old_name.mp4",
  "newName": "new_name"
}
```
Renames a file while preserving its extension.

### Move File/Folder
```http
POST /api/files/move
Content-Type: application/json

{
  "sourcePath": "/media/source/file.mp4",
  "destinationPath": "/media/destination/",
  "mergeContents": false
}
```
Moves files or directories. Set `mergeContents` to `true` to merge when destination exists.

### Delete File
```http
POST /api/files/delete
Content-Type: application/json

{
  "filePath": "/media/movies/file.mp4",
  "useTrash": true
}
```
Deletes a file. Set `useTrash` to `true` to move to trash instead of permanent deletion.

### Create Folder
```http
POST /api/files/create-folder
Content-Type: application/json

{
  "parentPath": "/media/movies",
  "folderName": "new_folder"
}
```
Creates a new directory.

### List Directory
```http
POST /api/files/list
Content-Type: application/json

{
  "path": "/media/movies"
}
```
Lists all files and subdirectories in the specified path.

**Response:**
```json
{
  "success": true,
  "data": {
    "path": "/media/movies",
    "files": [...],
    "directories": [...],
    "totalFiles": 100,
    "totalDirectories": 10
  }
}
```

### Get File Metadata
```http
POST /api/files/metadata
Content-Type: application/json

{
  "filePath": "/media/movies/file.mp4"
}
```
Returns file system metadata (size, timestamps, permissions, etc.).

### Check Path Exists
```http
POST /api/files/exists
Content-Type: application/json

{
  "path": "/media/movies/file.mp4"
}
```
Checks if a path exists and returns its type (file/directory).

### Bulk Move Files
```http
POST /api/files/bulk-move
Content-Type: application/json

{
  "sourcePaths": [
    "/media/source/file1.mp4",
    "/media/source/file2.mp4"
  ],
  "destinationPath": "/media/destination/",
  "mergeContents": false
}
```
Moves multiple files/folders in a single operation.

### Verify Files
```http
POST /api/files/verify
Content-Type: application/json

{
  "filePaths": [
    "/media/file1.mp4",
    "/media/file2.mp4"
  ]
}
```
Verifies existence of multiple file paths at once.

---

## Library Operations (`/api/library`)

### Start Library Scan
```http
POST /api/library/scan
Content-Type: application/json

{
  "libraryPath": "/media/movies",
  "userId": "user123",
  "extractMetadata": true,
  "checkDuplicates": true,
  "existingFiles": [...],
  "existingDirectories": [...]
}
```
Starts an asynchronous library scan.

**Parameters:**
- `libraryPath` (required): Root directory to scan
- `userId` (optional): User ID for duplicate detection context
- `extractMetadata` (optional, default: false): Extract detailed FFmpeg metadata
- `checkDuplicates` (optional, default: false): Perform duplicate detection
- `existingFiles` (optional): Array of existing file records for offline duplicate checking
- `existingDirectories` (optional): Array of existing directory records for offline duplicate checking

**Response:**
```json
{
  "success": true,
  "data": {
    "scanId": "abc-123-def-456",
    "libraryPath": "/media/movies",
    "status": "started"
  },
  "timestamp": "1702304400"
}
```

### Get Scan Status
```http
GET /api/library/scan/status/{scanId}
```
Returns real-time status and progress of a scan operation.

**Response:**
```json
{
  "success": true,
  "data": {
    "scanId": "abc-123",
    "status": "scanning",
    "percentage": 45.5,
    "totalItems": 1000,
    "processedItems": 455,
    "filesFound": 380,
    "directoriesFound": 75,
    "currentPath": "/media/movies/subfolder",
    "elapsedTime": 12.5,
    "scanResults": [...],
    "duplicateReport": {
      "duplicatesFound": 5,
      "newItems": 375,
      "differences": [...]
    },
    "errors": []
  }
}
```

**Status Values:**
- `pending`: Queued but not started
- `scanning`: Currently scanning
- `completed`: Finished successfully
- `failed`: Encountered fatal error
- `stopped`: Manually cancelled

### Stop Scan
```http
POST /api/library/scan/stop
Content-Type: application/json

{
  "scanId": "abc-123-def-456"
}
```
Stops a running scan operation.

### List Active Scans
```http
GET /api/library/scans/active
```
Returns all currently running scans.

### Cleanup Old Scans
```http
POST /api/library/scans/cleanup
Content-Type: application/json

{
  "maxAgeHours": 24
}
```
Removes scan data older than specified hours.

### Get Scanned Files
```http
POST /api/library/files
Content-Type: application/json

{
  "scanId": "abc-123",
  "libraryPath": "/media/movies",
  "limit": 100,
  "offset": 0
}
```
Retrieves files discovered during scans with filtering and pagination.

### Get Scanned Directories
```http
POST /api/library/directories
Content-Type: application/json

{
  "scanId": "abc-123",
  "libraryPath": "/media/movies",
  "limit": 100,
  "offset": 0
}
```
Retrieves directories discovered during scans with filtering and pagination.

### Verify Files
```http
POST /api/library/verify-files
Content-Type: application/json

{
  "filePaths": [
    "/media/file1.mp4",
    "/media/file2.mp4"
  ]
}
```
Batch verification of file paths from scan results.

---

## Metadata Operations (`/api/metadata`)

### Extract Metadata
```http
POST /api/metadata/extract
Content-Type: application/json

{
  "filePath": "/media/movies/file.mp4",
  "extractThumbnail": true,
  "thumbnailTimestamp": 10.0
}
```
Extracts comprehensive media metadata using FFprobe.

**Response:**
```json
{
  "success": true,
  "data": {
    "filePath": "/media/movies/file.mp4",
    "fileMetadata": {
      "size": 1073741824,
      "created_time": 1702304400,
      "modified_time": 1702304400
    },
    "mediaMetadata": {
      "format": {...},
      "video": {
        "codec": "h264",
        "width": 1920,
        "height": 1080,
        "fps": 23.976,
        "bitrate": 5000000
      },
      "audio": [...],
      "subtitle": [...],
      "duration": 7200.5,
      "size": 1073741824,
      "bitrate": 5000000
    },
    "thumbnailPath": "/tmp/thumb_abc123.jpg"
  }
}
```

### Batch Extract Metadata
```http
POST /api/metadata/batch-extract
Content-Type: application/json

{
  "filePaths": [
    "/media/file1.mp4",
    "/media/file2.mp4"
  ],
  "extractThumbnails": false
}
```
Extracts metadata from multiple files in parallel.

### Generate Thumbnail
```http
POST /api/metadata/thumbnail
Content-Type: application/json

{
  "filePath": "/media/movies/file.mp4",
  "timestamp": 60.0
}
```
Generates a thumbnail image at the specified timestamp (in seconds).

### Batch Generate Thumbnails
```http
POST /api/metadata/batch-thumbnails
Content-Type: application/json

{
  "filePaths": [
    "/media/file1.mp4",
    "/media/file2.mp4"
  ],
  "timestamp": 10.0
}
```
Generates thumbnails for multiple files.

### Get Supported Formats
```http
GET /api/metadata/supported-formats
```
Returns list of supported video, audio, and subtitle formats.

**Response:**
```json
{
  "success": true,
  "data": {
    "video": [".mp4", ".mkv", ".avi", ".mov", ...],
    "audio": [".mp3", ".flac", ".wav", ...],
    "subtitle": [".srt", ".vtt", ".ass", ...]
  }
}
```

---

## Response Format

All endpoints return a standardized response format:

### Success Response
```json
{
  "success": true,
  "data": {
    // Response payload
  },
  "error": null,
  "timestamp": "1702304400"
}
```

### Error Response
```json
{
  "success": false,
  "data": null,
  "error": {
    "type": "ErrorType",
    "message": "Human-readable error description",
    "code": "MACHINE_READABLE_CODE"
  },
  "timestamp": "1702304400"
}
```

---

## HTTP Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Request successful |
| 400 | Bad Request | Invalid request parameters or operation failed |
| 403 | Forbidden | Path security violation or insufficient permissions |
| 404 | Not Found | Resource not found (e.g., scan ID doesn't exist) |
| 500 | Internal Server Error | Unexpected server error |

---

## Error Types

### PathSecurityError (403)
Path is outside allowed base paths or contains invalid characters.

### InsufficientPermissionsError (403)
User/process lacks required file system permissions.

### FileOperationError (400)
File operation failed (e.g., file locked, destination exists).

### ScanOperationError (400)
Scan operation failed (e.g., max concurrent scans reached).

### MetadataExtractionError (400)
FFprobe failed to extract metadata from file.

### NotFoundError (404)
Requested resource (scan, file, etc.) not found.

---

## Rate Limiting

- **Max Concurrent Scans**: 2 (configurable via `settings.max_concurrent_scans`)
- **Scan Timeout**: 60 minutes (configurable via `settings.scan_timeout_minutes`)
- **Metadata Extraction Timeout**: 30 seconds per file

---

## Authentication

Currently, the API does not implement authentication. All endpoints are publicly accessible.

**Note**: In production, implement proper authentication and authorization mechanisms.

---

## CORS Configuration

The API allows requests from:
- `http://localhost:3000`
- `http://localhost:3001`

All HTTP methods and headers are allowed for these origins.

---

## Example Usage

### Python
```python
import requests

# Start a scan
response = requests.post('http://localhost:8082/api/library/scan', json={
    'libraryPath': '/media/movies',
    'extractMetadata': True,
    'checkDuplicates': True
})
scan_data = response.json()
scan_id = scan_data['data']['scanId']

# Check status
status = requests.get(f'http://localhost:8082/api/library/scan/status/{scan_id}')
print(status.json())
```

### JavaScript/TypeScript
```javascript
// Start a scan
const scanResponse = await fetch('http://localhost:8082/api/library/scan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    libraryPath: '/media/movies',
    extractMetadata: true,
    checkDuplicates: true,
    existingFiles: [],
    existingDirectories: []
  })
});
const { data } = await scanResponse.json();
const scanId = data.scanId;

// Poll for status
const statusResponse = await fetch(
  `http://localhost:8082/api/library/scan/status/${scanId}`
);
const status = await statusResponse.json();
console.log(status);
```

### cURL
```bash
# Start a scan
curl -X POST http://localhost:8082/api/library/scan \
  -H "Content-Type: application/json" \
  -d '{
    "libraryPath": "/media/movies",
    "extractMetadata": true,
    "checkDuplicates": true
  }'

# Check status
curl http://localhost:8082/api/library/scan/status/abc-123-def-456
```

---

## Development

### Running the Server
```bash
cd backend
python start.py
```

### Interactive API Documentation
FastAPI provides automatic interactive documentation:
- Swagger UI: `http://localhost:8082/docs`
- ReDoc: `http://localhost:8082/redoc`

---

## Support

For issues or questions, refer to the main project repository or the `BACKEND_ARCHITECTURE.md` documentation.

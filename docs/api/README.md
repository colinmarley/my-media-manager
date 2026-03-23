# API Documentation

Comprehensive documentation for the Media Library Management Backend API.

## Table of Contents

- [Quick Start](#quick-start)
- [Documentation Files](#documentation-files)
- [API Overview](#api-overview)
- [Interactive Documentation](#interactive-documentation)
- [Getting Started](#getting-started)

## Quick Start

### Start the Backend Server
```bash
cd backend
python start.py
```

The API will be available at `http://localhost:8082`

### Test the API
```bash
# Health check
curl http://localhost:8082/health

# Get API info
curl http://localhost:8082/
```

## Documentation Files

### [API Endpoints Reference](./endpoints.md)
Complete reference for all API endpoints:
- **File Operations** - Rename, move, delete, create folders
- **Library Operations** - Scan libraries, track progress, manage scans
- **Metadata Operations** - Extract media metadata, generate thumbnails
- Request/response formats
- Error handling
- Examples in Python, JavaScript, and cURL

### [Backend Architecture](./architecture.md)
Detailed backend architecture documentation:
- System architecture overview
- Component descriptions
- Service layer details
- Data flow diagrams
- Configuration options
- Security measures
- Performance considerations

## API Overview

### Base URL
```
http://localhost:8082
```

### Main API Categories

#### 1. File Operations (`/api/files`)
Direct file system operations with security validation:
- Rename files/folders
- Move files/folders  
- Delete files (with trash support)
- Create folders
- List directory contents
- Get file metadata
- Bulk operations

#### 2. Library Operations (`/api/library`)
Library scanning and management:
- Start asynchronous library scans
- Track scan progress in real-time
- Stop running scans
- Retrieve scanned files and directories
- Duplicate detection
- Batch verification

#### 3. Metadata Operations (`/api/metadata`)
Media file metadata extraction:
- Extract comprehensive video/audio metadata
- Generate video thumbnails
- Batch processing
- Supported format detection

### Response Format
All endpoints return standardized JSON responses:

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

### Authentication
Currently, the API does not implement authentication. All endpoints are publicly accessible on localhost.

> **Note**: In production environments, implement proper authentication and authorization mechanisms.

## Interactive Documentation

FastAPI provides built-in interactive API documentation:

- **Swagger UI**: [http://localhost:8082/docs](http://localhost:8082/docs)
  - Interactive API explorer
  - Try endpoints directly from the browser
  - View request/response schemas

- **ReDoc**: [http://localhost:8082/redoc](http://localhost:8082/redoc)
  - Clean, readable API documentation
  - Detailed endpoint descriptions
  - Schema definitions

- **OpenAPI JSON**: [http://localhost:8082/openapi.json](http://localhost:8082/openapi.json)
  - Raw OpenAPI specification
  - Can be imported into API clients like Postman

## Getting Started

### Prerequisites

1. **Python 3.8+**
   ```bash
   python --version
   ```

2. **FFmpeg** (for metadata extraction)
   - Windows: Download from [FFmpeg.org](https://ffmpeg.org/download.html)
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`

### Installation

1. **Install Python Dependencies**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Configure Environment Variables** (optional)
   ```bash
   export MEDIA_LIBRARY_ALLOWED_BASE_PATHS="/path/to/media,/another/path"
   export MEDIA_LIBRARY_MAX_FILE_SIZE_MB="1000"
   ```

3. **Start the Server**
   ```bash
   python start.py
   ```

### Basic Usage Examples

#### Start a Library Scan
```bash
curl -X POST http://localhost:8082/api/library/scan \
  -H "Content-Type: application/json" \
  -d '{
    "libraryPath": "/media/movies",
    "extractMetadata": true,
    "checkDuplicates": true
  }'
```

#### Check Scan Status
```bash
curl http://localhost:8082/api/library/scan/status/{scanId}
```

#### Rename a File
```bash
curl -X POST http://localhost:8082/api/files/rename \
  -H "Content-Type: application/json" \
  -d '{
    "currentPath": "/media/movies/old_name.mp4",
    "newName": "new_name"
  }'
```

#### Extract Metadata
```bash
curl -X POST http://localhost:8082/api/metadata/extract \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "/media/movies/movie.mp4",
    "extractThumbnail": true
  }'
```

## Key Features

### Security
- Path traversal prevention
- Allowed base path validation
- Permission checking
- File locking detection
- CORS configuration for frontend access

### Performance
- Asynchronous operations
- Background task processing
- Configurable scan limits
- Progress tracking
- Automatic cleanup of old scan data

### Duplicate Detection
- Composite key-based detection (libraryPath:path)
- Online (Firestore) and offline modes
- Detailed difference reporting
- Prevents false positives across libraries

### Error Handling
- Standardized error responses
- Detailed error messages
- Machine-readable error codes
- HTTP status codes following REST conventions

## Configuration

### Server Settings
- **Host**: `localhost` (default)
- **Port**: `8082` (default)
- **Reload**: `False` (set to `True` during development)

### Security Settings
- **Allowed Base Paths**: List of whitelisted root directories
- **Max File Size**: Maximum file size for operations (MB)
- **Max Scan Depth**: Maximum directory recursion depth

### Performance Settings
- **Max Concurrent Scans**: 2 (default)
- **Scan Timeout**: 60 minutes (default)
- **Metadata Extraction Timeout**: 30 seconds per file

See [Backend Architecture](./architecture.md#configuration-configsettingspy) for complete configuration options.

## Error Codes and HTTP Status

| Status Code | Description |
|-------------|-------------|
| 200 | Success - Operation completed |
| 400 | Bad Request - Invalid parameters or operation failed |
| 403 | Forbidden - Path security violation or insufficient permissions |
| 404 | Not Found - Resource not found |
| 500 | Internal Server Error - Unexpected server error |

### Common Error Types
- `PathSecurityError` - Invalid or unsafe file paths
- `InsufficientPermissionsError` - Permission issues
- `FileOperationError` - File operation failures
- `ScanOperationError` - Scan-specific errors
- `MetadataExtractionError` - FFprobe extraction failures

## Development

### Project Structure
```
backend/
├── api/                  # API route handlers
│   ├── file_operations.py
│   ├── library_operations.py
│   └── metadata_operations.py
├── services/             # Business logic services
│   ├── filesystem_manager.py
│   ├── library_scanner.py
│   ├── metadata_extractor.py
│   └── task_manager.py
├── config/               # Configuration
│   └── settings.py
├── utils/                # Utilities
│   ├── exceptions.py
│   └── logging.py
├── main.py               # FastAPI application
└── start.py              # Startup script
```

### Testing
```bash
# Run all tests
python -m pytest tests/

# Test specific operations
python test_directory_scan.py
python test_api_scan.py
python test_filesystem.py
```

### Adding New Endpoints

1. Define route in appropriate router (`api/*.py`)
2. Implement service logic in service layer (`services/*.py`)
3. Add request/response models with Pydantic
4. Update this documentation
5. Test the endpoint

## Frontend Integration

### React/Next.js Example
```typescript
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
```

### Python Client Example
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

## Rate Limiting

- **Max Concurrent Scans**: 2 (configurable)
- **Scan Timeout**: 60 minutes (configurable)
- **Metadata Extraction Timeout**: 30 seconds per file

## Support

### Resources
- [API Endpoints Reference](./endpoints.md) - Complete endpoint documentation
- [Backend Architecture](./architecture.md) - Detailed architecture guide
- [Backend README](../../backend/README.md) - Backend setup and configuration
- Interactive Docs: [http://localhost:8082/docs](http://localhost:8082/docs)

### Troubleshooting

#### API Not Responding
1. Check if the backend is running: `curl http://localhost:8082/health`
2. Verify the port is not in use: `lsof -i :8082` (Unix) or `netstat -ano | findstr :8082` (Windows)
3. Check server logs for errors

#### Path Security Errors
- Ensure the path is within allowed base paths
- Check that the path doesn't contain invalid characters
- Verify file permissions

#### Metadata Extraction Failures
- Confirm FFmpeg/FFprobe is installed: `ffprobe -version`
- Verify the file format is supported
- Check file permissions and accessibility

## Changelog

### Latest Updates
- Added multi-episode file assignment support
- Enhanced duplicate detection with composite keys
- Improved folder checkbox selection in library browser
- Fixed file extension handling in media organization

### Future Enhancements
- Authentication and authorization
- Rate limiting
- Webhooks for scan completion
- Advanced filtering and search
- Content-based duplicate detection

## License

See the project root LICENSE file for details.

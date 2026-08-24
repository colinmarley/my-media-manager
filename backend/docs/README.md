# Media Library Backend

FastAPI backend service for media library management, file operations, and metadata extraction.

## Features

- **File Operations**: Secure file/folder operations with path validation
- **Library Scanning**: Async scanning of media directories with progress tracking
- **Metadata Extraction**: FFmpeg-based metadata extraction from media files
- **Security**: Path traversal protection and operation validation
- **Async Support**: Non-blocking operations for large libraries

## Quick Start

### Prerequisites

- Python 3.8+
- FFmpeg installed and accessible in PATH

### Installation

1. **Install FFmpeg**:
   - Windows: Download from [FFmpeg.org](https://ffmpeg.org/download.html)
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`

2. **Install Python Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Environment** (optional):
   ```bash
   export MEDIA_LIBRARY_ALLOWED_BASE_PATHS="/path/to/media,/another/path"
   export MEDIA_LIBRARY_TEMP_DIRECTORY="/tmp/media_manager"
   export MEDIA_LIBRARY_MAX_FILE_SIZE_MB="1000"
   ```

### Running the Server

**Option 1: Using the startup script** (recommended):
```bash
python start.py
```

**Option 2: Direct uvicorn**:
```bash
uvicorn main:app --host localhost --port 8082 --reload
```

The server will start on `http://localhost:8082`

## API Documentation

Once running, visit:
- **Interactive API docs**: `http://localhost:8082/docs`
- **ReDoc documentation**: `http://localhost:8082/redoc`
- **OpenAPI JSON**: `http://localhost:8082/openapi.json`

## API Endpoints

### Health Check
- `GET /health` - Server health status
- `GET /health/detailed` - Detailed system status

### File Operations
- `POST /api/files/rename` - Rename files/folders
- `POST /api/files/move` - Move files/folders
- `DELETE /api/files/delete` - Delete files/folders
- `GET /api/files/metadata/{file_path}` - Get file metadata
- `POST /api/files/validate` - Validate file operations

### Library Operations
- `POST /api/library/scan` - Start library scan
- `GET /api/library/scan/status/{scan_id}` - Get scan progress
- `POST /api/library/scan/stop` - Stop running scan
- `GET /api/library/scans` - List all scans
- `POST /api/library/verify` - Verify file existence

### Metadata Operations
- `POST /api/metadata/extract` - Extract metadata from file
- `POST /api/metadata/batch` - Batch metadata extraction
- `GET /api/metadata/formats` - Get supported formats

## Configuration

The backend uses environment variables for configuration:

| Variable | Description | Default |
|----------|-------------|----------|
| `MEDIA_LIBRARY_ALLOWED_BASE_PATHS` | Comma-separated allowed paths | Current directory |
| `MEDIA_LIBRARY_TEMP_DIRECTORY` | Temporary files directory | `/tmp/media_manager` |
| `MEDIA_LIBRARY_MAX_FILE_SIZE_MB` | Max file size for operations | `1000` |
| `MEDIA_LIBRARY_LOG_LEVEL` | Logging level | `INFO` |

## Security

- **Path Validation**: All file operations validate paths against allowed base paths
- **Size Limits**: File size limits prevent resource exhaustion
- **Operation Validation**: Dangerous operations are blocked
- **CORS**: Configured for frontend integration

## Frontend Integration

This backend is designed to work with the Next.js frontend `FileSystemService`. The frontend makes HTTP requests to these endpoints for:

- File browser operations
- Library scanning and management
- Media metadata extraction
- File system operations

## Development

### Running Tests
```bash
pytest
```

### Code Formatting
```bash
black .
flake8 .
```

### Project Structure
```
backend/
├── main.py                 # FastAPI application
├── start.py               # Startup script
├── requirements.txt       # Python dependencies
├── api/                   # API route handlers
│   ├── file_operations.py
│   ├── library_operations.py
│   └── metadata_operations.py
├── services/              # Business logic
│   ├── file_manager.py
│   ├── library_scanner.py
│   └── metadata_extractor.py
├── utils/                 # Utilities
│   ├── exceptions.py
│   └── logging.py
└── config/               # Configuration
    └── settings.py
```

## Troubleshooting

### Common Issues

1. **FFmpeg not found**:
   - Ensure FFmpeg is installed and in PATH
   - Test with: `ffprobe -version`

2. **Permission denied errors**:
   - Check file permissions
   - Ensure allowed base paths are configured correctly

3. **Path security errors**:
   - Configure `MEDIA_LIBRARY_ALLOWED_BASE_PATHS`
   - Ensure paths are absolute and within allowed directories

4. **Large file timeouts**:
   - Increase `MEDIA_LIBRARY_MAX_FILE_SIZE_MB`
   - Use batch operations for large datasets

For more help, check the logs or API documentation at `/docs`.
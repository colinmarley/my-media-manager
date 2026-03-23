# Documentation

Comprehensive documentation for the Media Library Management System.

## Table of Contents

### API Documentation
- **[API Documentation](./api/README.md)** - Complete backend API documentation
  - [API Endpoints Reference](./api/endpoints.md) - All available endpoints
  - [Backend Architecture](./api/architecture.md) - System architecture and design

### Data Structure & Database
- **[Firebase Collections](./FIREBASE_COLLECTIONS.md)** - Firestore collection schemas
- **[Data Structure Redesign](./DATA_STRUCTURE_REDESIGN.md)** - Database redesign documentation

### Features & Workflows
- **[Media Assignment Feature](./MEDIA_ASSIGNMENT_FEATURE.md)** - Media assignment system overview
- **[Media Assignment Flow](./MEDIA_ASSIGNMENT_FLOW.md)** - Detailed workflow documentation

### Implementation Tracking
- **[Implementation Plan](./IMPLEMENTATION_PLAN.md)** - Development roadmap and progress
- **[Implementation Progress](./IMPLEMENTATION_PROGRESS.md)** - Detailed implementation status
- **[Implementation Complete Summary](./IMPLEMENTATION_COMPLETE_SUMMARY.md)** - Completed features
- **[Automation Workflow Plan](./AUTOMATION_WORKFLOW_PLAN.md)** - Automated ingress processing workflow

### Migration
- **[Migration Guide](./MIGRATION_GUIDE.md)** - Guide for data structure migrations

## Quick Links

### Getting Started
- [Backend Setup](../backend/README.md)
- [API Quick Start](./api/README.md#quick-start)
- [Interactive API Docs](http://localhost:8082/docs) (when server is running)

### Key Features
- **Library Scanning** - Scan media libraries with duplicate detection
- **Media Assignment** - Assign files to movies or TV episodes
- **File Organization** - Organize files into Jellyfin folder structures
- **Metadata Extraction** - Extract comprehensive media metadata
- **Automated Ingress** - Automatically process files from encoding pipeline (planned)

### Architecture
- [Backend Architecture](./api/architecture.md)
- [Firebase Collections Schema](./FIREBASE_COLLECTIONS.md)
- [Data Structure Design](./DATA_STRUCTURE_REDESIGN.md)

## Documentation Structure

```
docs/
├── api/                          # API Documentation
│   ├── README.md                 # API documentation index
│   ├── endpoints.md              # Complete endpoint reference
│   └── architecture.md           # Backend architecture
├── FIREBASE_COLLECTIONS.md       # Database schema
├── DATA_STRUCTURE_REDESIGN.md    # Data structure documentation
├── MEDIA_ASSIGNMENT_FEATURE.md   # Feature overview
├── MEDIA_ASSIGNMENT_FLOW.md      # Workflow details
├── IMPLEMENTATION_PLAN.md        # Development plan
├── IMPLEMENTATION_PROGRESS.md    # Implementation tracking
├── IMPLEMENTATION_COMPLETE_SUMMARY.md  # Completed work
├── AUTOMATION_WORKFLOW_PLAN.md   # Automated ingress workflow plan
└── MIGRATION_GUIDE.md            # Migration instructions
```

## Key Concepts

### Media Management
The system manages media libraries through several key components:
- **Library Scanning** - Discovers files and directories in media libraries
- **Duplicate Detection** - Identifies duplicate files using composite keys
- **Media Assignment** - Links physical files to media metadata (movies/episodes)
- **File Organization** - Structures files according to Jellyfin conventions

### Architecture
- **Frontend**: Next.js 16 with React and Material-UI
- **Backend**: FastAPI (Python) for file operations and library scanning
- **Database**: Firebase Firestore for metadata and assignment tracking
- **External APIs**: OMDB for media metadata lookup

### Data Flow
1. User scans a library path → Backend discovers files
2. Files are cataloged in Firestore → Duplicate detection runs
3. User assigns files to media → Assignment records created
4. User triggers organization → Files moved to Jellyfin structure
5. Jellyfin folder records created → Media available in player

## Contributing

### Code Structure
- `src/` - Frontend React/Next.js application
- `backend/` - Python FastAPI backend
- `docs/` - Documentation (you are here)
- `public/` - Static assets
- `firebaseConfig.js` - Firebase configuration

### Development Workflow
1. Review [Implementation Plan](./IMPLEMENTATION_PLAN.md) for current priorities
2. Check [API Documentation](./api/README.md) for endpoint details
3. Refer to [Architecture](./api/architecture.md) for system design
4. Follow patterns in [Data Structure](./DATA_STRUCTURE_REDESIGN.md)
5. Update relevant documentation with changes

## Support

### Common Issues

#### Backend Not Starting
- Check Python version: `python --version` (requires 3.8+)
- Verify FFmpeg installation: `ffprobe -version`
- Review backend logs in `backend/`

#### File Operations Failing
- Check path permissions
- Verify paths are within allowed base paths
- See [API Error Codes](./api/README.md#error-codes-and-http-status)

#### Assignment Not Working
- Ensure backend is running
- Check Firebase connection
- Review [Media Assignment Flow](./MEDIA_ASSIGNMENT_FLOW.md)

### Resources
- [API Documentation](./api/README.md)
- [Backend README](../backend/README.md)
- [Implementation Progress](./IMPLEMENTATION_PROGRESS.md)

## Version History

### Latest Updates (February 2026)
- Added multi-episode file assignment with drag-and-drop matching
- Enhanced folder selection with checkbox support
- Fixed file extension handling in media organization
- Consolidated API documentation into `docs/api/`

### Major Milestones
- **Priority 1-4 Complete** - All core features implemented
- **Episode Selection UI** - Multi-episode assignment workflow
- **Backend Integration** - Full file organization support
- **Media Assignment** - Complete movie and TV show workflow

## License

See the project root LICENSE file for details.

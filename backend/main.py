"""
Media Library Management API - Main Application

This is the main entry point for the FastAPI backend service that provides
comprehensive media library management, including file operations, library
scanning, metadata extraction, and duplicate detection.

Architecture:
    - FastAPI for REST API endpoints
    - Async/await for non-blocking I/O operations
    - Service layer pattern for business logic
    - Dependency injection via app state
    
Services:
    - FileSystemManager: Low-level file operations
    - MetadataExtractor: FFmpeg-based media metadata extraction  
    - LibraryScanner: Intelligent library scanning and cataloging
    - TaskManager: Async task execution and tracking

Author: Media Manager Team
Version: 1.0.0
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn

from config.settings import settings
from api.file_operations import router as file_router
from api.library_operations import router as library_router
from api.metadata_operations import router as metadata_router
from api.media_operations import router as media_router
from services.filesystem_manager import FileSystemManager
from services.metadata_extractor import MetadataExtractor
from services.library_scanner import LibraryScanner
from services.task_manager import AsyncTaskManager
from utils.logging import logger

# Global service instances - initialized during application startup
file_manager = None
metadata_extractor = None
library_scanner = None
task_manager = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifecycle manager - handles startup and shutdown events.
    
    This context manager ensures proper initialization and cleanup of all
    services throughout the application lifecycle.
    
    Startup Phase:
        - Initializes all core services
        - Injects services into application state for route access
        - Logs successful initialization
        
    Shutdown Phase:
        - Cleans up ongoing scan operations
        - Removes old task records
        - Ensures graceful shutdown
        
    Args:
        app: FastAPI application instance
        
    Yields:
        Control to the running application
    """
    # Startup
    global file_manager, metadata_extractor, library_scanner, task_manager
    
    logger.info("Starting Media Library Backend")
    
    # Initialize core services in dependency order
    file_manager = FileSystemManager()
    metadata_extractor = MetadataExtractor()
    library_scanner = LibraryScanner(file_manager, metadata_extractor)
    task_manager = AsyncTaskManager(max_workers=settings.scan_worker_threads)
    
    # Store services in app state for dependency injection in routes
    app.state.file_manager = file_manager
    app.state.metadata_extractor = metadata_extractor
    app.state.library_scanner = library_scanner
    app.state.task_manager = task_manager
    
    logger.info("Services initialized successfully")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Media Library Backend")
    
    # Cleanup ongoing scans and remove all scan data
    if library_scanner:
        library_scanner.cleanup_completed_scans(max_age_hours=0)  # Clean all
    
    # Cleanup task manager and remove all task records
    if task_manager:
        task_manager.cleanup_old_tasks(max_age_hours=0)  # Clean all

# Create FastAPI application instance with OpenAPI documentation
app = FastAPI(
    title="Media Library Management API",
    description="Backend API for managing media library files and metadata",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS middleware to allow frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],  # Frontend URLs (dev ports)
    allow_credentials=True,  # Allow cookies and authentication headers
    allow_methods=["*"],  # Allow all HTTP methods (GET, POST, PUT, DELETE, etc.)
    allow_headers=["*"],  # Allow all headers
)

# Include API routers with prefixes and tags for OpenAPI documentation
app.include_router(file_router, prefix="/api/files", tags=["File Operations"])
app.include_router(library_router, prefix="/api/library", tags=["Library Operations"])
app.include_router(metadata_router, prefix="/api/metadata", tags=["Metadata Operations"])
app.include_router(media_router, prefix="/api/media", tags=["Media Operations"])

@app.get("/")
async def root():
    """
    Root endpoint - provides basic API information.
    
    Returns:
        dict: API metadata including version and status
    """
    return {
        "message": "Media Library Management API",
        "version": "1.0.0",
        "status": "running"
    }

@app.get("/health")
async def health_check():
    """
    Health check endpoint - verifies all services are initialized and running.
    
    This endpoint is used by monitoring tools and load balancers to verify
    the application is healthy and ready to accept requests.
    
    Returns:
        dict: Health status including individual service availability
            - status: Overall health status ("healthy" or "unhealthy")
            - services: Dict of service availability flags
    """
    return {
        "status": "healthy",
        "services": {
            "file_manager": app.state.file_manager is not None,
            "metadata_extractor": app.state.metadata_extractor is not None,
            "library_scanner": app.state.library_scanner is not None,
            "task_manager": app.state.task_manager is not None
        }
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
        log_level="info"
    )
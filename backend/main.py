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
from homelab_logging import CorrelationMiddleware
from contextlib import asynccontextmanager
import asyncio
import os
import uvicorn

from config.settings import settings
from api.file_operations import router as file_router
from api.library_operations import router as library_router
from api.metadata_operations import router as metadata_router
from api.media_operations import router as media_router, initialize_organization_services
from api.file_browser import router as file_browser_router
from api.ingress_operations import router as ingress_router
from api.auth import router as auth_router
from api.catalog import router as catalog_router
from api.generic_data import router as generic_data_router
from api.library_paths import router as library_paths_router
from api.posters import router as posters_router
from api.library_compliance import router as library_compliance_router
from api.extras import router as extras_router
from api.tape_ingest import router as tape_ingest_router
from api.tape_settings import router as tape_settings_router
from api.mobile_auth import router as mobile_auth_router
from api.media_images import router as media_images_router
from db.database import engine, Base, AsyncSessionLocal
from db.models import AppConfig
from services.filesystem_manager import FileSystemManager
from services.file_watcher_service import FileWatcherService
from services.ingress_queue_service import IngressQueueService
from services.auto_matcher_service import AutoMatcherService
from services.assignment_orchestrator import AssignmentOrchestrator
from services.file_organization_service import FileOrganizationService
from services.metadata_extractor import MetadataExtractor
from services.library_scanner import LibraryScanner
from services.library_compliance_service import LibraryComplianceService
from services.task_manager import AsyncTaskManager
from utils.logging import logger

# Global service instances - initialized during application startup
file_manager = None
metadata_extractor = None
library_scanner = None
task_manager = None
file_watcher_service = None
ingress_queue_service = None
auto_matcher_service = None
assignment_orchestrator = None
ingress_auto_processor_task = None
library_compliance_service = None


async def run_ingress_auto_processor(app: FastAPI):
    """Continuously process pending ingress queue items while watcher is running."""
    interval_seconds = max(1, settings.ingress_auto_process_interval_seconds)
    _watcher_restart_check_counter = 0
    _retry_check_counter = 0

    while True:
        try:
            watcher_service = app.state.file_watcher_service
            queue_service = app.state.ingress_queue_service

            # Periodically check if the watcher died unexpectedly and restart it.
            _watcher_restart_check_counter += 1
            if _watcher_restart_check_counter >= 30:
                _watcher_restart_check_counter = 0
                if (
                    watcher_service
                    and getattr(app.state, "_watcher_should_run", False)
                    and not watcher_service.is_running
                ):
                    paths = getattr(app.state, "_watcher_paths", settings.ingress_default_paths)
                    try:
                        watcher_service.start_watching(paths)
                        logger.warning("Ingress watcher restarted after unexpected stop", paths=paths)
                    except Exception as restart_exc:
                        logger.error("Ingress watcher restart failed", error=str(restart_exc))

            # Auto-retry failed ingress items (transient errors, up to 3 attempts).
            _retry_check_counter += 1
            if _retry_check_counter >= 30 and queue_service:
                _retry_check_counter = 0
                now = __import__('time').time()
                retry_candidates = [
                    item for item in queue_service.items_by_id.values()
                    if item.status == "failed"
                    and (item.attempts or 0) < 3
                    and (item.last_attempt is None or now - item.last_attempt > 300)
                ]
                for item in retry_candidates:
                    await queue_service.retry_item(item.id)
                    logger.info(
                        "Auto-retrying failed ingress item",
                        item_id=item.id,
                        attempts=item.attempts,
                    )

            if (
                watcher_service
                and queue_service
                and watcher_service.is_running
            ):
                processed = await queue_service.process_next_item()
                if processed is not None:
                    await asyncio.sleep(0.1)
                    continue

            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            logger.info("Ingress auto processor task cancelled")
            raise
        except Exception as exc:
            logger.error("Ingress auto processor loop failed", error=str(exc))
            await asyncio.sleep(interval_seconds)

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
    global file_manager, metadata_extractor, library_scanner, task_manager, file_watcher_service, ingress_queue_service, auto_matcher_service, assignment_orchestrator, ingress_auto_processor_task, library_compliance_service
    
    logger.info("Starting Media Library Backend")
    
    # Initialize core services in dependency order
    file_manager = FileSystemManager()
    metadata_extractor = MetadataExtractor()
    library_scanner = LibraryScanner(file_manager, metadata_extractor)
    library_compliance_service = LibraryComplianceService(
        db_session_factory=AsyncSessionLocal,
        file_manager=file_manager,
    )
    task_manager = AsyncTaskManager(max_workers=settings.scan_worker_threads)


    # Auto-seed password from env var if no hash is stored yet.
    # By default we preserve user-set passwords across restarts.
    if settings.app_default_password:
        import bcrypt
        from sqlalchemy import select
        async with AsyncSessionLocal() as seed_db:
            result = await seed_db.execute(
                select(AppConfig).where(AppConfig.key == "password_hash")
            )
            existing = result.scalar_one_or_none()
            if not existing:
                hashed = bcrypt.hashpw(
                    settings.app_default_password.encode(), bcrypt.gensalt()
                ).decode()
                seed_db.add(AppConfig(key="password_hash", value=hashed))
                await seed_db.commit()
                logger.info("Default app password seeded from APP_DEFAULT_PASSWORD env var")
            elif settings.app_default_password_force_reset:
                hashed = bcrypt.hashpw(
                    settings.app_default_password.encode(), bcrypt.gensalt()
                ).decode()
                existing.value = hashed
                await seed_db.commit()
                logger.warning("Existing app password hash overwritten from APP_DEFAULT_PASSWORD due to force-reset")
            else:
                logger.debug("App password already set; skipping auto-seed")

    auto_matcher_service = AutoMatcherService(
        omdb_api_key=settings.omdb_api_key,
        tmdb_api_key=settings.tmdb_api_key,
        metadata_source="library_then_omdb",
    )
    file_organization_service = FileOrganizationService(
        filesystem_manager=file_manager,
        jellyfin_dest_base=settings.jellyfin_dest_base,
        db_session_factory=AsyncSessionLocal,
    )
    assignment_orchestrator = AssignmentOrchestrator(
        file_organization_service=file_organization_service,
        auto_organize_enabled=settings.ingress_auto_organize_enabled,
        db_session_factory=AsyncSessionLocal,
    )
    ingress_queue_service = IngressQueueService(
        auto_matcher_service=auto_matcher_service,
        assignment_orchestrator=assignment_orchestrator,
        auto_assign_threshold=settings.ingress_auto_assign_threshold,
        db_session_factory=AsyncSessionLocal,
    )

    ingress_runtime_config: dict = {
        "defaultIngressPaths": settings.ingress_default_paths,
        "autoProcessEnabled": settings.ingress_auto_process_enabled,
        "autoProcessIntervalSeconds": settings.ingress_auto_process_interval_seconds,
        "autoAssignThreshold": settings.ingress_auto_assign_threshold,
        "autoOrganizeEnabled": settings.ingress_auto_organize_enabled,
        "fileStabilityWaitSeconds": settings.ingress_file_stability_wait_seconds,
        "debounceSeconds": settings.ingress_debounce_seconds,
        "jellyfinDestBase": settings.jellyfin_dest_base,
        "defaultMetadataSource": "library_then_omdb",
    }

    # Startup health checks
    for ingress_path in ingress_runtime_config.get("defaultIngressPaths", []):
        if os.path.exists(ingress_path):
            logger.info("Ingress path accessible", path=ingress_path)
        else:
            logger.warning("Ingress path does not exist - watcher will fail to start", path=ingress_path)

    dest_base = settings.jellyfin_dest_base
    if os.path.exists(dest_base):
        logger.info("Destination mount accessible", path=dest_base)

        # Bootstrap typed destination folders so Jellyfin and the watcher
        # never encounter a missing directory on first run.
        bootstrap_folders = [
            settings.folder_movies,
            settings.folder_tv_shows,
            "Series",
            "Home Videos",
            settings.folder_documentaries,
            settings.folder_live_performances,
            settings.folder_needs_review,
            "ingest",
        ]
        for folder in bootstrap_folders:
            folder_path = os.path.join(dest_base, folder)
            try:
                os.makedirs(folder_path, exist_ok=True)
                logger.debug("Ensured media folder exists", path=folder_path)
            except OSError as exc:
                logger.warning("Could not create media folder", path=folder_path, error=str(exc))
    else:
        logger.warning("Destination mount not found - file organization will fail", path=dest_base)

    # Initialize Phase 4 services for file organization
    initialize_organization_services(None)
    
    file_watcher_service = FileWatcherService(
        file_manager=file_manager,
        queue_callback=ingress_queue_service.add_from_watcher,
    )

    # Ensure ingress paths exist before the watcher tries to start them.
    # Runs independently of dest_base existence to handle first-run and mount timing.
    for ingress_path in settings.ingress_default_paths:
        try:
            os.makedirs(ingress_path, exist_ok=True)
            logger.debug("Ensured ingress path exists", path=ingress_path)
        except OSError as exc:
            logger.warning("Could not create ingress path", path=ingress_path, error=str(exc))

    if settings.ingress_auto_start_watcher and settings.ingress_default_paths:
        try:
            file_watcher_service.start_watching(settings.ingress_default_paths)
            logger.info(
                "Ingress watcher auto-started",
                paths=settings.ingress_default_paths,
            )
            app.state._watcher_should_run = True
            app.state._watcher_paths = settings.ingress_default_paths
        except Exception as exc:
            logger.warning(
                "Ingress watcher auto-start failed",
                paths=settings.ingress_default_paths,
                error=str(exc),
            )
            app.state._watcher_should_run = False
            app.state._watcher_paths = settings.ingress_default_paths
    else:
        app.state._watcher_should_run = False
        app.state._watcher_paths = settings.ingress_default_paths

    # Store services in app state for dependency injection in routes
    app.state.file_manager = file_manager
    app.state.metadata_extractor = metadata_extractor
    app.state.library_scanner = library_scanner
    app.state.task_manager = task_manager
    app.state.library_compliance_service = library_compliance_service
    app.state.file_watcher_service = file_watcher_service
    app.state.ingress_queue_service = ingress_queue_service
    app.state.auto_matcher_service = auto_matcher_service
    app.state.file_organization_service = file_organization_service
    app.state.assignment_orchestrator = assignment_orchestrator
    app.state.ingress_runtime_config = ingress_runtime_config

    if settings.ingress_auto_process_enabled:
        ingress_auto_processor_task = asyncio.create_task(
            run_ingress_auto_processor(app)
        )
        app.state.ingress_auto_processor_task = ingress_auto_processor_task
    
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

    if file_watcher_service and file_watcher_service.is_running:
        file_watcher_service.stop_watching()

    if ingress_auto_processor_task:
        ingress_auto_processor_task.cancel()
        try:
            await ingress_auto_processor_task
        except asyncio.CancelledError:
            pass

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
    # Local development origins: localhost and LAN-hosted frontend URLs.
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_origin_regex=r"^https?://192\.168\.\d+\.\d+(?::\d+)?$",
    allow_credentials=True,  # Allow cookies and authentication headers
    allow_methods=["*"],  # Allow all HTTP methods (GET, POST, PUT, DELETE, etc.)
    allow_headers=["*"],  # Allow all headers
)

# Binds correlation_id/session_id to contextvars for the request lifetime so every
# log line emitted while handling this request carries the same searchable ID.
app.add_middleware(CorrelationMiddleware)

# Include API routers with prefixes and tags for OpenAPI documentation
app.include_router(file_router, prefix="/api/files", tags=["File Operations"])
app.include_router(file_browser_router, tags=["File Browser"])
app.include_router(library_router, prefix="/api/library", tags=["Library Operations"])
app.include_router(metadata_router, prefix="/api/metadata", tags=["Metadata Operations"])
app.include_router(media_router, prefix="/api/media", tags=["Media Operations"])
app.include_router(auth_router, prefix="/api")
app.include_router(catalog_router)
app.include_router(generic_data_router)
app.include_router(library_paths_router)
app.include_router(posters_router)
app.include_router(library_compliance_router)
app.include_router(extras_router)
app.include_router(tape_ingest_router)
app.include_router(tape_settings_router)
app.include_router(mobile_auth_router)
app.include_router(media_images_router)
app.include_router(ingress_router, prefix="/api/ingress", tags=["Ingress Operations"])

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
            "task_manager": app.state.task_manager is not None,
            "file_watcher_service": app.state.file_watcher_service is not None,
            "ingress_queue_service": app.state.ingress_queue_service is not None,
            "auto_matcher_service": app.state.auto_matcher_service is not None,
            "assignment_orchestrator": app.state.assignment_orchestrator is not None,
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
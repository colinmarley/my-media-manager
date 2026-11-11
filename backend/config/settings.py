import os
from typing import List
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings

class LibrarySettings(BaseSettings):
    # Server settings
    host: str = "localhost"
    port: int = 8082
    reload: bool = False

    # Library paths — includes NAS paths for Linux and Windows
    allowed_base_paths: List[str] = [
        "/ark",
        "/ark/media",
        "/media",
        "/movies",
        "/tv",
        "C:\\Media",
        "D:\\Movies",
        "D:\\TV Shows",
        "D:\\MakeMKV_Incoming",
        "\\\\192.168.0.175\\ark\\media",
    ]

    # File settings
    max_scan_depth: int = 10
    supported_video_extensions: List[str] = [
        ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".m4v", ".flv", ".webm"
    ]
    supported_audio_extensions: List[str] = [
        ".mp3", ".flac", ".wav", ".aac", ".ogg"
    ]
    supported_subtitle_extensions: List[str] = [
        ".srt", ".vtt", ".ass", ".ssa", ".sub", ".idx"
    ]

    # Operation limits
    max_file_size_gb: int = 50
    scan_timeout_minutes: int = 60
    metadata_extraction_timeout: int = 30
    max_concurrent_scans: int = 2
    scan_worker_threads: int = 4

    # Ingress watcher settings
    ingress_file_stability_wait_seconds: int = 10
    ingress_debounce_seconds: int = 5
    ingress_stability_poll_interval_seconds: int = 2
    # Polling is required for SMB/NFS shares (inotify doesn't work over the network).
    # Network paths are auto-detected at runtime; this flag forces polling unconditionally.
    ingress_use_polling_watcher: bool = True
    # Timeout in seconds for the PollingObserver scan interval.
    ingress_polling_observer_timeout_seconds: int = 5
    ingress_watch_recursive: bool = True
    ingress_default_paths: List[str] = Field(
        default=["/ark/media/ingest"],
        validation_alias=AliasChoices("MEDIA_LIBRARY_INGRESS_DEFAULT_PATHS"),
    )
    ingress_auto_process_enabled: bool = True
    ingress_auto_process_interval_seconds: int = 2
    ingress_auto_assign_threshold: int = 80
    ingress_auto_organize_enabled: bool = True
    # Auto-start the watcher on service startup.
    ingress_auto_start_watcher: bool = False

    # Security settings
    enable_file_integrity_checks: bool = False  # Disabled for performance during scanning
    use_trash_for_deletes: bool = True

    # External tools
    ffprobe_path: str = "ffprobe"
    ffmpeg_path: str = "ffmpeg"

    # Temporary directory
    temp_directory: str = "/tmp/media_manager"

    # Poster image cache (downloaded from external URLs on first request)
    poster_cache_dir: str = Field(
        default="/data/media_manager/posters",
        validation_alias=AliasChoices("MEDIA_LIBRARY_POSTER_CACHE_DIR", "POSTER_CACHE_DIR"),
    )

    # Media destination — TrueNAS NAS mount or any local/network path.
    # Accepts MEDIA_DEST_BASE or any legacy Jellyfin alias for backward compatibility.
    jellyfin_dest_base: str = Field(
        default="/ark/media/jellyfin",
        validation_alias=AliasChoices(
            "MEDIA_DEST_BASE",
            "JELLYFIN_DEST_BASE",
            "MEDIA_LIBRARY_JELLYFIN_DEST_BASE",
            "MEDIA_LIBRARY_MEDIA_DEST_BASE",
        ),
    )

    # NAS health / connectivity
    nas_host: str = Field(
        default="192.168.0.175",
        validation_alias=AliasChoices("MEDIA_LIBRARY_NAS_HOST"),
    )
    nas_mount_check_path: str = Field(
        default="/ark/media",
        validation_alias=AliasChoices("MEDIA_LIBRARY_NAS_MOUNT_CHECK_PATH"),
    )

    # Destination subfolder names (configurable so both Jellyfin and Plex naming are supported)
    folder_movies: str = "Movies"
    folder_tv_shows: str = "TV Shows"
    folder_documentaries: str = "Documentaries"
    folder_live_performances: str = "Live Performances"
    # Legacy staging folder inside the library. Nothing creates or moves files
    # into it any more (unmatched files stay in ingest, held for review); kept
    # so existing env files that set it still load.
    folder_needs_review: str = "_NeedsReview"
    # Folder for residual source trees that still contain unprocessed files
    folder_unprocessed: str = "Unprocessed"

    # Home videos live outside the Jellyfin library root (tape ingest).
    home_videos_path: str = Field(
        default="/ark/media/home-videos",
        validation_alias=AliasChoices("HOME_VIDEOS_PATH", "MEDIA_LIBRARY_HOME_VIDEOS_PATH"),
    )

    # When a second copy of a movie is processed, it is considered an alternate version
    # (Version 2, Version 3, …) rather than a Special Feature if its duration is at least
    # this fraction of the existing main-feature file's duration (default 85%).
    movie_version_duration_threshold: float = Field(
        default=0.85,
        validation_alias=AliasChoices("MEDIA_LIBRARY_MOVIE_VERSION_DURATION_THRESHOLD"),
    )

    # PostgreSQL
    database_url: str = Field(
        default="postgresql+asyncpg://media_user:changeme_strong_password@localhost:5432/media_manager",
        validation_alias=AliasChoices("DATABASE_URL", "MEDIA_LIBRARY_DATABASE_URL"),
    )

    # Session auth
    session_secret_key: str = Field(
        default="",
        validation_alias=AliasChoices("SESSION_SECRET_KEY", "MEDIA_LIBRARY_SESSION_SECRET_KEY"),
    )
    session_expiry_hours: int = 24 * 7  # 7 days by default

    # Mobile app bearer-token auth (parallel to cookie sessions above)
    mobile_token_expiry_days: int = Field(
        default=180,
        validation_alias=AliasChoices("MOBILE_TOKEN_EXPIRY_DAYS", "MEDIA_LIBRARY_MOBILE_TOKEN_EXPIRY_DAYS"),
    )

    # Data retention job (services/retention_service.py): runs on startup, then
    # every retention_interval_hours. Deletes expired sessions/mobile tokens,
    # old ingress history and old *completed* queue items (never needs_review
    # or failed). Dry run only logs what would be deleted.
    # Env: MEDIA_LIBRARY_RETENTION_* (e.g. MEDIA_LIBRARY_RETENTION_DRY_RUN=true).
    retention_enabled: bool = True
    retention_dry_run: bool = False
    retention_interval_hours: int = 24
    retention_ingress_history_days: int = 180
    retention_completed_queue_days: int = 90

    # Library inventory scan (services/library_inventory_service.py): walks the
    # four category folders, reconciles media_files (new / changed / moved /
    # missing), links files to their catalog title and probes technical
    # metadata. Runs shortly after startup, then every inventory_interval_minutes.
    # Env: MEDIA_LIBRARY_INVENTORY_* (e.g. MEDIA_LIBRARY_INVENTORY_ENABLED=false).
    inventory_enabled: bool = True
    inventory_interval_minutes: int = 360
    # Files probed (mediainfo) per scan, one at a time; the rest wait for the next scan.
    inventory_probe_batch: int = 25
    inventory_probe_timeout_seconds: int = 120
    # More than this fraction of the known library files vanishing in one scan
    # looks like an unmounted share, so nothing is marked missing.
    inventory_missing_abort_ratio: float = 0.2

    # Default app password — seeded automatically on first startup if no password hash
    # is found in the database. Set via APP_DEFAULT_PASSWORD env var.
    # Leave empty to require manual seeding via scripts/seed_password.py.
    app_default_password: str = Field(
        default="",
        validation_alias=AliasChoices("APP_DEFAULT_PASSWORD", "MEDIA_LIBRARY_APP_DEFAULT_PASSWORD"),
    )
    # If true, APP_DEFAULT_PASSWORD overwrites an existing password hash at startup.
    # Leave false to preserve user-set passwords across restarts.
    app_default_password_force_reset: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "APP_DEFAULT_PASSWORD_FORCE_RESET",
            "MEDIA_LIBRARY_APP_DEFAULT_PASSWORD_FORCE_RESET",
        ),
    )

    # External API settings
    omdb_api_key: str = ""  # Set via environment variable MEDIA_LIBRARY_OMDB_API_KEY
    tmdb_api_key: str = ""  # Set via environment variable MEDIA_LIBRARY_TMDB_API_KEY

    # Local vision model for the mobile "Scan cover" add-flow step, on LocalAI's
    # OpenAI-compatible API. Default is the docker0 bridge gateway, i.e. the
    # host's LocalAI as seen from inside the backend container on ai-workstation.
    localai_url: str = "http://localhost:8080"  # MEDIA_LIBRARY_LOCALAI_URL (compose: LOCALAI_URL)
    localai_api_key: str = ""  # MEDIA_LIBRARY_LOCALAI_API_KEY (LocalAI requires it)
    localai_vision_model: str = "qwen2.5vl-7b"  # MEDIA_LIBRARY_LOCALAI_VISION_MODEL

    # disc-ripper-service, for the mobile app's read-only rip status view.
    # Default reaches the host's port 8083 from inside the backend container.
    disc_ripper_url: str = "http://localhost:8083"  # MEDIA_LIBRARY_DISC_RIPPER_URL (compose: DISC_RIPPER_URL)


    # Tape ingest
    tape_ingest_ingress_folder: str = Field(
        default="",
        validation_alias=AliasChoices("TAPE_INGEST_INGRESS_FOLDER", "MEDIA_LIBRARY_TAPE_INGEST_INGRESS_FOLDER"),
    )
    tape_ingest_default_destination: str = Field(
        default="/ark/media/jellyfin",
        validation_alias=AliasChoices("TAPE_INGEST_DESTINATION", "MEDIA_LIBRARY_TAPE_INGEST_DEFAULT_DESTINATION"),
    )
    tape_ingest_ffmpeg_crf: int = Field(
        default=20,
        validation_alias=AliasChoices("TAPE_INGEST_FFMPEG_CRF", "MEDIA_LIBRARY_TAPE_INGEST_FFMPEG_CRF"),
    )
    tape_ingest_ffmpeg_preset: str = Field(
        default="medium",
        validation_alias=AliasChoices("TAPE_INGEST_FFMPEG_PRESET", "MEDIA_LIBRARY_TAPE_INGEST_FFMPEG_PRESET"),
    )

    tape_archive_path: str = Field(
        default="/ark/media/tape-archive",
        validation_alias=AliasChoices("TAPE_ARCHIVE_PATH", "MEDIA_LIBRARY_TAPE_ARCHIVE_PATH"),
    )

    # Cover-photo archive for movies/series/discs/tapes (generalized upload,
    # separate from tape_archive_path so the existing tape-digitization
    # workflow's storage tree is never touched by this feature).
    media_archive_path: str = Field(
        default="/ark/media/catalog-images",
        validation_alias=AliasChoices("MEDIA_ARCHIVE_PATH", "MEDIA_LIBRARY_MEDIA_ARCHIVE_PATH"),
    )

    class Config:
        env_file = ".env"
        env_prefix = "MEDIA_LIBRARY_"

# Global settings instance
settings = LibrarySettings()
import os
from typing import List
from pydantic_settings import BaseSettings

class LibrarySettings(BaseSettings):
    # Server settings
    host: str = "localhost"
    port: int = 8082
    reload: bool = False
    
    # Library paths
    allowed_base_paths: List[str] = [
        "/media",
        "/movies", 
        "/tv",
        "C:\\Media",
        "D:\\Movies",
        "D:\\TV Shows",
        "D:\\MakeMKV_Incoming"
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
    
    # Security settings
    enable_file_integrity_checks: bool = False  # Disabled for performance during scanning
    use_trash_for_deletes: bool = True
    
    # External tools
    ffprobe_path: str = "ffprobe"
    ffmpeg_path: str = "ffmpeg"
    
    # Temporary directory
    temp_directory: str = "/tmp/media_manager"
    
    # Firebase settings
    firebase_project_id: str = "media-db-cc511"
    firebase_credentials_path: str = ""  # Empty for default credentials
    
    class Config:
        env_file = ".env"
        env_prefix = "MEDIA_LIBRARY_"

# Global settings instance
settings = LibrarySettings()
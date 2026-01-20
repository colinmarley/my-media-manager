#!/usr/bin/env python3
"""
Startup script for Media Library Backend
"""

import sys
import os
import subprocess
from pathlib import Path

def check_dependencies():
    """Check if required dependencies are installed"""
    try:
        import ffmpeg
        print("✓ ffmpeg-python is installed")
    except ImportError:
        print("✗ ffmpeg-python not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "ffmpeg-python"])
    
    try:
        subprocess.run(["ffprobe", "-version"], capture_output=True, check=True)
        print("✓ ffprobe is available")
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("✗ ffprobe not found. Please install FFmpeg:")
        print("  - Windows: Download from https://ffmpeg.org/download.html")
        print("  - macOS: brew install ffmpeg")
        print("  - Linux: sudo apt install ffmpeg")
        return False
    
    return True

def setup_environment():
    """Setup environment variables and directories"""
    # Create temp directory if it doesn't exist
    temp_dir = os.getenv("MEDIA_LIBRARY_TEMP_DIRECTORY", "/tmp/media_manager")
    Path(temp_dir).mkdir(parents=True, exist_ok=True)
    print(f"✓ Temp directory ready: {temp_dir}")
    
    # Set default allowed paths if not configured
    if not os.getenv("MEDIA_LIBRARY_ALLOWED_BASE_PATHS"):
        print("⚠ No MEDIA_LIBRARY_ALLOWED_BASE_PATHS configured")
        print("  Using default paths. Configure this in production!")

def main():
    """Main startup function"""
    print("🎬 Media Library Backend - Starting...")
    print("="*50)
    
    # Check dependencies
    if not check_dependencies():
        print("❌ Dependency check failed. Please install missing dependencies.")
        sys.exit(1)
    
    # Setup environment
    setup_environment()
    
    # Install package dependencies
    try:
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "-r", "requirements.txt"
        ])
        print("✓ Python dependencies installed")
    except subprocess.CalledProcessError:
        print("⚠ Failed to install some dependencies. Continuing...")
    
    print("✓ Setup complete")
    print("="*50)
    
    # Start the server
    try:
        import uvicorn
        from main import app
        
        print("🚀 Starting FastAPI server...")
        uvicorn.run(
            "main:app",
            host="localhost",
            port=8082,
            reload=True,
            log_level="info"
        )
    except KeyboardInterrupt:
        print("\n⏹ Server stopped by user")
    except Exception as e:
        print(f"❌ Server failed to start: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
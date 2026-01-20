#!/usr/bin/env python3

from config.settings import settings
from services.filesystem_manager import FileSystemManager
from services.metadata_extractor import MetadataExtractor
from services.library_scanner import LibraryScanner

def test_filesystem_manager():
    print("Testing FileSystemManager configuration...")
    print(f"Settings allowed paths: {settings.allowed_base_paths}")
    
    # Create FileSystemManager instance like the backend does
    file_manager = FileSystemManager()
    print(f"FileSystemManager base paths: {file_manager.base_paths}")
    
    # Test path validation directly
    test_path = "D:/MakeMKV_Incoming"
    result = file_manager.validate_path_security(test_path)
    print(f"Direct path validation for '{test_path}': {result}")
    
    # Test through LibraryScanner like the API does
    metadata_extractor = MetadataExtractor()
    library_scanner = LibraryScanner(file_manager, metadata_extractor)
    
    print(f"LibraryScanner file_manager base paths: {library_scanner.file_manager.base_paths}")
    scanner_result = library_scanner.file_manager.validate_path_security(test_path)
    print(f"LibraryScanner path validation for '{test_path}': {scanner_result}")
    
    # Test if they're the same instance
    print(f"Same instance? {file_manager is library_scanner.file_manager}")

if __name__ == "__main__":
    test_filesystem_manager()
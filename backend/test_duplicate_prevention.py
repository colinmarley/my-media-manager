"""
Tests for Duplicate Prevention in Library Scanner

This test suite validates that the library scanner correctly prevents duplicate
files/directories from being saved to Firebase when they already exist with the
same filepath (libraryPath + path combination).

Test Scenarios:
1. New files should be included in scan results
2. Duplicate files (same libraryPath:path) should be filtered out
3. Same filename in different libraries should both be included (different composite keys)
4. Duplicate detection should work with both files and directories
5. Mixed scenarios with some duplicates and some new items
"""

import pytest
import asyncio
from typing import List, Dict, Any
from unittest.mock import Mock, patch, AsyncMock
from services.library_scanner import LibraryScanner, ScanProgress
from services.filesystem_manager import FileSystemManager
from services.metadata_extractor import MetadataExtractor


class TestDuplicatePrevention:
    """Test suite for duplicate file/directory prevention"""
    
    @pytest.fixture
    def mock_file_manager(self):
        """Create a mock FileSystemManager"""
        manager = Mock(spec=FileSystemManager)
        manager.validate_path_security.return_value = True
        return manager
    
    @pytest.fixture
    def mock_metadata_extractor(self):
        """Create a mock MetadataExtractor"""
        return Mock(spec=MetadataExtractor)
    
    @pytest.fixture
    def library_scanner(self, mock_file_manager, mock_metadata_extractor):
        """Create a LibraryScanner instance with mocked dependencies"""
        scanner = LibraryScanner(mock_file_manager, mock_metadata_extractor)
        return scanner
    
    def create_mock_file(self, path: str, name: str, library_path: str = "/media/library-a") -> Dict[str, Any]:
        """Helper to create mock file data"""
        return {
            'type': 'file',
            'path': path,
            'name': name,
            'extension': path.split('.')[-1] if '.' in path else '',
            'media_type': 'movie',
            'metadata': {
                'size': 1073741824,
                'created_time': 1702304400,
                'modified_time': 1702304400
            },
            'media_metadata': {},
            'parsed_info': {}
        }
    
    def create_mock_directory(self, path: str, name: str, library_path: str = "/media/library-a") -> Dict[str, Any]:
        """Helper to create mock directory data"""
        return {
            'type': 'directory',
            'path': path,
            'name': name,
            'media_type': 'series',
            'metadata': {
                'created_time': 1702304400,
                'modified_time': 1702304400
            }
        }
    
    def create_existing_file(self, path: str, library_path: str, name: str = None) -> Dict[str, Any]:
        """Helper to create existing file data from Firebase"""
        if name is None:
            name = path.split('/')[-1]
        return {
            'path': path,
            'libraryPath': library_path,
            'name': name,
            'extension': path.split('.')[-1] if '.' in path else '',
            'media_type': 'movie',
            'metadata': {},
            'media_metadata': {},
            'parsed_info': {}
        }
    
    def create_existing_directory(self, path: str, library_path: str, name: str = None) -> Dict[str, Any]:
        """Helper to create existing directory data from Firebase"""
        if name is None:
            name = path.split('/')[-1]
        return {
            'path': path,
            'libraryPath': library_path,
            'name': name,
            'media_type': 'series',
            'metadata': {}
        }
    
    @pytest.mark.asyncio
    async def test_new_file_should_be_included(self, library_scanner):
        """Test that a new file (not in existing data) is included in results"""
        # Arrange
        library_path = "/media/library-a"
        scan_results = [
            self.create_mock_file("/media/library-a/movies/new_movie.mp4", "new_movie.mp4")
        ]
        existing_files = []  # No existing files
        existing_directories = []
        
        # Act
        duplicate_report = await library_scanner._check_duplicates_with_existing(
            scan_results, 
            "user123", 
            library_path,
            existing_files, 
            existing_directories
        )
        
        # Assert
        assert duplicate_report['duplicatesFound'] == 0, "Should find no duplicates"
        assert duplicate_report['newItems'] == 1, "Should identify 1 new item"
        assert len(duplicate_report['differences']) == 0, "Should have no differences"
    
    @pytest.mark.asyncio
    async def test_duplicate_file_should_be_detected(self, library_scanner):
        """Test that a duplicate file (same libraryPath:path) is detected"""
        # Arrange
        library_path = "/media/library-a"
        file_path = "/media/library-a/movies/existing_movie.mp4"
        
        scan_results = [
            self.create_mock_file(file_path, "existing_movie.mp4")
        ]
        existing_files = [
            self.create_existing_file(file_path, library_path, "existing_movie.mp4")
        ]
        existing_directories = []
        
        # Act
        duplicate_report = await library_scanner._check_duplicates_with_existing(
            scan_results, 
            "user123", 
            library_path,
            existing_files, 
            existing_directories
        )
        
        # Assert
        assert duplicate_report['duplicatesFound'] == 1, "Should find 1 duplicate"
        assert duplicate_report['newItems'] == 0, "Should identify 0 new items"
    
    @pytest.mark.asyncio
    async def test_same_filename_different_libraries_both_included(self, library_scanner):
        """Test that same filename in different libraries are treated as separate (different composite keys)"""
        # Arrange
        library_path_a = "/media/library-a"
        library_path_b = "/media/library-b"
        file_path = "/movies/action/movie.mp4"  # Same relative path
        
        # Scanning library-b
        scan_results = [
            self.create_mock_file(file_path, "movie.mp4", library_path_b)
        ]
        
        # File exists in library-a (different library)
        existing_files = [
            self.create_existing_file(file_path, library_path_a, "movie.mp4")
        ]
        existing_directories = []
        
        # Act - scanning library-b
        duplicate_report = await library_scanner._check_duplicates_with_existing(
            scan_results, 
            "user123", 
            library_path_b,  # Scanning a different library
            existing_files, 
            existing_directories
        )
        
        # Assert
        assert duplicate_report['duplicatesFound'] == 0, "Should find no duplicates (different libraries)"
        assert duplicate_report['newItems'] == 1, "Should identify 1 new item"
        print(f"✓ Same filename in different libraries correctly treated as separate items")
    
    @pytest.mark.asyncio
    async def test_duplicate_directory_should_be_detected(self, library_scanner):
        """Test that duplicate directories are detected"""
        # Arrange
        library_path = "/media/library-a"
        dir_path = "/media/library-a/tv-shows/series-name"
        
        scan_results = [
            self.create_mock_directory(dir_path, "series-name")
        ]
        existing_files = []
        existing_directories = [
            self.create_existing_directory(dir_path, library_path, "series-name")
        ]
        
        # Act
        duplicate_report = await library_scanner._check_duplicates_with_existing(
            scan_results, 
            "user123", 
            library_path,
            existing_files, 
            existing_directories
        )
        
        # Assert
        assert duplicate_report['duplicatesFound'] == 1, "Should find 1 duplicate directory"
        assert duplicate_report['newItems'] == 0, "Should identify 0 new items"
    
    @pytest.mark.asyncio
    async def test_mixed_duplicates_and_new_items(self, library_scanner):
        """Test scenario with both duplicate and new items"""
        # Arrange
        library_path = "/media/library-a"
        
        scan_results = [
            # New file - should be included
            self.create_mock_file("/media/library-a/movies/new_movie.mp4", "new_movie.mp4"),
            # Duplicate file - should be detected
            self.create_mock_file("/media/library-a/movies/existing_movie.mp4", "existing_movie.mp4"),
            # New directory - should be included
            self.create_mock_directory("/media/library-a/tv/new-series", "new-series"),
            # Duplicate directory - should be detected
            self.create_mock_directory("/media/library-a/tv/existing-series", "existing-series"),
        ]
        
        existing_files = [
            self.create_existing_file("/media/library-a/movies/existing_movie.mp4", library_path)
        ]
        existing_directories = [
            self.create_existing_directory("/media/library-a/tv/existing-series", library_path)
        ]
        
        # Act
        duplicate_report = await library_scanner._check_duplicates_with_existing(
            scan_results, 
            "user123", 
            library_path,
            existing_files, 
            existing_directories
        )
        
        # Assert
        assert duplicate_report['duplicatesFound'] == 2, "Should find 2 duplicates (1 file, 1 dir)"
        assert duplicate_report['newItems'] == 2, "Should identify 2 new items (1 file, 1 dir)"
    
    @pytest.mark.asyncio
    async def test_composite_key_format(self, library_scanner):
        """Test that composite keys are correctly formatted as 'libraryPath:path'"""
        # Arrange
        library_path = "/media/library-a"
        file_path = "/media/library-a/movies/test.mp4"
        
        scan_results = [
            self.create_mock_file(file_path, "test.mp4")
        ]
        
        # Create existing file with matching composite key
        existing_files = [
            self.create_existing_file(file_path, library_path)
        ]
        existing_directories = []
        
        # Act
        duplicate_report = await library_scanner._check_duplicates_with_existing(
            scan_results, 
            "user123", 
            library_path,
            existing_files, 
            existing_directories
        )
        
        # Assert
        # The composite key should be: "/media/library-a:/media/library-a/movies/test.mp4"
        # This should match and be detected as duplicate
        assert duplicate_report['duplicatesFound'] == 1, "Composite key matching should work"
    
    @pytest.mark.asyncio
    async def test_empty_existing_data(self, library_scanner):
        """Test scanning with no existing data (all items should be new)"""
        # Arrange
        library_path = "/media/library-a"
        scan_results = [
            self.create_mock_file("/media/library-a/movies/movie1.mp4", "movie1.mp4"),
            self.create_mock_file("/media/library-a/movies/movie2.mp4", "movie2.mp4"),
            self.create_mock_directory("/media/library-a/tv/series1", "series1"),
        ]
        existing_files = []
        existing_directories = []
        
        # Act
        duplicate_report = await library_scanner._check_duplicates_with_existing(
            scan_results, 
            "user123", 
            library_path,
            existing_files, 
            existing_directories
        )
        
        # Assert
        assert duplicate_report['duplicatesFound'] == 0, "Should find no duplicates"
        assert duplicate_report['newItems'] == 3, "All 3 items should be new"
    
    @pytest.mark.asyncio
    async def test_all_duplicates(self, library_scanner):
        """Test scanning where all items are duplicates"""
        # Arrange
        library_path = "/media/library-a"
        
        scan_results = [
            self.create_mock_file("/media/library-a/movies/movie1.mp4", "movie1.mp4"),
            self.create_mock_file("/media/library-a/movies/movie2.mp4", "movie2.mp4"),
        ]
        
        existing_files = [
            self.create_existing_file("/media/library-a/movies/movie1.mp4", library_path),
            self.create_existing_file("/media/library-a/movies/movie2.mp4", library_path),
        ]
        existing_directories = []
        
        # Act
        duplicate_report = await library_scanner._check_duplicates_with_existing(
            scan_results, 
            "user123", 
            library_path,
            existing_files, 
            existing_directories
        )
        
        # Assert
        assert duplicate_report['duplicatesFound'] == 2, "All items should be duplicates"
        assert duplicate_report['newItems'] == 0, "No new items should be found"
    
    @pytest.mark.asyncio
    async def test_case_sensitive_paths(self, library_scanner):
        """Test that path comparison is case-sensitive"""
        # Arrange
        library_path = "/media/library-a"
        
        scan_results = [
            self.create_mock_file("/media/library-a/movies/Movie.mp4", "Movie.mp4"),
        ]
        
        # Existing file has different case
        existing_files = [
            self.create_existing_file("/media/library-a/movies/movie.mp4", library_path),
        ]
        existing_directories = []
        
        # Act
        duplicate_report = await library_scanner._check_duplicates_with_existing(
            scan_results, 
            "user123", 
            library_path,
            existing_files, 
            existing_directories
        )
        
        # Assert
        # Different case = different file (case-sensitive comparison)
        assert duplicate_report['newItems'] == 1, "Different case should be treated as new item"
        assert duplicate_report['duplicatesFound'] == 0, "Should not be detected as duplicate"


class TestDuplicateFiltering:
    """Test suite for duplicate filtering in scan results"""
    
    @pytest.fixture
    def mock_file_manager(self):
        """Create a mock FileSystemManager"""
        manager = Mock(spec=FileSystemManager)
        manager.validate_path_security.return_value = True
        return manager
    
    @pytest.fixture
    def mock_metadata_extractor(self):
        """Create a mock MetadataExtractor"""
        return Mock(spec=MetadataExtractor)
    
    @pytest.fixture
    def library_scanner(self, mock_file_manager, mock_metadata_extractor):
        """Create a LibraryScanner instance with mocked dependencies"""
        scanner = LibraryScanner(mock_file_manager, mock_metadata_extractor)
        return scanner
    
    def test_duplicate_filtering_scenario(self, library_scanner):
        """
        Test the complete duplicate filtering scenario:
        - Scan finds 5 files
        - 2 are duplicates (already in Firebase)
        - Only 3 should be in final results (duplicates filtered out)
        """
        # Arrange
        library_path = "/media/library-a"
        
        # Simulated scan results (5 files found)
        scan_results = [
            {'type': 'file', 'path': '/media/library-a/movies/new1.mp4', 'name': 'new1.mp4'},
            {'type': 'file', 'path': '/media/library-a/movies/duplicate1.mp4', 'name': 'duplicate1.mp4'},
            {'type': 'file', 'path': '/media/library-a/movies/new2.mp4', 'name': 'new2.mp4'},
            {'type': 'file', 'path': '/media/library-a/movies/duplicate2.mp4', 'name': 'duplicate2.mp4'},
            {'type': 'file', 'path': '/media/library-a/movies/new3.mp4', 'name': 'new3.mp4'},
        ]
        
        # Simulated duplicate paths (from duplicate detection)
        duplicate_paths = {
            '/media/library-a/movies/duplicate1.mp4',
            '/media/library-a/movies/duplicate2.mp4'
        }
        
        # Act - Filter out duplicates (simulating the filtering logic)
        filtered_results = [
            result for result in scan_results 
            if result.get('path', '') not in duplicate_paths
        ]
        
        # Assert
        assert len(scan_results) == 5, "Should start with 5 scanned files"
        assert len(filtered_results) == 3, "Should end with 3 files after filtering duplicates"
        
        # Verify only new files remain
        filtered_paths = [f['path'] for f in filtered_results]
        assert '/media/library-a/movies/new1.mp4' in filtered_paths
        assert '/media/library-a/movies/new2.mp4' in filtered_paths
        assert '/media/library-a/movies/new3.mp4' in filtered_paths
        
        # Verify duplicates are removed
        assert '/media/library-a/movies/duplicate1.mp4' not in filtered_paths
        assert '/media/library-a/movies/duplicate2.mp4' not in filtered_paths
        
        print(f"✓ Duplicate filtering test passed:")
        print(f"  - Scanned: {len(scan_results)} files")
        print(f"  - Duplicates removed: {len(duplicate_paths)}")
        print(f"  - Final results: {len(filtered_results)} files")
        print(f"  - Files to be saved to Firebase: {filtered_paths}")


class TestFirebaseSaveScenario:
    """
    Test the complete scenario from scan to Firebase save decision
    """
    
    def test_save_decision_based_on_filepath(self):
        """
        Test that save decision is correctly made based on filepath:
        - If filepath (libraryPath:path) exists: DO NOT save
        - If filepath (libraryPath:path) does NOT exist: DO save
        """
        library_path = "/media/library-a"
        
        # Files discovered during scan
        scanned_files = [
            {'path': '/media/library-a/movies/new_movie.mp4', 'name': 'new_movie.mp4'},
            {'path': '/media/library-a/movies/existing_movie.mp4', 'name': 'existing_movie.mp4'},
        ]
        
        # Files already in Firebase
        firebase_existing_files = [
            {'libraryPath': '/media/library-a', 'path': '/media/library-a/movies/existing_movie.mp4'}
        ]
        
        # Create composite keys for existing files
        existing_keys = {
            f"{item['libraryPath']}:{item['path']}" 
            for item in firebase_existing_files
        }
        
        # Determine which files should be saved
        files_to_save = []
        files_to_skip = []
        
        for file in scanned_files:
            file_key = f"{library_path}:{file['path']}"
            if file_key in existing_keys:
                files_to_skip.append(file)
                print(f"✗ SKIP: {file['path']} (already in Firebase with key: {file_key})")
            else:
                files_to_save.append(file)
                print(f"✓ SAVE: {file['path']} (new file with key: {file_key})")
        
        # Assertions
        assert len(files_to_save) == 1, "Should save 1 new file"
        assert len(files_to_skip) == 1, "Should skip 1 duplicate file"
        assert files_to_save[0]['path'] == '/media/library-a/movies/new_movie.mp4'
        assert files_to_skip[0]['path'] == '/media/library-a/movies/existing_movie.mp4'
        
        print(f"\n✓ Firebase save decision test passed:")
        print(f"  - Files to SAVE to Firebase: {len(files_to_save)}")
        print(f"  - Files to SKIP (duplicates): {len(files_to_skip)}")


def run_tests():
    """Run all tests with pytest"""
    print("=" * 80)
    print("DUPLICATE PREVENTION TEST SUITE")
    print("=" * 80)
    print("\nRunning tests...\n")
    
    # Run pytest programmatically
    pytest.main([
        __file__, 
        '-v',  # Verbose output
        '--tb=short',  # Short traceback format
        '-s',  # Don't capture output (show print statements)
    ])


if __name__ == "__main__":
    run_tests()

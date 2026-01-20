import asyncio
import sys
import os
sys.path.append(os.path.abspath('.'))

from services.library_scanner import LibraryScanner
from services.filesystem_manager import FileSystemManager
from services.metadata_extractor import MetadataExtractor

async def test_simple_scan():
    """Test library scanner with a simple scan"""
    
    print("Creating services...")
    file_manager = FileSystemManager()
    metadata_extractor = MetadataExtractor()
    scanner = LibraryScanner(file_manager, metadata_extractor)
    
    print("Starting scan...")
    try:
        scan_id = await scanner.start_scan("D:/MakeMKV_Incoming")
        print(f"Scan started with ID: {scan_id}")
        
        # Monitor progress for 30 seconds
        for i in range(30):
            await asyncio.sleep(1)
            progress = scanner.get_scan_status(scan_id)
            if progress:
                print(f"Progress: {progress.percentage}% - {progress.processed_items}/{progress.total_items} - Status: {progress.status}")
                if progress.status in ['completed', 'error']:
                    break
            else:
                print(f"No progress data available for scan {scan_id}")
                break
        
    except Exception as e:
        print(f"Error during scan: {e}")

if __name__ == "__main__":
    asyncio.run(test_simple_scan())
#!/usr/bin/env python3

import asyncio
import os
import time
from services.filesystem_manager import FileSystemManager
from services.metadata_extractor import MetadataExtractor
from services.library_scanner import LibraryScanner
from config.settings import settings

async def debug_scanner():
    """Debug the scanner to see where it's hanging"""
    print("Initializing scanner components...")
    
    # Initialize dependencies
    file_manager = FileSystemManager()
    metadata_extractor = MetadataExtractor()
    scanner = LibraryScanner(file_manager, metadata_extractor)
    
    path = "D:/MakeMKV_Incoming"
    print(f"Testing path: {path}")
    
    # Step 1: Test item counting
    print("\n1. Testing item counting...")
    try:
        start_time = time.time()
        total_items = await scanner._count_items_async(path)
        count_time = time.time() - start_time
        print(f"   ✅ Count completed: {total_items} items in {count_time:.2f} seconds")
    except Exception as e:
        print(f"   ❌ Count failed: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Step 2: Test scan start
    print("\n2. Testing scan start...")
    try:
        scan_id = await scanner.start_scan(path)
        print(f"   ✅ Scan started with ID: {scan_id}")
        
        # Check initial status
        initial_status = scanner.get_scan_status(scan_id)
        print(f"   Initial status: {initial_status}")
        
    except Exception as e:
        print(f"   ❌ Scan start failed: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Step 3: Monitor scan progress with detailed logging
    print("\n3. Monitoring scan progress...")
    last_processed = 0
    stuck_count = 0
    
    for i in range(30):  # Monitor for 1 minute
        await asyncio.sleep(2)
        
        try:
            status = scanner.get_scan_status(scan_id)
            if not status:
                print(f"   Check {i+1}: No status returned")
                continue
                
            current_processed = status.get('processed_items', 0)
            total_items = status.get('total_items', 0)
            percentage = status.get('percentage', 0)
            scan_status = status.get('status', 'unknown')
            current_path = status.get('current_path', 'unknown')
            errors = status.get('errors', [])
            
            print(f"   Check {i+1}: Status={scan_status}, Progress={percentage:.1f}%, Files={current_processed}/{total_items}")
            print(f"            Current path: {current_path}")
            
            if errors:
                print(f"            Errors: {len(errors)} error(s)")
                for error in errors[-3:]:  # Show last 3 errors
                    print(f"              - {error.get('type', 'unknown')}: {error.get('message', 'no message')}")
            
            # Check if scan is stuck
            if current_processed == last_processed:
                stuck_count += 1
                if stuck_count >= 5:
                    print(f"   ⚠️  Scan appears stuck - no progress for {stuck_count * 2} seconds")
            else:
                stuck_count = 0
                
            last_processed = current_processed
            
            # Check if scan completed or failed
            if scan_status in ['completed', 'failed', 'error']:
                print(f"   ✅ Scan finished with status: {scan_status}")
                break
                
        except Exception as e:
            print(f"   ❌ Status check failed: {e}")
    
    # Final status check
    print("\n4. Final status check...")
    try:
        final_status = scanner.get_scan_status(scan_id)
        if final_status:
            print(f"   Final status: {final_status}")
        else:
            print("   No final status available")
    except Exception as e:
        print(f"   Failed to get final status: {e}")

if __name__ == "__main__":
    asyncio.run(debug_scanner())
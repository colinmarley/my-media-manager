#!/usr/bin/env python3

import os
import time
from pathlib import Path

def test_directory_structure(path: str):
    """Test directory structure to identify potential scanning issues"""
    print(f"Testing directory structure for: {path}")
    print("=" * 50)
    
    if not os.path.exists(path):
        print(f"❌ Path does not exist: {path}")
        return
    
    if not os.path.isdir(path):
        print(f"❌ Path is not a directory: {path}")
        return
    
    # Test basic directory access
    try:
        items = os.listdir(path)
        print(f"✅ Directory accessible, contains {len(items)} items")
    except Exception as e:
        print(f"❌ Cannot list directory: {e}")
        return
    
    # Test os.walk performance
    print("\n🔍 Testing os.walk() performance...")
    start_time = time.time()
    total_dirs = 0
    total_files = 0
    max_depth = 0
    problematic_dirs = []
    
    try:
        for root, dirs, files in os.walk(path):
            # Calculate depth
            depth = root[len(path):].count(os.sep)
            max_depth = max(max_depth, depth)
            
            total_dirs += len(dirs)
            total_files += len(files)
            
            # Check for problematic directory names
            for dir_name in dirs:
                if len(dir_name) > 100:  # Very long names
                    problematic_dirs.append(os.path.join(root, dir_name))
            
            # Progress every 100 directories
            if total_dirs % 100 == 0 and total_dirs > 0:
                elapsed = time.time() - start_time
                print(f"  Progress: {total_dirs} dirs, {total_files} files (depth: {depth}) - {elapsed:.1f}s")
                
                # If it's taking too long, stop
                if elapsed > 30:
                    print("⚠️  Stopping scan - taking too long (>30s)")
                    break
    
    except Exception as e:
        print(f"❌ Error during os.walk(): {e}")
        return
    
    elapsed = time.time() - start_time
    print(f"\n📊 Scan Results:")
    print(f"  Total directories: {total_dirs}")
    print(f"  Total files: {total_files}")
    print(f"  Maximum depth: {max_depth}")
    print(f"  Time taken: {elapsed:.2f} seconds")
    
    if problematic_dirs:
        print(f"⚠️  Found {len(problematic_dirs)} directories with very long names:")
        for dir_path in problematic_dirs[:5]:  # Show first 5
            print(f"    {dir_path}")
    
    # Test specific media file counting
    print(f"\n🎬 Testing media file detection...")
    media_extensions = [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".m4v", ".flv", ".webm"]
    media_count = 0
    
    try:
        for root, dirs, files in os.walk(path):
            depth = root[len(path):].count(os.sep)
            if depth >= 10:  # Respect max depth like in the scanner
                dirs.clear()
                continue
                
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in media_extensions:
                    media_count += 1
                    
            if media_count > 0 and media_count % 50 == 0:
                print(f"  Found {media_count} media files so far...")
    
    except Exception as e:
        print(f"❌ Error counting media files: {e}")
    
    print(f"  Total media files found: {media_count}")
    
    # Show sample directory structure
    print(f"\n📁 Sample directory structure:")
    sample_count = 0
    try:
        for root, dirs, files in os.walk(path):
            if sample_count >= 10:  # Show first 10 directories
                break
                
            # Show relative path
            rel_path = os.path.relpath(root, path)
            if rel_path == ".":
                rel_path = "[root]"
            
            print(f"  {rel_path}/ ({len(dirs)} dirs, {len(files)} files)")
            sample_count += 1
            
    except Exception as e:
        print(f"❌ Error showing directory structure: {e}")

if __name__ == "__main__":
    test_directory_structure("D:/MakeMKV_Incoming")
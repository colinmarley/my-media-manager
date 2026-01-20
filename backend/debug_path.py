#!/usr/bin/env python3

import os
from config.settings import settings

def debug_path_validation(requested_path: str):
    """Debug path validation logic"""
    print(f"Debugging path validation for: {requested_path}")
    print(f"OS name: {os.name}")
    print()
    
    # Get settings
    base_paths = settings.allowed_base_paths
    print(f"Allowed base paths from settings: {base_paths}")
    print()
    
    # Normalize the requested path
    requested_absolute = os.path.realpath(requested_path)
    print(f"Requested path: {requested_path}")
    print(f"Requested absolute: {requested_absolute}")
    print()
    
    # Check each base path
    for i, base_path in enumerate(base_paths):
        print(f"--- Checking base path {i+1}: {base_path} ---")
        
        try:
            # Normalize the base path
            base_absolute = os.path.realpath(base_path)
            print(f"Base absolute: {base_absolute}")
            
            # For Windows, normalize path separators and case
            if os.name == 'nt':  # Windows
                requested_normalized = requested_absolute.lower().replace('\\', '/')
                base_normalized = base_absolute.lower().replace('\\', '/')
                print(f"Requested normalized (Windows): {requested_normalized}")
                print(f"Base normalized (Windows): {base_normalized}")
            else:
                requested_normalized = requested_absolute
                base_normalized = base_absolute
                print(f"Requested normalized (Unix): {requested_normalized}")
                print(f"Base normalized (Unix): {base_normalized}")
            
            # Check if the requested path starts with the base path
            matches = requested_normalized.startswith(base_normalized)
            print(f"Match: {matches}")
            
            if matches:
                print(f"✅ MATCH FOUND with base path: {base_path}")
                return True
                
        except Exception as e:
            print(f"❌ Error processing base path {base_path}: {e}")
        
        print()
    
    print("❌ NO MATCHES FOUND")
    return False

if __name__ == "__main__":
    result = debug_path_validation("D:/MakeMKV_Incoming")
    print(f"\nFinal result: {result}")
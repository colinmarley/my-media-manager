#!/usr/bin/env python3

"""
Quick test script to verify the scanning fixes work
"""

import asyncio
import requests
import time
import json

async def test_optimized_scan():
    print("Testing optimized library scanning...")
    
    # Start scan
    print("1. Starting scan...")
    response = requests.post("http://localhost:8082/api/library/scan", 
                           json={
                               "libraryPath": "D:/MakeMKV_Incoming",
                               "extractMetadata": False
                           })
    
    if response.status_code != 200:
        print(f"❌ Failed to start scan: {response.status_code}")
        print(f"Response: {response.text}")
        return
    
    data = response.json()
    scan_id = data["data"]["scanId"]
    print(f"✅ Scan started with ID: {scan_id}")
    
    # Monitor progress
    print("2. Monitoring progress...")
    for i in range(10):  # Check for 20 seconds
        await asyncio.sleep(2)
        
        response = requests.get(f"http://localhost:8082/api/library/scan/status/{scan_id}")
        
        if response.status_code != 200:
            print(f"❌ Failed to get status: {response.status_code}")
            continue
            
        data = response.json()
        status_info = data["data"]
        
        status = status_info.get("status", "unknown")
        percentage = status_info.get("percentage", 0)
        processed = status_info.get("processed_items", 0)
        total = status_info.get("total_items", 0)
        current_path = status_info.get("current_path", "unknown")
        
        print(f"   Check {i+1}: {status} - {percentage:.1f}% - {processed}/{total} files")
        print(f"            Current: {current_path}")
        
        if status in ["completed", "failed", "error"]:
            print(f"✅ Scan finished with status: {status}")
            break
    
    print("Test completed!")

if __name__ == "__main__":
    asyncio.run(test_optimized_scan())
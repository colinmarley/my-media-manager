#!/usr/bin/env python3

"""
Complete test script that starts server and tests the scan functionality
"""

import asyncio
import requests
import time
import json
import subprocess
import sys
import signal
import os
from threading import Thread

def start_server():
    """Start the uvicorn server"""
    os.chdir('/c/Users/colin/code/my-media-manager/backend')
    os.system('python -m uvicorn main:app --host localhost --port 8086')

async def test_scan():
    """Test the scan functionality"""
    print("Waiting for server to start...")
    await asyncio.sleep(3)
    
    print("Testing scan API...")
    try:
        response = requests.post('http://localhost:8086/api/library/scan', 
                               json={'libraryPath': 'D:/MakeMKV_Incoming', 'extractMetadata': False},
                               timeout=10)
        print(f'Status: {response.status_code}')
        if response.status_code == 200:
            data = response.json()
            scan_id = data['data']['scanId']
            print(f'✅ Scan started with ID: {scan_id}')
            
            # Monitor progress
            for i in range(8):  # Check for 16 seconds
                await asyncio.sleep(2)
                status_response = requests.get(f'http://localhost:8086/api/library/scan/status/{scan_id}')
                if status_response.status_code == 200:
                    status_data = status_response.json()
                    status = status_data['data']['status']
                    percentage = status_data['data'].get('percentage', 0)
                    processed = status_data['data'].get('processed_items', 0)
                    total = status_data['data'].get('total_items', 0)
                    print(f'   Check {i+1}: {status} - {percentage:.1f}% - {processed}/{total} files')
                    
                    if status in ['completed', 'failed', 'error']:
                        print(f'✅ Scan finished with status: {status}')
                        
                        # Print summary
                        if status == 'completed':
                            print(f"📊 Summary: Found {processed} items total")
                            errors = status_data['data'].get('errors', [])
                            if errors:
                                print(f"⚠️  Errors encountered: {len(errors)}")
                                for error in errors[:3]:  # Show first 3 errors
                                    print(f"   - {error.get('type', 'unknown')}: {error.get('message', 'no message')}")
                            else:
                                print("✅ No errors encountered")
                        break
                else:
                    print(f'❌ Status check failed: {status_response.text}')
                    break
        else:
            print(f'❌ Scan failed: {response.text}')
            
    except Exception as e:
        print(f'❌ Error: {e}')
        import traceback
        traceback.print_exc()

async def main():
    # Start server in thread
    server_thread = Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # Run test
    await test_scan()
    
    print("Test completed!")

if __name__ == "__main__":
    asyncio.run(main())
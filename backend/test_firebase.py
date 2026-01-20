#!/usr/bin/env python3
import os
import sys

# Add the backend directory to the Python path
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, backend_dir)

async def test_firestore():
    from services.firestore_service import FirestoreService
    
    print("Creating FirestoreService...")
    service = FirestoreService()
    
    print("Initializing...")
    await service.initialize()
    
    if service.is_connected:
        print("✅ Firestore connected successfully!")
    else:
        print("❌ Firestore in offline mode")
    
if __name__ == "__main__":
    import asyncio
    asyncio.run(test_firestore())
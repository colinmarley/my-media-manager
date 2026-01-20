#!/usr/bin/env python3

"""
Debug script to test imports and identify issues
"""

def test_imports():
    print("Testing imports...")
    
    try:
        print("1. Testing basic imports...")
        from config.settings import settings
        print("   ✓ Settings imported")
        
        print("2. Testing Firebase admin...")
        import firebase_admin
        print("   ✓ Firebase admin imported")
        
        print("3. Testing Firestore service...")
        from services.firestore_service import FirestoreService
        print("   ✓ Firestore service imported")
        
        print("4. Testing library scanner...")
        from services.library_scanner import LibraryScanner
        print("   ✓ Library scanner imported")
        
        print("5. Testing main app...")
        from main import app
        print("   ✓ Main app imported")
        
        print("All imports successful!")
        return True
        
    except Exception as e:
        print(f"❌ Import failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    test_imports()
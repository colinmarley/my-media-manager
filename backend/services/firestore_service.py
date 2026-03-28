from firebase_admin import initialize_app, firestore
import firebase_admin
from google.cloud.firestore import AsyncClient, SERVER_TIMESTAMP
from typing import Dict, List, Any, Optional
import time
from datetime import datetime
import logging

from config.settings import settings
from utils.logging import logger

class FirestoreService:
    def __init__(self, project_id: str = "media-db-cc511"):
        """Initialize Firestore service
        
        Args:
            project_id: Firebase project ID
        """
        self.project_id = project_id
        self._db = None
        self._initialized = False
        
    async def initialize(self):
        """Initialize Firebase Admin SDK"""
        try:
            if not self._initialized:
                # Initialize Firebase Admin SDK if not already done
                if not firebase_admin._apps:
                    try:
                        # Try to initialize with service account credentials
                        import os
                        from firebase_admin import credentials
                        
                        # Check if service account file exists
                        service_account_path = (
                            os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
                            or settings.firebase_credentials_path
                        )
                        if service_account_path and os.path.exists(service_account_path):
                            cred = credentials.Certificate(service_account_path)
                            initialize_app(cred)
                            logger.info(f"Firebase Admin SDK initialized with service account: {service_account_path}")
                        else:
                            # Fall back to default credentials
                            initialize_app()
                            logger.info("Firebase Admin SDK initialized with default credentials")
                            
                    except Exception as auth_error:
                        logger.warning(f"Firebase initialization failed: {auth_error}")
                        logger.info("Running in offline mode - scan results will not be saved to database")
                        self._initialized = False
                        return
                
                self._db = firestore.client()
                self._initialized = True
                logger.info("Firestore service initialized", project_id=self.project_id)
        except Exception as e:
            logger.error("Failed to initialize Firestore", error=str(e))
            logger.info("Running in offline mode - scan results will not be saved to database")
            self._initialized = False

    @property
    def db(self):
        """Get Firestore client"""
        if not self._initialized:
            raise RuntimeError("FirestoreService not initialized or running in offline mode")
        return self._db

    async def save_scan_result(self, scan_result: Dict[str, Any]) -> str:
        """Save scan result to Firestore
        
        Args:
            scan_result: Scan result data
            
        Returns:
            Document ID of saved result
        """
        if not self._initialized:
            logger.warning("Firestore not initialized - scan result not saved")
            return "offline_mode"
            
        try:
            doc_ref = self.db.collection('scanResults').add({
                **scan_result,
                'timestamp': firestore.SERVER_TIMESTAMP
            })
            doc_id = doc_ref[1].id
            logger.info("Scan result saved", doc_id=doc_id)
            return doc_id
        except Exception as e:
            logger.error("Failed to save scan result", error=str(e))
            raise

    async def save_media_files(self, files: List[Dict[str, Any]], scan_id: str) -> List[str]:
        """Save media files to Firestore
        
        Args:
            files: List of file information
            scan_id: Associated scan ID
            
        Returns:
            List of document IDs
        """
        if not self._initialized:
            logger.warning("Firestore not initialized - media files not saved")
            return ["offline_mode"]
            
        doc_ids = []
        batch = self.db.batch()
        
        try:
            for file_info in files:
                doc_ref = self.db.collection('mediaFiles').document()
                file_data = {
                    **file_info,
                    'scanId': scan_id,
                    'discoveredAt': firestore.SERVER_TIMESTAMP,
                    'status': 'discovered'
                }
                batch.set(doc_ref, file_data)
                doc_ids.append(doc_ref.id)
            
            batch.commit()
            logger.info("Media files saved", count=len(files), scan_id=scan_id)
            return doc_ids
        except Exception as e:
            logger.error("Failed to save media files", error=str(e))
            raise

    async def save_media_directories(self, directories: List[Dict[str, Any]], scan_id: str) -> List[str]:
        """Save media directories to Firestore
        
        Args:
            directories: List of directory information
            scan_id: Associated scan ID
            
        Returns:
            List of document IDs
        """
        if not self._initialized:
            logger.warning("Firestore not initialized - media directories not saved")
            return ["offline_mode"]
            
        doc_ids = []
        batch = self.db.batch()
        
        try:
            for dir_info in directories:
                doc_ref = self.db.collection('mediaDirectories').document()
                dir_data = {
                    **dir_info,
                    'scanId': scan_id,
                    'discoveredAt': firestore.SERVER_TIMESTAMP,
                    'status': 'discovered'
                }
                batch.set(doc_ref, dir_data)
                doc_ids.append(doc_ref.id)
            
            batch.commit()
            logger.info("Media directories saved", count=len(directories), scan_id=scan_id)
            return doc_ids
        except Exception as e:
            logger.error("Failed to save media directories", error=str(e))
            raise

    async def update_library_path_scan_status(self, library_path: str, scan_id: str, status: str):
        """Update library path with latest scan information
        
        Args:
            library_path: Path that was scanned
            scan_id: Scan ID
            status: Scan status (completed, failed, etc.)
        """
        if not self._initialized:
            logger.warning("Firestore not initialized - library path status not updated")
            return
            
        try:
            # Find library path document by path
            paths_ref = self.db.collection('libraryPaths')
            query = paths_ref.where('rootPath', '==', library_path)
            docs = query.get()
            
            if docs:
                for doc in docs:
                    doc_ref = paths_ref.document(doc.id)
                    doc_ref.update({
                        'lastScanned': firestore.SERVER_TIMESTAMP,
                        'lastScanId': scan_id,
                        'lastScanStatus': status,
                        'scanProgress': 100 if status == 'completed' else 0
                    })
                    logger.info("Library path updated", path=library_path, scan_id=scan_id, status=status)
                    break
            else:
                logger.warning("Library path not found in database", path=library_path)
        except Exception as e:
            logger.error("Failed to update library path", error=str(e), path=library_path)

    async def save_media_matches(self, matches: List[Dict[str, Any]]) -> List[str]:
        """Save media matching results to Firestore
        
        Args:
            matches: List of media match data
            
        Returns:
            List of document IDs
        """
        doc_ids = []
        batch = self.db.batch()
        
        try:
            for match in matches:
                doc_ref = self.db.collection('mediaMatches').document()
                match_data = {
                    **match,
                    'createdAt': firestore.SERVER_TIMESTAMP,
                    'status': match.get('status', 'pending_review')
                }
                batch.set(doc_ref, match_data)
                doc_ids.append(doc_ref.id)
            
            batch.commit()
            logger.info("Media matches saved", count=len(matches))
            return doc_ids
        except Exception as e:
            logger.error("Failed to save media matches", error=str(e))
            raise

    async def get_library_paths(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all library paths
        
        Args:
            user_id: Optional user filter
            
        Returns:
            List of library path documents
        """
        try:
            paths_ref = self.db.collection('libraryPaths')
            
            if user_id:
                query = paths_ref.where('userId', '==', user_id)
            else:
                query = paths_ref
            
            docs = query.get()
            paths = []
            
            for doc in docs:
                data = doc.to_dict()
                data['id'] = doc.id
                paths.append(data)
            
            return paths
        except Exception as e:
            logger.error("Failed to get library paths", error=str(e))
            return []

    async def get_scan_results(self, library_path_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get scan results
        
        Args:
            library_path_id: Optional filter by library path
            
        Returns:
            List of scan result documents
        """
        try:
            results_ref = self.db.collection('scanResults')
            
            if library_path_id:
                query = results_ref.where('libraryPathId', '==', library_path_id)
            else:
                query = results_ref
            
            docs = query.order_by('timestamp', direction='DESCENDING').limit(50).get()
            results = []
            
            for doc in docs:
                data = doc.to_dict()
                data['id'] = doc.id
                results.append(data)
            
            return results
        except Exception as e:
            logger.error("Failed to get scan results", error=str(e))
            return []

    async def get_scanned_files(self, scan_id: Optional[str] = None, library_path: Optional[str] = None, 
                               limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """Get scanned media files
        
        Args:
            scan_id: Optional filter by scan ID
            library_path: Optional filter by library path
            limit: Maximum number of results to return
            offset: Number of results to skip
            
        Returns:
            List of media file documents
        """
        if not self._initialized:
            logger.warning("Firestore not initialized - cannot get scanned files")
            return []
            
        try:
            files_ref = self.db.collection('mediaFiles')
            query_ref = files_ref
            
            if scan_id:
                query_ref = files_ref.where('scanId', '==', scan_id)
            elif library_path:
                query_ref = files_ref.where('path', '>=', library_path).where('path', '<', library_path + '\uf8ff')
            
            docs = query_ref.order_by('path').limit(limit).offset(offset).get()
            files = []
            
            for doc in docs:
                data = doc.to_dict()
                data['id'] = doc.id
                files.append(data)
            
            return files
        except Exception as e:
            logger.error("Failed to get scanned files", error=str(e))
            return []

    async def get_scanned_directories(self, scan_id: Optional[str] = None, library_path: Optional[str] = None,
                                    limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """Get scanned media directories
        
        Args:
            scan_id: Optional filter by scan ID  
            library_path: Optional filter by library path
            limit: Maximum number of results to return
            offset: Number of results to skip
            
        Returns:
            List of media directory documents
        """
        if not self._initialized:
            logger.warning("Firestore not initialized - cannot get scanned directories")
            return []
            
        try:
            dirs_ref = self.db.collection('mediaDirectories')
            query_ref = dirs_ref
            
            if scan_id:
                query_ref = dirs_ref.where('scanId', '==', scan_id)
            elif library_path:
                query_ref = dirs_ref.where('path', '>=', library_path).where('path', '<', library_path + '\uf8ff')
            
            docs = query_ref.order_by('path').limit(limit).offset(offset).get()
            directories = []
            
            for doc in docs:
                data = doc.to_dict()
                data['id'] = doc.id
                directories.append(data)
            
            return directories
        except Exception as e:
            logger.error("Failed to get scanned directories", error=str(e))
            return []
    
    async def get_existing_file_paths(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        """Get existing file paths from database for duplicate checking
        
        Args:
            user_id: User ID to filter by
            
        Returns:
            Dictionary mapping file paths to their data
        """
        if not self._initialized:
            logger.warning("Firestore not initialized - returning empty file paths")
            return {}
            
        try:
            files_ref = self.db.collection('mediaFiles')
            # If we have user-specific collections, filter by user
            if user_id:
                files_ref = files_ref.where('userId', '==', user_id)
            
            docs = files_ref.get()
            file_paths = {}
            
            for doc in docs:
                data = doc.to_dict()
                file_path = data.get('path', '')
                if file_path:
                    file_paths[file_path] = data
            
            logger.info("Retrieved existing file paths", count=len(file_paths))
            return file_paths
        except Exception as e:
            logger.error("Failed to get existing file paths", error=str(e))
            return {}
    
    async def get_existing_directory_paths(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        """Get existing directory paths from database for duplicate checking
        
        Args:
            user_id: User ID to filter by
            
        Returns:
            Dictionary mapping directory paths to their data
        """
        if not self._initialized:
            logger.warning("Firestore not initialized - returning empty directory paths")
            return {}
            
        try:
            dirs_ref = self.db.collection('mediaDirectories')
            # If we have user-specific collections, filter by user
            if user_id:
                dirs_ref = dirs_ref.where('userId', '==', user_id)
            
            docs = dirs_ref.get()
            dir_paths = {}
            
            for doc in docs:
                data = doc.to_dict()
                dir_path = data.get('path', '')
                if dir_path:
                    dir_paths[dir_path] = data
            
            logger.info("Retrieved existing directory paths", count=len(dir_paths))
            return dir_paths
        except Exception as e:
            logger.error("Failed to get existing directory paths", error=str(e))
            return {}

    # ========================================================================
    # Ingress Queue & History Methods
    # ========================================================================

    async def save_ingress_queue_item(self, item_dict: Dict[str, Any]) -> str:
        """Save an ingress queue item to Firestore."""
        if not self._initialized:
            logger.warning("Firestore not initialized - queue item not saved")
            return ""

        try:
            doc_ref = self.db.collection("ingress_queue").document(item_dict["id"])
            doc_ref.set({
                **item_dict,
                "createdAt": SERVER_TIMESTAMP,
                "updatedAt": SERVER_TIMESTAMP,
            })
            logger.info("Ingress queue item saved", item_id=item_dict["id"])
            return item_dict["id"]
        except Exception as e:
            logger.error("Failed to save ingress queue item", error=str(e))
            raise

    async def update_ingress_queue_item(
        self, item_id: str, updates: Dict[str, Any]
    ) -> bool:
        """Update an existing ingress queue item."""
        if not self._initialized:
            logger.warning("Firestore not initialized - queue item not updated")
            return False

        try:
            doc_ref = self.db.collection("ingress_queue").document(item_id)
            doc_ref.update({
                **updates,
                "updatedAt": SERVER_TIMESTAMP,
            })
            logger.info("Ingress queue item updated", item_id=item_id)
            return True
        except Exception as e:
            logger.error(
                "Failed to update ingress queue item",
                item_id=item_id,
                error=str(e),
            )
            return False

    async def get_ingress_queue_item(
        self, item_id: str
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a single ingress queue item."""
        if not self._initialized:
            return None

        try:
            doc = self.db.collection("ingress_queue").document(item_id).get()
            if doc.exists:
                data = doc.to_dict()
                data["id"] = doc.id
                return data
            return None
        except Exception as e:
            logger.error(
                "Failed to get ingress queue item", item_id=item_id, error=str(e)
            )
            return None

    async def get_ingress_queue_items(
        self, status: Optional[str] = None, limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Retrieve ingress queue items with optional status filter."""
        if not self._initialized:
            return []

        try:
            query = self.db.collection("ingress_queue")
            if status:
                query = query.where("status", "==", status)

            docs = (
                query.order_by("queued_at", direction="DESCENDING")
                .limit(limit)
                .get()
            )
            items = []
            for doc in docs:
                data = doc.to_dict()
                data["id"] = doc.id
                items.append(data)

            return items
        except Exception as e:
            logger.error("Failed to get ingress queue items", error=str(e))
            return []

    async def save_ingress_processing_history(
        self, history_item: Dict[str, Any]
    ) -> str:
        """Save a processing history record to Firestore."""
        if not self._initialized:
            logger.warning("Firestore not initialized - history not saved")
            return ""

        try:
            doc_ref = self.db.collection("ingress_processing_history").document()
            doc_ref.set(
                {
                    **history_item,
                    "createdAt": SERVER_TIMESTAMP,
                }
            )
            logger.info("Ingress processing history saved")
            return doc_ref.id
        except Exception as e:
            logger.error("Failed to save ingress processing history", error=str(e))
            raise

    async def get_ingress_processing_history(
        self, limit: int = 100, status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Retrieve recent processing history with optional filter."""
        if not self._initialized:
            return []

        try:
            query = self.db.collection("ingress_processing_history")
            if status:
                query = query.where("status", "==", status)

            docs = (
                query.order_by("createdAt", direction="DESCENDING")
                .limit(limit)
                .get()
            )
            items = []
            for doc in docs:
                data = doc.to_dict()
                data["id"] = doc.id
                items.append(data)

            return items
        except Exception as e:
            logger.error("Failed to get ingress processing history", error=str(e))
            return []

    # ========================================================================
    # Ingress Runtime Config Methods
    # ========================================================================

    async def save_ingress_config(self, config_dict: Dict[str, Any]) -> bool:
        """Persist ingress runtime config to Firestore (single 'current' document)."""
        if not self._initialized:
            logger.warning("Firestore not initialized - ingress config not saved")
            return False

        try:
            doc_ref = self.db.collection("ingress_config").document("current")
            doc_ref.set({
                **config_dict,
                "updatedAt": SERVER_TIMESTAMP,
            })
            logger.info("Ingress config saved to Firestore")
            return True
        except Exception as e:
            logger.error("Failed to save ingress config", error=str(e))
            return False

    async def get_ingress_config(self) -> Optional[Dict[str, Any]]:
        """Load saved ingress runtime config from Firestore."""
        if not self._initialized:
            return None

        try:
            doc = self.db.collection("ingress_config").document("current").get()
            if doc.exists:
                data = doc.to_dict()
                data.pop("updatedAt", None)
                return data
            return None
        except Exception as e:
            logger.error("Failed to get ingress config", error=str(e))
            return None
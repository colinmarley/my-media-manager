"""
Firestore persistence methods for ingress queue and history.

These methods extend FirestoreService to save/retrieve ingress queue items
and processing history records.
"""

from typing import Dict, List, Any, Optional
from datetime import datetime
from google.cloud.firestore import SERVER_TIMESTAMP


def save_ingress_queue_item(self, item_dict: Dict[str, Any]) -> str:
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


def update_ingress_queue_item(self, item_id: str, updates: Dict[str, Any]) -> bool:
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
        logger.error("Failed to update ingress queue item", item_id=item_id, error=str(e))
        return False


def get_ingress_queue_item(self, item_id: str) -> Optional[Dict[str, Any]]:
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
        logger.error("Failed to get ingress queue item", item_id=item_id, error=str(e))
        return None


def get_ingress_queue_items(
    self, status: Optional[str] = None, limit: int = 100
) -> List[Dict[str, Any]]:
    """Retrieve ingress queue items with optional status filter."""
    if not self._initialized:
        return []

    try:
        query = self.db.collection("ingress_queue")
        if status:
            query = query.where("status", "==", status)
        
        docs = query.order_by("queued_at", direction="DESCENDING").limit(limit).get()
        items = []
        for doc in docs:
            data = doc.to_dict()
            data["id"] = doc.id
            items.append(data)
        
        return items
    except Exception as e:
        logger.error("Failed to get ingress queue items", error=str(e))
        return []


def save_ingress_processing_history(
    self, history_item: Dict[str, Any]
) -> str:
    """Save a processing history record to Firestore."""
    if not self._initialized:
        logger.warning("Firestore not initialized - history not saved")
        return ""

    try:
        doc_ref = self.db.collection("ingress_processing_history").document()
        doc_ref.set({
            **history_item,
            "createdAt": SERVER_TIMESTAMP,
        })
        logger.info("Ingress processing history saved")
        return doc_ref.id
    except Exception as e:
        logger.error("Failed to save ingress processing history", error=str(e))
        raise


def get_ingress_processing_history(
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

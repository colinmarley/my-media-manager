"""Ingress automation API router.

Provides endpoints for controlling the file watcher and processing queue used
by the automated encoded-media ingress pipeline.
"""

import time
from typing import Any, Dict, List, Optional
import os

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from config.settings import settings
from utils.exceptions import ScanOperationError
from utils.logging import logger

router = APIRouter()


class StartWatcherRequest(BaseModel):
    ingressPaths: List[str] = Field(default_factory=list)
    usePolling: Optional[bool] = None
    recursive: Optional[bool] = None
    processExistingFiles: bool = False


class QueueRetryRequest(BaseModel):
    itemId: str


class QueueFailRequest(BaseModel):
    itemId: str
    reason: str


class ProcessPendingRequest(BaseModel):
    maxItems: int = Field(default=25, ge=1, le=500)


class UpdateConfigRequest(BaseModel):
    autoAssignThreshold: Optional[int] = Field(default=None, ge=0, le=100)
    autoOrganizeEnabled: Optional[bool] = None
    autoProcessEnabled: Optional[bool] = None
    defaultIngressPaths: Optional[List[str]] = None


class AddFilesRequest(BaseModel):
    filePaths: List[str]
    priority: int = Field(default=5, ge=1, le=10)


@router.post("/watcher/start")
async def start_ingress_watcher(payload: StartWatcherRequest, req: Request):
    """Start monitoring ingress paths for new encoded files."""
    watcher_service = req.app.state.file_watcher_service
    queue_service = req.app.state.ingress_queue_service

    try:
        ingress_paths = payload.ingressPaths or settings.ingress_default_paths
        process_existing_queued = 0

        if payload.processExistingFiles:
            recursive = (
                payload.recursive
                if payload.recursive is not None
                else settings.ingress_watch_recursive
            )
            supported_extensions = {
                ext.lower() for ext in getattr(watcher_service, "supported_extensions", set())
            }

            for ingress_path in ingress_paths:
                if not os.path.isdir(ingress_path):
                    continue

                if recursive:
                    for root, _, files in os.walk(ingress_path):
                        for name in files:
                            ext = os.path.splitext(name)[1].lower()
                            if supported_extensions and ext not in supported_extensions:
                                continue
                            file_path = os.path.join(root, name)
                            queue_service.add_manual_file(file_path)
                            process_existing_queued += 1
                else:
                    for name in os.listdir(ingress_path):
                        file_path = os.path.join(ingress_path, name)
                        if not os.path.isfile(file_path):
                            continue
                        ext = os.path.splitext(name)[1].lower()
                        if supported_extensions and ext not in supported_extensions:
                            continue
                        queue_service.add_manual_file(file_path)
                        process_existing_queued += 1

        status = watcher_service.start_watching(
            ingress_paths=ingress_paths,
            use_polling=payload.usePolling,
            recursive=payload.recursive,
        )

        status["process_existing_queued"] = process_existing_queued
        return {
            "success": True,
            "data": status,
            "timestamp": str(int(time.time())),
        }
    except ScanOperationError as exc:
        raise HTTPException(status_code=400, detail={
            "type": "ScanOperationError",
            "message": str(exc),
            "code": "WATCHER_START_FAILED",
        })
    except Exception as exc:
        logger.error("Failed to start ingress watcher", error=str(exc))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Failed to start ingress watcher",
            "code": "INTERNAL_ERROR",
        })


@router.post("/watcher/stop")
async def stop_ingress_watcher(req: Request):
    """Stop ingress watcher and keep any already queued items."""
    watcher_service = req.app.state.file_watcher_service

    try:
        status = watcher_service.stop_watching()
        return {
            "success": True,
            "data": status,
            "timestamp": str(int(time.time())),
        }
    except Exception as exc:
        logger.error("Failed to stop ingress watcher", error=str(exc))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Failed to stop ingress watcher",
            "code": "INTERNAL_ERROR",
        })


@router.get("/watcher/status")
async def get_ingress_watcher_status(req: Request):
    watcher_service = req.app.state.file_watcher_service
    return {
        "success": True,
        "data": watcher_service.get_status(),
        "timestamp": str(int(time.time())),
    }


@router.get("/queue/status")
async def get_ingress_queue_status(req: Request):
    queue_service = req.app.state.ingress_queue_service
    return {
        "success": True,
        "data": queue_service.get_queue_status(),
        "timestamp": str(int(time.time())),
    }


@router.get("/queue/items")
async def get_ingress_queue_items(
    req: Request,
    status: Optional[str] = Query(default=None),
):
    queue_service = req.app.state.ingress_queue_service
    return {
        "success": True,
        "data": {
            "items": queue_service.get_queue_items(status=status),
            "statusFilter": status,
        },
        "timestamp": str(int(time.time())),
    }


@router.post("/queue/process-next")
async def process_next_ingress_item(req: Request):
    queue_service = req.app.state.ingress_queue_service

    queue_item = await queue_service.process_next_item()
    return {
        "success": True,
        "data": {
            "item": queue_item.to_dict() if queue_item else None,
            "processed": queue_item is not None,
        },
        "timestamp": str(int(time.time())),
    }


@router.post("/queue/process-pending")
async def process_pending_ingress_items(payload: ProcessPendingRequest, req: Request):
    queue_service = req.app.state.ingress_queue_service
    processed_items = await queue_service.process_pending_items(max_items=payload.maxItems)

    return {
        "success": True,
        "data": {
            "processedCount": len(processed_items),
            "items": processed_items,
        },
        "timestamp": str(int(time.time())),
    }


@router.post("/queue/retry")
async def retry_ingress_item(payload: QueueRetryRequest, req: Request):
    queue_service = req.app.state.ingress_queue_service

    queue_item = await queue_service.retry_item(payload.itemId)
    if queue_item is None:
        raise HTTPException(status_code=404, detail={
            "type": "NotFoundError",
            "message": f"Queue item not found: {payload.itemId}",
            "code": "QUEUE_ITEM_NOT_FOUND",
        })

    return {
        "success": True,
        "data": queue_item.to_dict(),
        "timestamp": str(int(time.time())),
    }


@router.post("/queue/mark-complete")
async def mark_ingress_item_complete(payload: QueueRetryRequest, req: Request):
    queue_service = req.app.state.ingress_queue_service

    queue_item = await queue_service.mark_complete(payload.itemId)
    if queue_item is None:
        raise HTTPException(status_code=404, detail={
            "type": "NotFoundError",
            "message": f"Queue item not found: {payload.itemId}",
            "code": "QUEUE_ITEM_NOT_FOUND",
        })

    return {
        "success": True,
        "data": queue_item.to_dict(),
        "timestamp": str(int(time.time())),
    }


@router.post("/queue/mark-failed")
async def mark_ingress_item_failed(payload: QueueFailRequest, req: Request):
    queue_service = req.app.state.ingress_queue_service

    queue_item = await queue_service.mark_failed(payload.itemId, payload.reason)
    if queue_item is None:
        raise HTTPException(status_code=404, detail={
            "type": "NotFoundError",
            "message": f"Queue item not found: {payload.itemId}",
            "code": "QUEUE_ITEM_NOT_FOUND",
        })

    return {
        "success": True,
        "data": queue_item.to_dict(),
        "timestamp": str(int(time.time())),
    }


@router.get("/queue/status-map")
async def get_queue_status_map(req: Request):
    """Return a file_path -> {status, confidence, title, queue_item_id} map for all queue items."""
    queue_service = req.app.state.ingress_queue_service
    all_items: List[Dict[str, Any]] = queue_service.get_queue_items()

    status_map: Dict[str, Any] = {}
    for item in all_items:
        best_match = item.get("best_match") or {}
        status_map[item["file_path"]] = {
            "status": item["status"],
            "confidence": item.get("confidence_score"),
            "title": best_match.get("title"),
            "queue_item_id": item["id"],
        }

    return {
        "success": True,
        "data": status_map,
        "timestamp": str(int(time.time())),
    }


@router.get("/health")
async def get_ingress_health(req: Request):
    """Check accessibility of ingress and destination paths."""
    runtime_config: Dict[str, Any] = req.app.state.ingress_runtime_config
    ingress_paths = runtime_config.get("defaultIngressPaths") or settings.ingress_default_paths

    path_checks = []
    for path in ingress_paths:
        exists = os.path.exists(path)
        path_checks.append({
            "path": path,
            "exists": exists,
            "readable": os.access(path, os.R_OK) if exists else False,
        })

    dest_base = settings.jellyfin_dest_base
    dest_exists = os.path.exists(dest_base)

    return {
        "success": True,
        "data": {
            "ingress_paths": path_checks,
            "destination": {
                "path": dest_base,
                "exists": dest_exists,
                "writable": os.access(dest_base, os.W_OK) if dest_exists else False,
            },
            "healthy": all(c["exists"] and c["readable"] for c in path_checks),
        },
        "timestamp": str(int(time.time())),
    }


@router.post("/queue/add-files")
async def add_files_to_queue(payload: AddFilesRequest, req: Request):
    """Manually add existing files to the ingress queue for processing."""
    queue_service = req.app.state.ingress_queue_service

    added = []
    skipped = []
    errors = []

    for file_path in payload.filePaths:
        if not os.path.isfile(file_path):
            errors.append({"path": file_path, "reason": "File not found"})
            continue
        try:
            item = queue_service.add_manual_file(file_path, priority=payload.priority)
            added.append({"file_path": file_path, "item_id": item.id, "status": item.status})
        except Exception as exc:
            errors.append({"path": file_path, "reason": str(exc)})

    return {
        "success": True,
        "data": {"added": added, "skipped": skipped, "errors": errors},
        "timestamp": str(int(time.time())),
    }


@router.get("/history")
async def get_ingress_processing_history(
    req: Request,
    limit: int = Query(default=100, ge=1, le=500),
):
    queue_service = req.app.state.ingress_queue_service
    history = queue_service.get_processing_history(limit=limit)

    return {
        "success": True,
        "data": {
            "items": history,
            "count": len(history),
        },
        "timestamp": str(int(time.time())),
    }


@router.get("/config")
async def get_ingress_config(req: Request):
    runtime_config: Dict[str, Any] = req.app.state.ingress_runtime_config
    return {
        "success": True,
        "data": runtime_config,
        "timestamp": str(int(time.time())),
    }


@router.put("/config")
async def update_ingress_config(payload: UpdateConfigRequest, req: Request):
    """Update runtime ingress config and persist to Firestore."""
    runtime_config: Dict[str, Any] = req.app.state.ingress_runtime_config
    queue_service = req.app.state.ingress_queue_service
    firestore_service = req.app.state.firestore_service

    if payload.autoAssignThreshold is not None:
        runtime_config["autoAssignThreshold"] = payload.autoAssignThreshold
        if queue_service:
            queue_service.auto_assign_threshold = payload.autoAssignThreshold

    if payload.autoOrganizeEnabled is not None:
        runtime_config["autoOrganizeEnabled"] = payload.autoOrganizeEnabled

    if payload.autoProcessEnabled is not None:
        runtime_config["autoProcessEnabled"] = payload.autoProcessEnabled

    if payload.defaultIngressPaths is not None:
        runtime_config["defaultIngressPaths"] = payload.defaultIngressPaths

    try:
        await firestore_service.save_ingress_config(runtime_config)
    except Exception as exc:
        logger.warning("Failed to persist ingress config", error=str(exc))

    return {
        "success": True,
        "data": runtime_config,
        "timestamp": str(int(time.time())),
    }
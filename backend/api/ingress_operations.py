"""Ingress automation API router.

Provides endpoints for controlling the file watcher and processing queue used
by the automated encoded-media ingress pipeline.
"""

import time
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from utils.exceptions import ScanOperationError
from utils.logging import logger

router = APIRouter()


class StartWatcherRequest(BaseModel):
    ingressPaths: List[str] = Field(default_factory=list)
    usePolling: Optional[bool] = None
    recursive: Optional[bool] = None


class QueueRetryRequest(BaseModel):
    itemId: str


class QueueFailRequest(BaseModel):
    itemId: str
    reason: str


@router.post("/watcher/start")
async def start_ingress_watcher(payload: StartWatcherRequest, req: Request):
    """Start monitoring ingress paths for new encoded files."""
    watcher_service = req.app.state.file_watcher_service

    try:
        status = watcher_service.start_watching(
            ingress_paths=payload.ingressPaths,
            use_polling=payload.usePolling,
            recursive=payload.recursive,
        )
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
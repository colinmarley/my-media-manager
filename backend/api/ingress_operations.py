"""Ingress automation API router.

Provides endpoints for controlling the file watcher and processing queue used
by the automated encoded-media ingress pipeline.
"""

import time
from typing import Any, Dict, List, Optional
import os
import threading
from datetime import datetime
import requests

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from db.database import get_db
from db.models import Movie, Series
from services.metadata_enrichment_service import metadata_enrichment_service
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


class QueueClassificationUpdateRequest(BaseModel):
    itemId: str
    classification: str = Field(default="auto")


class ProcessPendingRequest(BaseModel):
    maxItems: int = Field(default=25, ge=1, le=500)


class UpdateConfigRequest(BaseModel):
    autoAssignThreshold: Optional[int] = Field(default=None, ge=0, le=100)
    autoOrganizeEnabled: Optional[bool] = None
    autoProcessEnabled: Optional[bool] = None
    defaultIngressPaths: Optional[List[str]] = None
    jellyfinDestBase: Optional[str] = None
    defaultMetadataSource: Optional[str] = None
    fileStabilityWaitSeconds: Optional[int] = Field(default=None, ge=1)
    debounceSeconds: Optional[int] = Field(default=None, ge=0)
    autoProcessIntervalSeconds: Optional[int] = Field(default=None, ge=1)


class AddFilesRequest(BaseModel):
    filePaths: List[str]
    priority: int = Field(default=5, ge=1, le=10)


class QueueManualAssignRequest(BaseModel):
    itemId: str
    mediaType: str = Field(default="movie")
    title: str
    year: Optional[int] = None
    source: str = Field(default="manual")
    imdbId: Optional[str] = None
    mediaId: Optional[str] = None
    firebaseMediaId: Optional[str] = None
    rawData: Optional[Dict[str, Any]] = None
    posterUrl: Optional[str] = None
    season: Optional[int] = None
    episode: Optional[int] = None
    unknownEpisode: bool = False
    organizeNow: bool = False


class QueueResetToEncodedRequest(BaseModel):
    itemId: str


def _raw_has_poster(raw_data: Dict[str, Any]) -> bool:
    """Return True when raw metadata includes a usable poster URL."""
    return metadata_enrichment_service.has_poster(raw_data)


def _raw_has_omdb_details(raw_data: Dict[str, Any]) -> bool:
    """Return True when raw metadata appears to contain full OMDB fields."""
    return metadata_enrichment_service.has_omdb_details(raw_data)


def _fetch_omdb_metadata(imdb_id: Optional[str], title: str, year: Optional[int]) -> Optional[Dict[str, Any]]:
    """Fetch full OMDB payload for manual assignment enrichment."""
    return metadata_enrichment_service.fetch_omdb_metadata(imdb_id, title, year)


def _build_reset_move_pairs(assignment: Dict[str, Any]) -> List[Dict[str, str]]:
    """Extract source/destination move pairs from organization result operations."""
    organization_result = assignment.get("organizationResult") or {}
    operations = organization_result.get("operations") or []

    move_pairs: List[Dict[str, str]] = []
    for op in operations:
        destination = op.get("destination")
        source = op.get("source")
        if destination and source:
            move_pairs.append({"from": destination, "to": source})

    return move_pairs


def _apply_reset_move_pairs(
    file_manager: Any,
    move_pairs: List[Dict[str, str]],
) -> Dict[str, Any]:
    """Move files from organized destinations back to encoded source locations."""
    reset_results: List[Dict[str, Any]] = []
    failures: List[str] = []

    for pair in move_pairs:
        source_path = pair["from"]
        destination_path = pair["to"]
        try:
            if not os.path.exists(source_path):
                failures.append(f"Missing organized file: {source_path}")
                reset_results.append({
                    "source": source_path,
                    "destination": destination_path,
                    "success": False,
                    "error": "Organized file not found",
                })
                continue

            file_manager.move_file(source_path, destination_path, merge_contents=False)
            reset_results.append({
                "source": source_path,
                "destination": destination_path,
                "success": True,
            })
        except Exception as exc:
            failures.append(str(exc))
            reset_results.append({
                "source": source_path,
                "destination": destination_path,
                "success": False,
                "error": str(exc),
            })

    return {
        "move_pairs": move_pairs,
        "reset_results": reset_results,
        "failures": failures,
    }


def _queue_existing_files_background(
    watcher_service: Any,
    queue_service: Any,
    ingress_paths: List[str],
    recursive: bool,
) -> None:
    """Queue existing files without blocking the API request/response cycle."""
    supported_extensions = {
        ext.lower() for ext in getattr(watcher_service, "supported_extensions", set())
    }

    watcher_service.begin_initial_queue_scan()
    try:
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
                        try:
                            item = queue_service.add_manual_file(file_path, ingress_path=ingress_path)
                            watcher_service.update_initial_queue_scan(
                                scanned_increment=1,
                                queued_increment=1 if item else 0,
                                last_file=file_path,
                            )
                        except Exception as exc:
                            watcher_service.update_initial_queue_scan(
                                scanned_increment=1,
                                last_file=file_path,
                                last_error=str(exc),
                            )
                            logger.warning(
                                "Failed to queue existing ingress file",
                                file_path=file_path,
                                error=str(exc),
                            )
            else:
                for name in os.listdir(ingress_path):
                    file_path = os.path.join(ingress_path, name)
                    if not os.path.isfile(file_path):
                        continue

                    ext = os.path.splitext(name)[1].lower()
                    if supported_extensions and ext not in supported_extensions:
                        continue

                    try:
                        item = queue_service.add_manual_file(file_path, ingress_path=ingress_path)
                        watcher_service.update_initial_queue_scan(
                            scanned_increment=1,
                            queued_increment=1 if item else 0,
                            last_file=file_path,
                        )
                    except Exception as exc:
                        watcher_service.update_initial_queue_scan(
                            scanned_increment=1,
                            last_file=file_path,
                            last_error=str(exc),
                        )
                        logger.warning(
                            "Failed to queue existing ingress file",
                            file_path=file_path,
                            error=str(exc),
                        )

        watcher_service.finish_initial_queue_scan()
    except Exception as exc:
        logger.error("Background queueing of existing ingress files failed", error=str(exc))
        watcher_service.finish_initial_queue_scan(error=str(exc))


@router.post("/watcher/start")
async def start_ingress_watcher(payload: StartWatcherRequest, req: Request):
    """Start monitoring ingress paths for new encoded files."""
    watcher_service = req.app.state.file_watcher_service
    queue_service = req.app.state.ingress_queue_service

    try:
        ingress_paths = payload.ingressPaths or settings.ingress_default_paths
        recursive = (
            payload.recursive
            if payload.recursive is not None
            else settings.ingress_watch_recursive
        )

        status = watcher_service.start_watching(
            ingress_paths=ingress_paths,
            use_polling=payload.usePolling,
            recursive=payload.recursive,
        )

        if payload.processExistingFiles:
            background_thread = threading.Thread(
                target=_queue_existing_files_background,
                kwargs={
                    "watcher_service": watcher_service,
                    "queue_service": queue_service,
                    "ingress_paths": ingress_paths,
                    "recursive": recursive,
                },
                name="ingress-existing-file-queue",
                daemon=True,
            )
            background_thread.start()
            status = watcher_service.get_status()

        status["process_existing_started"] = payload.processExistingFiles
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


@router.post("/queue/update-classification")
async def update_ingress_item_classification(payload: QueueClassificationUpdateRequest, req: Request):
    queue_service = req.app.state.ingress_queue_service

    try:
        queue_item = await queue_service.update_classification(payload.itemId, payload.classification)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={
            "type": "ValidationError",
            "message": str(exc),
            "code": "INVALID_CLASSIFICATION_OVERRIDE",
        })

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


@router.post("/queue/manual-assign")
async def manual_assign_ingress_item(
    payload: QueueManualAssignRequest,
    req: Request,
    db: AsyncSession = Depends(get_db),
):
    """Manually assign an ingress queue item to explicit media and optional S/E mapping."""
    queue_service = req.app.state.ingress_queue_service

    raw_data: Dict[str, Any] = dict(payload.rawData or {})
    if payload.source == "catalog" and payload.mediaId:
        model = Series if payload.mediaType in ("episode", "series") else Movie
        result = await db.execute(select(model).where(model.id == payload.mediaId).limit(1))
        row = result.scalar_one_or_none()
        if row is not None:
            catalog_raw = dict(row.raw_data or {})
            if catalog_raw:
                # Prefer richer catalog metadata for manual assignment so downstream
                # organization can preserve poster and external metadata.
                raw_data = catalog_raw

            if payload.imdbId is None:
                payload.imdbId = getattr(row, "imdb_id", None)

    if payload.source == "omdb" and not raw_data:
        raw_data = {
            "Title": payload.title,
            "Year": str(payload.year) if payload.year is not None else "",
            "imdbID": payload.imdbId,
            "Poster": payload.posterUrl,
            "Type": "series" if payload.mediaType in ("episode", "series") else "movie",
        }

    raw_data = metadata_enrichment_service.enrich_payload(
        source=payload.source,
        media_type=payload.mediaType,
        title=payload.title,
        year=payload.year,
        imdb_id=payload.imdbId,
        tmdb_id=payload.mediaId if payload.source == "tmdb" else None,
        raw_data=raw_data,
    )

    enriched_external_ids = raw_data.get("externalIds") if isinstance(raw_data.get("externalIds"), dict) else {}
    canonical_title = (
        raw_data.get("title")
        or (raw_data.get("omdbData") or {}).get("Title")
        or (raw_data.get("tmdbData") or {}).get("title")
        or (raw_data.get("tmdbData") or {}).get("name")
        or payload.title
    )
    canonical_year = raw_data.get("year") if isinstance(raw_data.get("year"), int) else payload.year
    canonical_imdb_id = payload.imdbId or enriched_external_ids.get("imdbId")

    match_payload = {
        "source": payload.source,
        "title": canonical_title,
        "year": canonical_year,
        "media_type": payload.mediaType,
        "imdb_id": canonical_imdb_id,
        "media_id": payload.mediaId,
        "firebase_media_id": payload.firebaseMediaId,
        "season": None if payload.unknownEpisode else payload.season,
        "episode": None if payload.unknownEpisode else payload.episode,
        "unknown_episode": payload.unknownEpisode,
        "raw_data": raw_data,
    }

    queue_item = await queue_service.manual_assign_item(
        payload.itemId,
        match_payload,
        organize_now=payload.organizeNow,
    )
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


@router.post("/queue/reset-to-encoded")
async def reset_ingress_item_to_encoded(payload: QueueResetToEncodedRequest, req: Request):
    """Move organized files for a queue item back to encoded source paths for retesting."""
    queue_service = req.app.state.ingress_queue_service
    auto_matcher_service = req.app.state.auto_matcher_service
    firestore_service = req.app.state.firestore_service
    file_manager = req.app.state.file_manager

    with queue_service.lock:
        queue_item = queue_service.items_by_id.get(payload.itemId)
        if queue_item is None:
            raise HTTPException(status_code=404, detail={
                "type": "NotFoundError",
                "message": f"Queue item not found: {payload.itemId}",
                "code": "QUEUE_ITEM_NOT_FOUND",
            })

    if not queue_item.assignment_id:
        raise HTTPException(status_code=400, detail={
            "type": "ValidationError",
            "message": "Queue item has no assignment to reset",
            "code": "ASSIGNMENT_NOT_FOUND",
        })

    assignment_ref = firestore_service.db.collection("media_assignments").document(queue_item.assignment_id)
    assignment_doc = assignment_ref.get()
    if not assignment_doc.exists:
        raise HTTPException(status_code=404, detail={
            "type": "NotFoundError",
            "message": f"Assignment not found: {queue_item.assignment_id}",
            "code": "ASSIGNMENT_NOT_FOUND",
        })

    assignment = assignment_doc.to_dict() or {}
    move_pairs = _build_reset_move_pairs(assignment)

    if not move_pairs:
        raise HTTPException(status_code=400, detail={
            "type": "ValidationError",
            "message": "No organized file operations were found for this assignment",
            "code": "NO_MOVED_FILES",
        })

    reset_result = _apply_reset_move_pairs(file_manager, move_pairs)
    reset_results = reset_result["reset_results"]
    failures = reset_result["failures"]

    # Update assignment status after reset attempt.
    assignment_ref.update({
        "organizationStatus": "pending" if len(failures) == 0 else "failed",
        "isOrganized": False,
        "targetPath": None,
        "updatedAt": time.time(),
        "resetResult": {
            "attemptedAt": datetime.utcnow().isoformat(),
            "filesAttempted": len(move_pairs),
            "filesReset": sum(1 for r in reset_results if r.get("success")),
            "errors": failures,
            "operations": reset_results,
        },
    })

    media_id = assignment.get("mediaId")
    media_type = assignment.get("mediaType")
    media_collection = "movies" if media_type == "movie" else "series"
    if media_id:
        firestore_service.db.collection(media_collection).document(media_id).set({
            "folderPath": None,
            "fileCount": 0,
            "isOrganized": False,
            "updatedAt": datetime.utcnow().isoformat(),
            "jellyfinInfo": {
                "folderPath": None,
                "folderName": None,
                "isOrganized": False,
                "lastOrganized": None,
            },
        }, merge=True)

    with queue_service.lock:
        queue_item.status = "needs_review"
        queue_item.last_error = None if len(failures) == 0 else "; ".join(failures)
        queue_item.processed_at = None

    await queue_service._persist_queue_item(queue_item)

    return {
        "success": len(failures) == 0,
        "data": {
            "item": queue_item.to_dict(),
            "assignmentId": queue_item.assignment_id,
            "filesAttempted": len(move_pairs),
            "filesReset": sum(1 for r in reset_results if r.get("success")),
            "errors": failures,
        },
        "timestamp": str(int(time.time())),
    }


@router.post("/queue/reset-completed-to-encoded")
async def reset_completed_items_to_encoded(req: Request):
    """Reset all completed organized queue items back to encoded paths."""
    queue_service = req.app.state.ingress_queue_service
    firestore_service = req.app.state.firestore_service
    file_manager = req.app.state.file_manager

    with queue_service.lock:
        candidate_items = [
            item
            for item in queue_service.items_by_id.values()
            if item.status == "completed" and item.assignment_id
        ]

    if not candidate_items:
        return {
            "success": True,
            "data": {
                "itemsAttempted": 0,
                "itemsReset": 0,
                "filesAttempted": 0,
                "filesReset": 0,
                "errors": [],
            },
            "timestamp": str(int(time.time())),
        }

    items_reset = 0
    files_attempted = 0
    files_reset = 0
    errors: List[str] = []

    for queue_item in candidate_items:
        assignment_ref = firestore_service.db.collection("media_assignments").document(queue_item.assignment_id)
        assignment_doc = assignment_ref.get()
        if not assignment_doc.exists:
            errors.append(f"Assignment not found: {queue_item.assignment_id}")
            continue

        assignment = assignment_doc.to_dict() or {}
        move_pairs = _build_reset_move_pairs(assignment)
        if not move_pairs:
            errors.append(f"No moved files found for assignment: {queue_item.assignment_id}")
            continue

        files_attempted += len(move_pairs)

        reset_result = _apply_reset_move_pairs(file_manager, move_pairs)
        reset_results = reset_result["reset_results"]
        failures = reset_result["failures"]
        files_reset += sum(1 for r in reset_results if r.get("success"))

        assignment_ref.update({
            "organizationStatus": "pending" if len(failures) == 0 else "failed",
            "isOrganized": False,
            "targetPath": None,
            "updatedAt": time.time(),
            "resetResult": {
                "attemptedAt": datetime.utcnow().isoformat(),
                "filesAttempted": len(move_pairs),
                "filesReset": sum(1 for r in reset_results if r.get("success")),
                "errors": failures,
                "operations": reset_results,
            },
        })

        media_id = assignment.get("mediaId")
        media_type = assignment.get("mediaType")
        media_collection = "movies" if media_type == "movie" else "series"
        if media_id:
            firestore_service.db.collection(media_collection).document(media_id).set({
                "folderPath": None,
                "fileCount": 0,
                "isOrganized": False,
                "updatedAt": datetime.utcnow().isoformat(),
                "jellyfinInfo": {
                    "folderPath": None,
                    "folderName": None,
                    "isOrganized": False,
                    "lastOrganized": None,
                },
            }, merge=True)

        with queue_service.lock:
            queue_item.status = "needs_review"
            queue_item.last_error = None if len(failures) == 0 else "; ".join(failures)
            queue_item.processed_at = None

        await queue_service._persist_queue_item(queue_item)

        if len(failures) == 0:
            items_reset += 1
        else:
            errors.extend(failures)

    return {
        "success": len(errors) == 0,
        "data": {
            "itemsAttempted": len(candidate_items),
            "itemsReset": items_reset,
            "filesAttempted": files_attempted,
            "filesReset": files_reset,
            "errors": errors,
        },
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
    """Check accessibility of ingress, destination, and NAS typed-subfolder paths."""
    import socket

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

    # NAS connectivity check (TCP port 445 / CIFS)
    nas_host = settings.nas_host
    nas_reachable = False
    if nas_host:
        try:
            with socket.create_connection((nas_host, 445), timeout=2):
                nas_reachable = True
        except OSError:
            nas_reachable = False

    # Check each typed destination subfolder
    typed_folders = [
        settings.folder_movies,
        settings.folder_tv_shows,
        settings.folder_documentaries,
        settings.folder_live_performances,
        settings.folder_needs_review,
    ]
    subfolder_checks = []
    for folder in typed_folders:
        folder_path = os.path.join(dest_base, folder)
        exists = os.path.exists(folder_path)
        subfolder_checks.append({
            "name": folder,
            "path": folder_path,
            "exists": exists,
            "writable": os.access(folder_path, os.W_OK) if exists else False,
        })

    overall_healthy = (
        all(c["exists"] and c["readable"] for c in path_checks)
        and dest_exists
    )

    return {
        "success": True,
        "data": {
            "ingress_paths": path_checks,
            "destination": {
                "path": dest_base,
                "exists": dest_exists,
                "writable": os.access(dest_base, os.W_OK) if dest_exists else False,
            },
            "nas": {
                "host": nas_host,
                "reachable": nas_reachable,
            },
            "typed_folders": subfolder_checks,
            "healthy": overall_healthy,
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
            if item is None:
                skipped.append({"path": file_path, "reason": "Only video files are queued for matching"})
                continue
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
    history = await queue_service.get_processing_history_persisted(limit=limit)

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
    auto_matcher_service = getattr(req.app.state, "auto_matcher_service", None)
    firestore_service = getattr(req.app.state, "firestore_service", None)

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

    if payload.jellyfinDestBase is not None:
        runtime_config["jellyfinDestBase"] = payload.jellyfinDestBase
        file_org_service = getattr(req.app.state, "file_organization_service", None)
        if file_org_service is not None:
            file_org_service.jellyfin_dest_base = payload.jellyfinDestBase.rstrip("/")

    if payload.defaultMetadataSource is not None:
        runtime_config["defaultMetadataSource"] = payload.defaultMetadataSource
        if auto_matcher_service and hasattr(auto_matcher_service, "set_metadata_source"):
            auto_matcher_service.set_metadata_source(payload.defaultMetadataSource)

    if payload.fileStabilityWaitSeconds is not None:
        runtime_config["fileStabilityWaitSeconds"] = payload.fileStabilityWaitSeconds

    if payload.debounceSeconds is not None:
        runtime_config["debounceSeconds"] = payload.debounceSeconds

    if payload.autoProcessIntervalSeconds is not None:
        runtime_config["autoProcessIntervalSeconds"] = payload.autoProcessIntervalSeconds

    if firestore_service is not None:
        try:
            await firestore_service.save_ingress_config(runtime_config)
        except Exception as exc:
            logger.warning("Failed to persist ingress config", error=str(exc))

    return {
        "success": True,
        "data": runtime_config,
        "timestamp": str(int(time.time())),
    }
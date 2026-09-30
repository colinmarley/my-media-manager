"""
Disc ripper status proxy
========================
Read-only view of disc-ripper-service's jobs for the mobile app, so the
phone only ever talks to this one backend (one configured host, one auth
token) instead of also reaching the ripper's own port.

  GET /api/ripper/jobs?limit=&catalogDiscId=   recent jobs, newest first

Starting or stopping rips stays in the web app's Disc Ripper page — a rip
needs the physical disc in the drive and a title-selection step that
doesn't fit a phone.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from api.mobile_auth import require_any_auth
from config.settings import settings

router = APIRouter(prefix="/api/ripper", tags=["Disc Ripper"])

_TIMEOUT = 10.0
ACTIVE_STATUSES = {"queued", "ripping", "encoding", "delivering"}


def summarize_job(job: dict) -> dict:
    """The fields the app shows — drops rip_dir/episode maps/full paths."""
    return {
        "id": job.get("id"),
        "title": job.get("title"),
        "year": job.get("year"),
        "season": job.get("season"),
        "mediaType": job.get("media_type"),
        "discType": job.get("disc_type"),
        "status": job.get("status"),
        "active": job.get("status") in ACTIVE_STATUSES,
        "progress": job.get("progress") or 0.0,
        "error": job.get("error"),
        "catalogDiscId": job.get("catalog_disc_id"),
        "fileCount": len(job.get("output_paths") or []),
        "createdAt": job.get("created_at"),
        "updatedAt": job.get("updated_at"),
    }


@router.get("/jobs", dependencies=[Depends(require_any_auth)])
async def list_ripper_jobs(
    limit: int = Query(default=20, ge=1, le=200),
    catalog_disc_id: str | None = Query(default=None, alias="catalogDiscId"),
) -> dict:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.get(f"{settings.disc_ripper_url.rstrip('/')}/jobs")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        # The ripper is a separate service that isn't always running; the
        # app shows this as "ripper offline" rather than an error screen.
        raise HTTPException(status_code=503, detail="Disc ripper is not reachable.") from exc

    jobs = [summarize_job(j) for j in response.json() if isinstance(j, dict)]
    if catalog_disc_id:
        jobs = [j for j in jobs if j["catalogDiscId"] == catalog_disc_id]
    jobs.sort(key=lambda j: j["createdAt"] or "", reverse=True)
    return {"jobs": jobs[:limit], "activeCount": sum(1 for j in jobs if j["active"])}

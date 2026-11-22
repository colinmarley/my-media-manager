"""
Rip records
===========
What disc-ripper-service knew when it ripped a disc: the catalogued disc, the
disc's own identity (volume label, fingerprint), every title on it, and for
each delivered file the title it came from and what it was declared to be.

  PUT  /api/rips/{job_id}            store a rip report (called by the ripper)
  GET  /api/rips                     recent rips; ?discId= / ?fingerprint=
  GET  /api/rips/{job_id}            one rip with its files and scan titles
  POST /api/rips/import-manifests    store manifests found in the ingest roots

The ripper calls PUT twice per job: once before it moves any file (status
``delivering``, so the files are expected when the watcher sees them) and
once after (``delivered`` / ``partial``). It is idempotent on the job id.

PUT carries no auth, like ``POST /api/catalog/discs`` and ``/link-source``:
the ripper is a LAN service without a session.
"""

import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.mobile_auth import require_any_auth
from db.database import get_db
from db.models import DiscRip, DiscRipTitle
from services import rip_records
from services.rip_records import RipRecord
from utils.logging import logger

router = APIRouter(prefix="/api/rips", tags=["Disc Rips"])


def _queue(request: Request) -> Any:
    return getattr(request.app.state, "ingress_queue_service", None)


async def _titles(db: AsyncSession, rip_id: str) -> list[DiscRipTitle]:
    rows = (await db.execute(select(DiscRipTitle).where(DiscRipTitle.rip_id == rip_id))).scalars().all()
    return sorted(rows, key=lambda r: (r.title_index, r.file_seq))


@router.post("/import-manifests", dependencies=[Depends(require_any_auth)])
async def import_manifests(db: AsyncSession = Depends(get_db)) -> dict:
    """Store every ``_rip_manifest.*.json`` in the ingest roots. For rips whose
    push never arrived (the library was down while the ripper delivered)."""
    summary = await rip_records.import_manifests(db)
    await db.commit()
    return summary


@router.put("/{job_id}")
async def put_rip(job_id: str, record: RipRecord, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    if record.job_id != job_id:
        raise HTTPException(status_code=400, detail="job_id in the body does not match the URL")

    result = await rip_records.upsert_rip(db, record)
    await db.commit()

    # A rip may deliver to a path the queue once closed as ignored (the file
    # that was there has since been organized). Announced paths are let
    # through when the watcher sees them; files already there are queued now.
    queue = _queue(request)
    requeued = 0
    if queue is not None:
        if result.expected:
            queue.expect_rip_paths(result.expected)
        for path in result.newly_delivered:
            if os.path.isfile(path) and queue.requeue_ripped_file(path) is not None:
                requeued += 1

    logger.info(
        "Rip record stored", rip_id=job_id, status=record.status, created=result.created,
        disc_found=result.disc_found, linked_files=result.linked_files,
        expected=len(result.expected), requeued=requeued,
    )
    return {
        "id": job_id,
        "status": result.rip.status,
        "created": result.created,
        "discFound": result.disc_found,
        "linkedFiles": result.linked_files,
        "expectedPaths": len(result.expected),
        "requeued": requeued,
    }


@router.get("", dependencies=[Depends(require_any_auth)])
async def list_rips(
    disc_id: str | None = Query(default=None, alias="discId"),
    fingerprint: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Recent rips, newest first. ``fingerprint`` answers "has this disc been
    ripped before?" for a disc that is in the drive now."""
    stmt = select(DiscRip)
    if disc_id:
        stmt = stmt.where(DiscRip.disc_id == disc_id)
    if fingerprint:
        stmt = stmt.where(DiscRip.fingerprint == fingerprint)
    rows = (await db.execute(stmt)).scalars().all()
    rows = sorted(rows, key=lambda r: (r.created_at is not None, r.created_at), reverse=True)[:limit]
    return [rip_records.rip_to_dict(r) for r in rows]


@router.get("/{job_id}", dependencies=[Depends(require_any_auth)])
async def get_rip(job_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    rip = (await db.execute(select(DiscRip).where(DiscRip.id == job_id))).scalar_one_or_none()
    if rip is None:
        raise HTTPException(status_code=404, detail="Rip not found")
    return rip_records.rip_to_dict(rip, await _titles(db, job_id), full=True)

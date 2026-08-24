"""
Tape Ingest Settings API
========================
GET  /api/settings/tape-ingest   — return current settings (DB overrides merged with defaults)
PATCH /api/settings/tape-ingest  — persist overrides to the app_config table
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from api.auth import require_session
from db.database import get_db
from db.models import AppConfig
from config.settings import settings

router = APIRouter(prefix="/api/settings", tags=["Settings"])

FFMPEG_PRESETS = [
    "ultrafast", "superfast", "veryfast", "faster",
    "fast", "medium", "slow", "slower", "veryslow",
]

_CFG_KEY = "tape_ingest_settings"


class TapeIngestSettings(BaseModel):
    ingress_folder: str = Field(default="", description="Default source folder shown on scan step")
    destination_base: str = Field(default="", description="Default NAS destination base path")
    ffmpeg_crf: int = Field(default=20, ge=0, le=51)
    ffmpeg_preset: str = Field(default="medium")


async def _load(db: AsyncSession) -> dict:
    result = await db.execute(select(AppConfig).where(AppConfig.key == _CFG_KEY))
    row = result.scalar_one_or_none()
    if row:
        import json
        try:
            return json.loads(row.value)
        except Exception:
            pass
    return {}


async def _save(db: AsyncSession, data: dict) -> None:
    import json
    result = await db.execute(select(AppConfig).where(AppConfig.key == _CFG_KEY))
    row = result.scalar_one_or_none()
    serialized = json.dumps(data)
    if row:
        row.value = serialized
    else:
        db.add(AppConfig(key=_CFG_KEY, value=serialized))
    await db.commit()


@router.get("/tape-ingest", response_model=TapeIngestSettings)
async def get_tape_ingest_settings(db: AsyncSession = Depends(get_db)):
    """Return tape ingest settings, merging DB overrides with configured defaults."""
    overrides = await _load(db)
    return TapeIngestSettings(
        ingress_folder=overrides.get("ingress_folder", settings.tape_ingest_ingress_folder),
        destination_base=overrides.get("destination_base", settings.tape_ingest_default_destination),
        ffmpeg_crf=overrides.get("ffmpeg_crf", settings.tape_ingest_ffmpeg_crf),
        ffmpeg_preset=overrides.get("ffmpeg_preset", settings.tape_ingest_ffmpeg_preset),
    )


@router.patch("/tape-ingest", response_model=TapeIngestSettings)
async def patch_tape_ingest_settings(
    patch: TapeIngestSettings,
    db: AsyncSession = Depends(get_db),
):
    """Persist tape ingest setting overrides."""
    if patch.ffmpeg_preset not in FFMPEG_PRESETS:
        raise HTTPException(
            status_code=422,
            detail=f"ffmpeg_preset must be one of: {FFMPEG_PRESETS}",
        )
    await _save(db, patch.model_dump())

    # Update in-memory settings for the current process lifetime
    settings.tape_ingest_ingress_folder = patch.ingress_folder
    settings.tape_ingest_default_destination = patch.destination_base
    settings.tape_ingest_ffmpeg_crf = patch.ffmpeg_crf
    settings.tape_ingest_ffmpeg_preset = patch.ffmpeg_preset

    return patch

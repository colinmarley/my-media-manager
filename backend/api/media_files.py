"""
Every file of a library title, with its technical metadata and source disc / tape.

- ``GET /api/catalog/media/{media_type}/{media_id}/detail`` —
  ``{record, mediaType, catalogType, discs, tapes, files, summary}``: the
  catalog record (same shape as ``GET /api/catalog/movies/{id}`` /
  ``series/{id}``), its discs and tapes (same as
  ``GET /api/catalog/media/{type}/{id}/discs``), its files grouped, and counts.
- ``GET /api/catalog/media/{media_type}/{media_id}/files`` — the grouped files
  and counts only.

``media_type`` is what the web UI routes with: ``movie`` and ``series``, or a
type it derives from the record (``documentary``, ``live_performance``,
``home_video``, ``needs_review``; all rows of ``movies`` / ``series``).
``media_id`` is the record id or an IMDb id. The record is found the way the
detail page finds it (``useMediaDetailRecord``): the first movie, then series,
whose id or IMDb id matches and whose derived type is ``media_type``.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import catalog as catalog_api
from api.mobile_auth import require_any_auth
from db.database import get_db
from db.models import Disc, MediaFile, Movie, Series, Tape

router = APIRouter(
    prefix="/api/catalog",
    tags=["Catalog"],
    dependencies=[Depends(require_any_auth)],
)

ROUTE_TYPES = ("movie", "series", "documentary", "live_performance", "home_video", "needs_review")
_SERIES_ALIASES = ("episode", "tv")
MOVIE_ASSIGNED_TYPES = ("movie", "documentary", "live_performance", "home_video")
SERIES_ASSIGNED_TYPES = ("episode", "series", "tv")


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def _string(obj: Dict[str, Any], key: str) -> Optional[str]:
    value = obj.get(key)
    return value if isinstance(value, str) else None


def derive_media_type(record: Dict[str, Any]) -> str:
    """Port of the web UI's ``getMediaType`` (libraryHelpers.ts) over a catalog record."""
    explicit = _string(record, "mediaType")
    if explicit in ("series", "episode", "tv"):
        return "series"
    sub_type = _string(record, "mediaSubType") or _string(record, "subType")
    if sub_type in ("documentary", "live_performance", "home_video"):
        return sub_type

    def from_folder(folder: Optional[str]) -> Optional[str]:
        if not folder:
            return None
        normalised = folder.replace("\\", "/")
        if "_NeedsReview" in normalised:
            return "needs_review"
        if "Documentaries/" in normalised:
            return "documentary"
        if "Live Performances/" in normalised:
            return "live_performance"
        if "Home Videos/" in normalised:
            return "home_video"
        if "/TV Shows/" in normalised or "/Shows/" in normalised:
            return "series"
        return None

    direct = from_folder(_string(record, "folderPath"))
    if direct:
        return direct
    jellyfin = record.get("jellyfinInfo")
    if isinstance(jellyfin, dict):
        derived = from_folder(_string(jellyfin, "folderPath"))
        if derived:
            return derived
    return "series" if isinstance(record.get("seasons"), list) else "movie"


def record_matches(record: Dict[str, Any], media_id: str) -> bool:
    """``useMediaDetailRecord``'s id test: the record id or any of its IMDb id fields."""
    external = record.get("externalIds") if isinstance(record.get("externalIds"), dict) else {}
    return media_id in (
        record.get("id"),
        _string(external, "imdbId"),
        _string(record, "imdbID"),
        _string(record, "imdbId"),
    )


def pick_record(
    candidates: List[Tuple[str, Any, Dict[str, Any]]],
    route_type: str,
    media_id: str,
) -> Optional[Tuple[str, Any, Dict[str, Any]]]:
    """The candidate the detail page would show: ``(table kind, row, record)``.

    ``candidates`` are rows whose id or an IMDb id equals ``media_id``, in the
    page's order (movies by title, then series by title). The page's rule
    first: derived type equal to the route type and the id / IMDb field match.
    Then, leniently (the page would show "not found"): a typed match found
    only through the ``imdb_id`` column, then the first candidate from the
    table the route type lives in (``needs_review``: either table).
    """
    typed = [c for c in candidates if derive_media_type(c[2]) == route_type]
    for candidate in typed:
        if record_matches(candidate[2], media_id):
            return candidate
    if typed:
        return typed[0]  # matched by the imdb_id column only
    wanted = {"series": ("series",), "needs_review": ("movie", "series")}.get(route_type, ("movie",))
    for candidate in candidates:
        if candidate[0] in wanted:
            return candidate
    return None


def _sort_name(dto: Dict[str, Any]) -> str:
    return str(dto.get("fileName") or dto.get("filePath") or "").lower()


def group_files(files: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Split file DTOs into ``main`` / ``versions`` / ``extras`` / ``other`` and ``seasons``.

    A file with a season number, or an episode, goes under its season:
    ``{seasonNumber, episodes, extras, other}`` (episodes by number). Seasons
    are ascending, with an unknown season (null) last.
    """
    groups: Dict[str, Any] = {"main": [], "versions": [], "extras": [], "other": [], "seasons": []}
    seasons: Dict[Any, Dict[str, Any]] = {}
    for dto in files:
        role = dto.get("role")
        season = dto.get("seasonNumber")
        if season is not None or role == "episode":
            bucket = seasons.setdefault(
                season, {"seasonNumber": season, "episodes": [], "extras": [], "other": []}
            )
            if role == "episode":
                bucket["episodes"].append(dto)
            elif role == "extra":
                bucket["extras"].append(dto)
            else:
                bucket["other"].append(dto)
            continue
        key = {"main": "main", "version": "versions", "extra": "extras"}.get(role or "", "other")
        groups[key].append(dto)
    for key in ("main", "versions", "extras", "other"):
        groups[key].sort(key=_sort_name)
    for bucket in seasons.values():
        bucket["episodes"].sort(
            key=lambda d: (d.get("episodeNumber") is None, d.get("episodeNumber") or 0, _sort_name(d))
        )
        bucket["extras"].sort(key=_sort_name)
        bucket["other"].sort(key=_sort_name)
    groups["seasons"] = [
        seasons[key] for key in sorted(seasons, key=lambda s: (s is None, s if s is not None else 0))
    ]
    return groups


def summarize_files(files: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "fileCount": len(files),
        "totalSize": sum(int(f.get("fileSize") or 0) for f in files),
        "missingCount": sum(1 for f in files if f.get("isAvailable") is False),
        "unprobedCount": sum(1 for f in files if not f.get("probedAt")),
    }


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def _imdb_match(model: Any, media_id: str):
    return or_(
        model.id == media_id,
        model.imdb_id == media_id,
        model.raw_data["imdbId"].astext == media_id,
        model.raw_data["imdbID"].astext == media_id,
        model.raw_data["externalIds"]["imdbId"].astext == media_id,
    )


async def resolve_record(db: AsyncSession, media_type: str, media_id: str) -> Tuple[str, Any, Dict[str, Any], str]:
    """``(table kind, row, record, route type)`` or 400 / 404."""
    route_type = "series" if media_type in _SERIES_ALIASES else media_type
    if route_type not in ROUTE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"media_type must be one of: {', '.join(ROUTE_TYPES)}",
        )
    candidates: List[Tuple[str, Any, Dict[str, Any]]] = []
    for kind, model in (("movie", Movie), ("series", Series)):
        result = await db.execute(select(model).where(_imdb_match(model, media_id)).order_by(model.title))
        for row in result.scalars().all():
            candidates.append((kind, row, catalog_api._row_to_dict(row)))
    picked = pick_record(candidates, route_type, media_id)
    if picked is None:
        raise HTTPException(status_code=404, detail=f"No {route_type} found for {media_id}")
    kind, row, record = picked
    return kind, row, record, route_type


async def files_for_record(db: AsyncSession, kind: str, row: Any) -> List[Dict[str, Any]]:
    """File DTOs linked to the title: by ``movie_id`` / ``series_id``, plus rows
    not linked yet whose legacy ``assigned_to_id`` names it."""
    ids = [value for value in (row.id, getattr(row, "imdb_id", None)) if value]
    if kind == "series":
        condition = or_(
            MediaFile.series_id == row.id,
            and_(
                MediaFile.series_id.is_(None),
                MediaFile.movie_id.is_(None),
                MediaFile.assigned_to_id.in_(ids),
                MediaFile.assigned_to_type.in_(SERIES_ASSIGNED_TYPES),
            ),
        )
    else:
        condition = or_(
            MediaFile.movie_id == row.id,
            and_(
                MediaFile.movie_id.is_(None),
                MediaFile.series_id.is_(None),
                MediaFile.assigned_to_id.in_(ids),
                MediaFile.assigned_to_type.in_(MOVIE_ASSIGNED_TYPES),
            ),
        )
    result = await db.execute(select(MediaFile).where(condition).order_by(MediaFile.file_path))
    rows = list(result.scalars().all())

    disc_ids = sorted({r.disc_id for r in rows if r.disc_id})
    tape_ids = sorted({r.tape_id for r in rows if r.tape_id})
    discs: Dict[str, Any] = {}
    tapes: Dict[str, Any] = {}
    if disc_ids:
        discs = {d.id: d for d in (await db.execute(select(Disc).where(Disc.id.in_(disc_ids)))).scalars().all()}
    if tape_ids:
        tapes = {t.id: t for t in (await db.execute(select(Tape).where(Tape.id.in_(tape_ids)))).scalars().all()}
    return [
        catalog_api._media_file_to_dict(r, disc=discs.get(r.disc_id), tape=tapes.get(r.tape_id))
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/media/{media_type}/{media_id}/detail")
async def get_media_detail(media_type: str, media_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    kind, row, record, route_type = await resolve_record(db, media_type, media_id)
    files = await files_for_record(db, kind, row)
    links = await catalog_api.discs_and_tapes_for_media(db, kind, row.id)
    return {
        "record": record,
        "mediaType": derive_media_type(record),
        "catalogType": kind,
        "discs": links["discs"],
        "tapes": links["tapes"],
        "files": group_files(files),
        "summary": summarize_files(files),
    }


@router.get("/media/{media_type}/{media_id}/files")
async def get_media_files(media_type: str, media_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    kind, row, record, _ = await resolve_record(db, media_type, media_id)
    files = await files_for_record(db, kind, row)
    return {
        "mediaId": row.id,
        "mediaType": derive_media_type(record),
        "catalogType": kind,
        **group_files(files),
        "summary": summarize_files(files),
    }

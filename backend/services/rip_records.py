"""
Rip records: what disc-ripper-service knew when it ripped a disc.

The ripper sends one payload per rip job (the same JSON it writes next to the
delivered files as ``_rip_manifest.<job8>.json``): the catalogued disc, what
the disc reported about itself, every title on it, and for each output file
the title it came from and what it was declared to be.

``upsert_rip`` stores that as a ``disc_rips`` row plus one ``disc_rip_titles``
row per output file, idempotently on the ripper's job id, and ties each
delivered file's ``media_files`` row to the disc and release. Declarations
(season / episode / content type) stay on the rip-title row: the matching
columns on ``media_files`` are placement fields recomputed from the path.
"""

from __future__ import annotations

import asyncio
import glob
import json
import os
import re
import uuid
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from db.models import Disc, DiscMediaLink, DiscRip, DiscRipTitle, Movie, Series
from services import media_file_index, storage_paths
from utils.logging import logger

MANIFEST_GLOB = "_rip_manifest.*.json"
DELIVERED = "delivered"
# Later reports never move a rip backwards (a retried pre-registration must
# not undo a confirmed delivery).
_STATUS_RANK = {"delivering": 0, "failed": 1, "cancelled": 1, "partial": 2, "delivered": 2}


# ── Payload ─────────────────────────────────────────────────────────────────

class _Model(BaseModel):
    model_config = ConfigDict(extra="allow")


class RipCatalog(_Model):
    disc_id: Optional[str] = None
    title: Optional[str] = None
    barcode: Optional[str] = None
    disc_number: Optional[int] = None
    edition: Optional[str] = None
    format: Optional[str] = None
    release_id: Optional[str] = None


class RipIdentity(_Model):
    media_type: Optional[str] = None
    title: Optional[str] = None
    year: Optional[int] = None
    imdb_id: Optional[str] = None
    tmdb_id: Optional[int] = None
    season: Optional[int] = None


class RipDisc(_Model):
    disc_type: Optional[str] = None
    reported_disc_type: Optional[str] = None
    disc_name: Optional[str] = None
    volume_label: Optional[str] = None
    fingerprint: Optional[str] = None
    fingerprint_algo: Optional[str] = None
    drive_model: Optional[str] = None
    makemkv_version: Optional[str] = None


class RipTitlePayload(_Model):
    title_index: int
    file_seq: int = 0
    status: Optional[str] = None
    error: Optional[str] = None
    content_type: Optional[str] = None
    is_main_feature: Optional[bool] = None
    season: Optional[int] = None
    episode: Optional[int] = None
    episode_end: Optional[int] = None
    tmdb_episode_id: Optional[int] = None
    episode_name: Optional[str] = None
    custom_name: Optional[str] = None
    makemkv_filename: Optional[str] = None
    dest_path: Optional[str] = None
    ingest_relative_path: Optional[str] = None
    size_bytes: Optional[int] = None
    sha256: Optional[str] = None
    rip_started_at: Optional[datetime] = None
    rip_finished_at: Optional[datetime] = None
    read_errors: Optional[int] = 0
    messages: Optional[list] = None
    probe: Optional[dict] = None


class RipRecord(_Model):
    schema_version: int = 1
    job_id: str
    status: str
    ripper_host: Optional[str] = None
    rip_started_at: Optional[datetime] = None
    rip_finished_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    catalog: RipCatalog = Field(default_factory=RipCatalog)
    identity: RipIdentity = Field(default_factory=RipIdentity)
    disc: RipDisc = Field(default_factory=RipDisc)
    scan_titles: List[dict] = Field(default_factory=list)
    titles: List[RipTitlePayload] = Field(default_factory=list)


class RipUpsertResult:
    def __init__(self, rip: DiscRip, created: bool):
        self.rip = rip
        self.created = created
        self.newly_delivered: List[str] = []   # paths delivered by this report
        self.expected: List[str] = []          # paths announced but not there yet
        self.linked_files = 0
        self.disc_found = False


# ── Paths ───────────────────────────────────────────────────────────────────

def resolve_path(title: RipTitlePayload) -> Optional[str]:
    """Where this file is as the library sees it.

    The ripper and the library normally mount ingest at the same path; when
    they do not, the path relative to the ingest root still identifies it.
    """
    dest = media_file_index.normalize_path(title.dest_path)
    if dest and storage_paths.is_in_ingest(dest):
        return dest
    root = storage_paths.primary_ingest_root()
    if title.ingest_relative_path and root:
        return media_file_index.normalize_path(storage_paths.join_root(root, title.ingest_relative_path))
    return dest or None


# ── Store ───────────────────────────────────────────────────────────────────

_RIP_FROM_DISC = ("disc_type", "reported_disc_type", "disc_name", "volume_label",
                  "fingerprint", "fingerprint_algo", "drive_model", "makemkv_version")
_RIP_FROM_IDENTITY = ("media_type", "title", "year", "imdb_id", "tmdb_id", "season")
_TITLE_FIELDS = ("status", "error", "content_type", "is_main_feature", "season", "episode",
                 "episode_end", "tmdb_episode_id", "episode_name", "custom_name",
                 "makemkv_filename", "ingest_relative_path", "size_bytes", "sha256",
                 "read_errors", "messages", "probe", "rip_started_at", "rip_finished_at")


async def upsert_rip(db: Any, record: RipRecord) -> RipUpsertResult:
    """Store a rip report. Safe to call again with the same or a later report."""
    rip = (await db.execute(select(DiscRip).where(DiscRip.id == record.job_id))).scalar_one_or_none()
    created = rip is None
    if rip is None:
        rip = DiscRip(id=record.job_id, status=record.status)
        db.add(rip)
    result = RipUpsertResult(rip, created)

    stale = (not created) and _STATUS_RANK.get(record.status, 0) < _STATUS_RANK.get(rip.status, 0)
    if stale:
        # An out-of-order report: keep what the later one said.
        logger.info("Stale rip report ignored", rip_id=rip.id, had=rip.status, got=record.status)
        return result

    disc = None
    if record.catalog.disc_id:
        disc = (await db.execute(select(Disc).where(Disc.id == record.catalog.disc_id))).scalar_one_or_none()
    result.disc_found = disc is not None

    rip.schema_version = record.schema_version
    rip.status = record.status
    rip.disc_id = disc.id if disc is not None else None
    rip.release_id = disc.set_id if disc is not None else None
    for name in _RIP_FROM_IDENTITY:
        setattr(rip, name, getattr(record.identity, name))
    for name in _RIP_FROM_DISC:
        setattr(rip, name, getattr(record.disc, name))
    rip.ripper_host = record.ripper_host
    rip.rip_started_at = record.rip_started_at
    rip.rip_finished_at = record.rip_finished_at
    rip.delivered_at = record.delivered_at
    rip.scan_titles = record.scan_titles
    rip.manifest = record.model_dump(mode="json")

    existing = {
        (row.title_index, row.file_seq): row
        for row in (await db.execute(select(DiscRipTitle).where(DiscRipTitle.rip_id == rip.id))).scalars().all()
    }
    for title in record.titles:
        row = existing.get((title.title_index, title.file_seq))
        was_delivered = row is not None and row.status == DELIVERED
        if row is None:
            row = DiscRipTitle(
                id=str(uuid.uuid4()), rip_id=rip.id,
                title_index=title.title_index, file_seq=title.file_seq,
            )
            db.add(row)
        for name in _TITLE_FIELDS:
            setattr(row, name, getattr(title, name))
        row.duration_seconds = (title.probe or {}).get("duration_seconds")
        path = resolve_path(title)
        row.delivered_path = path

        if not path or title.status == "failed":
            continue
        if title.status == DELIVERED:
            media_file = await media_file_index.resolve_current(db, path)
            if media_file is None:
                media_file = await media_file_index.upsert_by_path(db, path)
            if disc is not None:
                media_file.disc_id = disc.id
                media_file.release_id = disc.set_id
            media_file.source_kind = "disc"
            if title.sha256 and not media_file.checksum:
                media_file.checksum = title.sha256
            row.media_file_id = media_file.id
            result.linked_files += 1
            if not was_delivered:
                result.newly_delivered.append(path)
        elif record.status == "delivering":
            result.expected.append(path)

    if disc is not None and record.status in ("delivered", "partial"):
        await _link_disc_to_title(db, disc, record)

    await db.flush()
    return result


async def _find_media_id(db: Any, model: Any, identity: RipIdentity) -> Optional[str]:
    if identity.tmdb_id is not None:
        found = (await db.execute(
            select(model.id).where(model.tmdb_id == str(identity.tmdb_id))
        )).scalars().first()
        if found:
            return found
    if identity.imdb_id:
        return (await db.execute(
            select(model.id).where(model.imdb_id == identity.imdb_id)
        )).scalars().first()
    return None


async def _link_disc_to_title(db: Any, disc: Disc, record: RipRecord) -> None:
    """Record that this disc holds the declared movie / series, with the
    episode range it carries. Skipped while the title has no catalog row yet
    (a later report of the same rip fills it in)."""
    is_show = record.identity.media_type == "show"
    media_type = "series" if is_show else "movie"
    media_id = await _find_media_id(db, Series if is_show else Movie, record.identity)
    if not media_id:
        return

    season = start = end = None
    if is_show:
        episodes = [
            t for t in record.titles
            if t.status == DELIVERED and t.episode is not None and t.content_type in (None, "episode")
        ]
        seasons = {t.season if t.season is not None else record.identity.season for t in episodes}
        if len(seasons) == 1 and None not in seasons:
            season = seasons.pop()
            start = min(t.episode for t in episodes)
            end = max((t.episode_end or t.episode) for t in episodes)

    link = (await db.execute(
        select(DiscMediaLink).where(
            DiscMediaLink.disc_id == disc.id,
            DiscMediaLink.media_type == media_type,
            DiscMediaLink.media_id == media_id,
        )
    )).scalar_one_or_none()
    if link is None:
        db.add(DiscMediaLink(
            disc_id=disc.id, media_type=media_type, media_id=media_id,
            season_number=season, episode_start=start, episode_end=end,
        ))
        return
    if season is None:
        return
    if link.season_number is None:
        link.season_number, link.episode_start, link.episode_end = season, start, end
    elif link.season_number == season:
        # Another rip of the same disc and season: widen, never narrow.
        link.episode_start = min(x for x in (link.episode_start, start) if x is not None)
        link.episode_end = max(x for x in (link.episode_end, end) if x is not None)


async def pending_paths(db: Any) -> List[str]:
    """Paths announced by rips that have not confirmed delivery yet."""
    rip_ids = (await db.execute(select(DiscRip.id).where(DiscRip.status == "delivering"))).scalars().all()
    if not rip_ids:
        return []
    rows = (await db.execute(
        select(DiscRipTitle).where(DiscRipTitle.rip_id.in_(list(rip_ids)))
    )).scalars().all()
    return [row.delivered_path for row in rows if row.delivered_path and row.status != "failed"]


# ── Manifest files (fallback when a push never arrived) ─────────────────────

def find_manifests(roots: Optional[Iterable[str]] = None) -> List[str]:
    """Manifest files in the top-level folders of the ingest roots."""
    found: List[str] = []
    for root in (roots if roots is not None else storage_paths.ingest_roots()):
        base = glob.escape(str(root))
        found.extend(glob.glob(os.path.join(base, "*", MANIFEST_GLOB)))
        found.extend(glob.glob(os.path.join(base, MANIFEST_GLOB)))
    return sorted(set(found))


def read_manifest(path: str) -> Optional[RipRecord]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return RipRecord.model_validate(json.load(fh))
    except (OSError, ValueError) as exc:
        logger.warning("Unreadable rip manifest", path=path, error=str(exc))
        return None


async def import_manifests(db: Any, roots: Optional[Iterable[str]] = None) -> Dict[str, Any]:
    """Store every manifest found in the ingest roots; returns a summary."""
    paths = await asyncio.to_thread(find_manifests, roots)
    imported: List[str] = []
    unreadable: List[str] = []
    for path in paths:
        record = await asyncio.to_thread(read_manifest, path)
        if record is None:
            unreadable.append(path)
            continue
        await upsert_rip(db, record)
        imported.append(record.job_id)
    return {"found": len(paths), "imported": imported, "unreadable": unreadable}


# ── Declarations (what the queue matches from) ──────────────────────────────

# Content types that are neither the feature nor an episode.
_NOT_EXTRAS = (None, "", "main_feature", "episode")
# Why a ripped extra waits for a person (see ``apply_declaration``).
EXTRA_HOLD_REASON = "extra from a rip: confirm its type in Extras Review before it is filed"
# How far a file's measured duration may differ from what the ripper measured.
DURATION_TOLERANCE = 0.02


async def declaration_for_path(db: Any, path: Any, file_size: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """What a rip declared the file at ``path`` to be, or None.

    Only a delivered title counts, and only while the file is still the one
    the rip delivered: a different size means another file now sits at that
    path, and the record says nothing about it.
    """
    normalized = media_file_index.normalize_path(path)
    if not normalized:
        return None
    rows = (await db.execute(
        select(DiscRipTitle).where(DiscRipTitle.delivered_path == normalized)
    )).scalars().all()
    rows = [row for row in rows if row.status == DELIVERED]
    if file_size and any(row.size_bytes for row in rows):
        rows = [row for row in rows if not row.size_bytes or row.size_bytes == file_size]
    if not rows:
        return None
    title = max(rows, key=lambda row: (row.created_at is not None, row.created_at))
    rip = (await db.execute(select(DiscRip).where(DiscRip.id == title.rip_id))).scalar_one_or_none()
    if rip is None:
        return None
    return {
        "rip_id": rip.id,
        "disc_id": rip.disc_id,
        "media_type": rip.media_type,
        "title": rip.title,
        "year": rip.year,
        "imdb_id": rip.imdb_id,
        "tmdb_id": rip.tmdb_id,
        "rip_season": rip.season,
        "title_index": title.title_index,
        "content_type": title.content_type,
        "is_main_feature": title.is_main_feature,
        "season": title.season,
        "episode": title.episode,
        "episode_end": title.episode_end,
        "tmdb_episode_id": title.tmdb_episode_id,
        "episode_name": title.episode_name,
        "custom_name": title.custom_name,
        "read_errors": title.read_errors or 0,
        "duration_seconds": title.duration_seconds,
    }


# A custom name that is really an episode code: "S01E11", "S01E11-E12 - Name".
_CUSTOM_EPISODE_RE = re.compile(
    r"^\s*S(?P<season>\d{1,3})E(?P<episode>\d{1,4})(?:-?E(?P<end>\d{1,4}))?(?:\s*-\s*(?P<name>.*))?\s*$",
    re.IGNORECASE,
)


def apply_declaration(
    parsed_info: Dict[str, Any],
    declaration: Dict[str, Any],
    *,
    media_duration_ms: Optional[float] = None,
    keep_classification: bool = False,
    previous: Optional[Dict[str, Any]] = None,
    hold_extras: bool = False,
) -> Optional[str]:
    """Put what the rip declared into ``parsed_info`` (in place).

    The declared ids, season and episode replace what was parsed from the
    file name, so the matcher resolves the title by id. Returns a reason to
    hold the file for review, or None when the declaration can be trusted as
    it stands. ``keep_classification`` leaves a reviewer's own
    main/special/alternate choice alone.

    A declared extra gets ``extras_category`` (its type): the one a reviewer
    already chose (``previous``, the item's earlier parsed_info), else the type
    picked on the rip page. With ``hold_extras`` it is held for review until a
    reviewer confirms that type, because the rip page's pick was made without
    seeing the video.
    """
    from services.extras_taxonomy import CATEGORIES

    content_type = declaration.get("content_type")
    is_show = declaration.get("media_type") == "show"
    is_extra = content_type not in _NOT_EXTRAS

    parsed_info["rip"] = {
        "rip_id": declaration.get("rip_id"),
        "disc_id": declaration.get("disc_id"),
        "title_index": declaration.get("title_index"),
        "content_type": content_type,
        "read_errors": declaration.get("read_errors") or 0,
    }
    if declaration.get("imdb_id"):
        parsed_info["imdb_id"] = declaration["imdb_id"]
    if declaration.get("tmdb_id") is not None:
        parsed_info["tmdb_id"] = str(declaration["tmdb_id"])
    if declaration.get("title"):
        parsed_info["title"] = declaration["title"]
        parsed_info["title_source"] = "rip"
    if declaration.get("year"):
        parsed_info["year"] = declaration["year"]

    reason: Optional[str] = None
    if is_extra:
        earlier = previous or {}
        category = earlier.get("extras_category")
        if category not in CATEGORIES:
            category = content_type if content_type in CATEGORIES else None
        if category:
            parsed_info["extras_category"] = category
        if earlier.get("extras_confirmed"):
            parsed_info["extras_confirmed"] = True
        elif hold_extras:
            reason = EXTRA_HOLD_REASON
    if is_show and not is_extra:
        parsed_info["media_type"] = "episode"
        if declaration.get("episode") is None:
            # A custom name typed as an episode code ("S01E11-E12 - Dead Drop")
            # is an episode assignment all the same.
            typed = _CUSTOM_EPISODE_RE.match(declaration.get("custom_name") or "")
            if typed:
                declaration = {
                    **declaration,
                    "season": int(typed.group("season")),
                    "episode": int(typed.group("episode")),
                    "episode_end": int(typed.group("end")) if typed.group("end") else None,
                    "episode_name": (typed.group("name") or "").strip() or None,
                }
        if declaration.get("episode") is not None:
            season = declaration.get("season")
            parsed_info["season"] = season if season is not None else declaration.get("rip_season")
            parsed_info["episode"] = declaration["episode"]
            episode_end = declaration.get("episode_end")
            parsed_info["episode_end"] = (
                episode_end if episode_end is not None and episode_end > declaration["episode"] else None
            )
            if declaration.get("episode_name"):
                parsed_info["episode_title"] = declaration["episode_name"]
        else:
            # The ripper numbers an unassigned title by its position on the disc.
            reason = "ripped without an episode assignment: the episode number in the name is only its position on the disc"
    elif not is_show:
        parsed_info["media_type"] = "movie"

    if not keep_classification:
        if is_extra:
            parsed_info["classification_override"] = "special_feature"
        elif content_type == "main_feature" and declaration.get("is_main_feature"):
            parsed_info["classification_override"] = "main_feature"

    read_errors = declaration.get("read_errors") or 0
    if read_errors:
        reason = f"the disc had {read_errors} read error(s) while this title was ripped"
    ripped = declaration.get("duration_seconds")
    if not reason and ripped and media_duration_ms:
        measured = media_duration_ms / 1000.0
        if abs(measured - ripped) / ripped > DURATION_TOLERANCE:
            reason = f"file runs {measured:.0f}s but the rip recorded {ripped:.0f}s"
    return reason


async def import_manifest_files(db: Any, paths: Iterable[str]) -> List[str]:
    """Store the given manifest files; returns the job ids imported."""
    imported: List[str] = []
    for path in paths:
        record = await asyncio.to_thread(read_manifest, path)
        if record is not None:
            await upsert_rip(db, record)
            imported.append(record.job_id)
    return imported


# ── DTOs ────────────────────────────────────────────────────────────────────

def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value is not None else None


def title_to_dict(row: DiscRipTitle) -> Dict[str, Any]:
    return {
        "titleIndex": row.title_index,
        "fileSeq": row.file_seq,
        "status": row.status,
        "error": row.error,
        "contentType": row.content_type,
        "isMainFeature": row.is_main_feature,
        "season": row.season,
        "episode": row.episode,
        "episodeEnd": row.episode_end,
        "tmdbEpisodeId": row.tmdb_episode_id,
        "episodeName": row.episode_name,
        "customName": row.custom_name,
        "makemkvFilename": row.makemkv_filename,
        "deliveredPath": row.delivered_path,
        "sizeBytes": row.size_bytes,
        "sha256": row.sha256,
        "durationSeconds": row.duration_seconds,
        "readErrors": row.read_errors or 0,
        "mediaFileId": row.media_file_id,
    }


def rip_to_dict(rip: DiscRip, titles: Optional[List[DiscRipTitle]] = None, *, full: bool = False) -> Dict[str, Any]:
    out = {
        "id": rip.id,
        "status": rip.status,
        "discId": rip.disc_id,
        "releaseId": rip.release_id,
        "mediaType": rip.media_type,
        "title": rip.title,
        "year": rip.year,
        "imdbId": rip.imdb_id,
        "tmdbId": rip.tmdb_id,
        "season": rip.season,
        "discType": rip.disc_type,
        "reportedDiscType": rip.reported_disc_type,
        "discName": rip.disc_name,
        "volumeLabel": rip.volume_label,
        "fingerprint": rip.fingerprint,
        "fingerprintAlgo": rip.fingerprint_algo,
        "driveModel": rip.drive_model,
        "makemkvVersion": rip.makemkv_version,
        "ripperHost": rip.ripper_host,
        "ripStartedAt": _iso(rip.rip_started_at),
        "ripFinishedAt": _iso(rip.rip_finished_at),
        "deliveredAt": _iso(rip.delivered_at),
        "scanTitleCount": len(rip.scan_titles or []),
    }
    if titles is not None:
        out["titles"] = [title_to_dict(t) for t in titles]
    if full:
        out["scanTitles"] = rip.scan_titles or []
    return out

"""
The To-Do (attention) list: which files and titles need a person.

Kinds, in display order:

- ``needs_assignment`` — ingest queue items held for review or failed, and
  library files linked to no title;
- ``needs_rename`` — linked main / version / episode files whose path is not
  the canonical one (tolerant comparison, :mod:`services.canonical_path`),
  title folders that are not canonical, and open naming findings of the latest
  compliance scan not already covered by a file or folder item;
- ``needs_review`` — files a person flagged, low-confidence automatic
  assignments, duplicate main features (latest scan), unconfirmed extras, and
  files an ingest step put somewhere other than planned;
- ``missing_file`` — rows whose file is gone (``is_available`` false);
- ``no_disc_link`` — titles with linked discs whose main files name no disc;
- ``unprobed`` — library files without technical metadata (or whose probe failed);
- ``unripped_disc`` — discs no file came from (listed, not in the badge total).

The builders (``build_*``) are pure functions over rows (ORM objects or
anything with the same attributes) collected in :class:`AttentionInputs`, so
they are tested without a database. :func:`load_inputs` reads everything they
need straight from the database (not from the in-memory queue service), and
:func:`collect_items` runs them and applies dismissals.

Each item is a dict with the keys in :data:`ITEM_KEYS`. ``file`` (the file DTO)
is filled in by :func:`attach_file_dtos` for the page being returned.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from services import canonical_path, media_file_index
from services.canonical_path import TitleIdentity

NEEDS_ASSIGNMENT = "needs_assignment"
NEEDS_RENAME = "needs_rename"
NEEDS_REVIEW = "needs_review"
MISSING_FILE = "missing_file"
NO_DISC_LINK = "no_disc_link"
UNPROBED = "unprobed"
UNRIPPED_DISC = "unripped_disc"

KINDS = (NEEDS_ASSIGNMENT, NEEDS_RENAME, NEEDS_REVIEW, MISSING_FILE, NO_DISC_LINK, UNPROBED, UNRIPPED_DISC)
# Listed, but left out of the badge total.
EXCLUDED_FROM_TOTAL = (UNRIPPED_DISC, UNPROBED)

SUBJECT_FILE = "media_file"
SUBJECT_QUEUE = "queue_item"
SUBJECT_DISC = "disc"
SUBJECT_TITLE = "title"
SUBJECT_FINDING = "finding"
SUBJECT_TYPES = (SUBJECT_FILE, SUBJECT_QUEUE, SUBJECT_DISC, SUBJECT_TITLE, SUBJECT_FINDING)

SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}

QUEUE_STATUSES = ("needs_review", "failed")
NAMING_FINDING_TYPES = ("naming_mismatch", "season_folder_naming_mismatch", "episode_naming_mismatch")
DUPLICATE_FINDING_TYPE = "duplicate_main_feature"

ITEM_KEYS = (
    "id", "kind", "subjectType", "subjectId", "title", "detail", "severity",
    "mediaType", "mediaId", "mediaTitle", "filePath", "relativePath", "current", "expected",
    "queueItemId", "discId", "file", "createdAt", "dismissible",
    # Additive context.
    "catalogType", "fingerprint", "reasons", "queue",
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> Optional[str]:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return value if isinstance(value, str) else None


def item_id(kind: str, subject_type: str, subject_id: Any) -> str:
    return f"{kind}:{subject_type}:{subject_id}"


def _norm(path: Any) -> str:
    return media_file_index.normalize_path(path)


def _basename(path: Any) -> str:
    text = _norm(path)
    return text.rsplit("/", 1)[-1] if text else ""


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------

@dataclass
class TitleInfo:
    identity: TitleIdentity
    media_type: str  # the web UI's route type (movie / series / documentary / ...)

    @property
    def kind(self) -> str:
        return self.identity.kind

    @property
    def id(self) -> str:
        return self.identity.id

    @property
    def title(self) -> str:
        return self.identity.title


@dataclass
class AttentionInputs:
    files: List[Any] = field(default_factory=list)  # media_files rows
    titles: Dict[Tuple[str, str], TitleInfo] = field(default_factory=dict)  # (kind, id) -> title
    queue_items: List[Any] = field(default_factory=list)  # ingress_queue rows (needs_review / failed)
    assignments: List[Any] = field(default_factory=list)  # media_assignments rows (non-manual)
    extra_files: List[Any] = field(default_factory=list)  # assignment_extra_files rows (unconfirmed)
    operations: List[Any] = field(default_factory=list)  # ingest_operations moves (done, not undone)
    findings: List[Any] = field(default_factory=list)  # open findings of the latest compliance scan
    discs: List[Any] = field(default_factory=list)
    disc_links: List[Any] = field(default_factory=list)  # disc_media_links rows
    episode_titles: Dict[Tuple[str, int, int], str] = field(default_factory=dict)
    threshold: int = 80

    # Lookups, built on first use.
    _by_id: Optional[Dict[str, Any]] = None
    _by_path: Optional[Dict[str, Any]] = None

    def file_by_id(self, file_id: Any) -> Optional[Any]:
        if self._by_id is None:
            self._by_id = {f.id: f for f in self.files}
        return self._by_id.get(file_id)

    def file_by_path(self, path: Any) -> Optional[Any]:
        if self._by_path is None:
            self._by_path = {_norm(f.file_path): f for f in self.files if f.file_path}
        return self._by_path.get(_norm(path))

    def title_of_file(self, row: Any) -> Optional[TitleInfo]:
        if getattr(row, "movie_id", None):
            return self.titles.get(("movie", row.movie_id))
        if getattr(row, "series_id", None):
            return self.titles.get(("series", row.series_id))
        return None


def title_info(kind: str, row: Any) -> TitleInfo:
    from api.media_files import derive_media_type  # the web UI's routing rule

    record = dict(getattr(row, "raw_data", None) or {})
    record["id"] = row.id
    try:
        media_type = derive_media_type(record)
    except Exception:  # pylint: disable=broad-except
        media_type = kind
    if kind == "series":
        media_type = "series"
    elif media_type == "series":
        media_type = "movie"
    return TitleInfo(identity=canonical_path.title_identity(kind, row), media_type=media_type)


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------

def make_item(
    kind: str,
    subject_type: str,
    subject_id: Any,
    *,
    title: str,
    detail: str,
    severity: str,
    fingerprint: Any,
    title_info: Optional[TitleInfo] = None,
    file_row: Any = None,
    file_path: Optional[str] = None,
    relative_path: Optional[str] = None,
    current: Optional[str] = None,
    expected: Optional[str] = None,
    queue_item_id: Optional[str] = None,
    disc_id: Optional[str] = None,
    created_at: Any = None,
    dismissible: bool = True,
    reasons: Optional[List[str]] = None,
    queue: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    item = {
        "id": item_id(kind, subject_type, subject_id),
        "kind": kind,
        "subjectType": subject_type,
        "subjectId": str(subject_id),
        "title": title,
        "detail": detail,
        "severity": severity,
        "mediaType": title_info.media_type if title_info else None,
        "mediaId": title_info.id if title_info else None,
        "mediaTitle": title_info.title if title_info else None,
        "filePath": file_path if file_path is not None else (getattr(file_row, "file_path", None) if file_row is not None else None),
        "relativePath": relative_path if relative_path is not None else (
            getattr(file_row, "relative_path", None) if file_row is not None else None
        ),
        "current": current,
        "expected": expected,
        "queueItemId": queue_item_id,
        "discId": disc_id if disc_id is not None else (getattr(file_row, "disc_id", None) if file_row is not None else None),
        "file": None,
        "createdAt": _iso(created_at if created_at is not None else getattr(file_row, "created_at", None)),
        "dismissible": dismissible,
        "catalogType": title_info.kind if title_info else None,
        "fingerprint": None if fingerprint is None else str(fingerprint),
        "reasons": list(reasons or []),
        "queue": queue,
    }
    if file_row is not None:
        item["_file_row"] = file_row
    return item


def _is_library(row: Any) -> bool:
    return getattr(row, "location", None) == "library"


def _available(row: Any) -> bool:
    return getattr(row, "is_available", None) is not False


# -- needs_assignment ---------------------------------------------------------

def build_needs_assignment(inputs: AttentionInputs) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for q in inputs.queue_items:
        if q.status not in QUEUE_STATUSES:
            continue
        parsed = q.parsed_info if isinstance(q.parsed_info, dict) else {}
        best = q.best_match if isinstance(q.best_match, dict) else {}
        reason = parsed.get("review_reason")
        failed = q.status == "failed"
        match_title = best.get("title")
        if best.get("year") and match_title:
            match_label = f"{match_title} ({best.get('year')})"
        else:
            match_label = match_title
        if failed:
            what = f"Ingest failed: {q.last_error}" if q.last_error else "Ingest failed."
        elif reason:
            what = f"Held for review: {reason}."
        else:
            what = "Held for review."
        fix = (
            f" Confirm '{match_label}' or pick the right title in the ingest queue."
            if match_label else " Pick the right title in the ingest queue."
        )
        items.append(make_item(
            NEEDS_ASSIGNMENT, SUBJECT_QUEUE, q.id,
            title=f"Assign {q.file_name}",
            detail=(what.rstrip(".") + "." + fix).replace("..", "."),
            severity="high" if failed else "medium",
            fingerprint=f"{q.status}|{_norm(q.file_path)}",
            file_path=q.file_path,
            current=match_label,
            expected=q.proposed_path,
            queue_item_id=q.id,
            created_at=q.queued_at or q.created_at,
            reasons=["queue_failed" if failed else "queue_review"],
            queue={
                "status": q.status,
                "reviewReason": reason,
                "lastError": q.last_error,
                "confidence": q.confidence_score,
                "bestMatchTitle": match_title,
                "bestMatchYear": best.get("year"),
                "bestMatchMediaType": best.get("media_type"),
                "proposedPath": q.proposed_path,
            },
        ))
    for f in inputs.files:
        if not _is_library(f) or not _available(f) or f.movie_id or f.series_id:
            continue
        legacy = bool(getattr(f, "assigned_to_id", None))
        items.append(make_item(
            NEEDS_ASSIGNMENT, SUBJECT_FILE, f.id,
            title=f"Link {f.file_name} to a title",
            detail=(
                "This library file is linked to no catalog title"
                + (" (only a legacy assignment names one)" if legacy else "")
                + ". Assign it to its movie or show, or run the inventory scan if its folder matches one."
            ),
            severity="low" if legacy else "medium",
            fingerprint=f.relative_path or _norm(f.file_path),
            file_row=f,
            reasons=["unlinked_file"],
        ))
    return items


# -- needs_rename -------------------------------------------------------------

def canonical_for(inputs: AttentionInputs, row: Any) -> canonical_path.CanonicalResult:
    """The shared canonical computation, with what the inputs know (title, episode title)."""
    info = inputs.title_of_file(row)
    episode_title = None
    if info is not None and info.kind == "series" and row.season_number is not None and row.episode_number is not None:
        episode_title = inputs.episode_titles.get((info.id, row.season_number, row.episode_number))
    return canonical_path.compute(row, info.identity if info else None, episode_title=episode_title)


def build_needs_rename(inputs: AttentionInputs) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    file_paths: set = set()
    folder_paths: set = set()
    titles_flagged: set = set()
    for f in inputs.files:
        if not _is_library(f) or not _available(f) or not (f.movie_id or f.series_id):
            continue
        if f.role not in canonical_path.RENAMABLE_ROLES:
            continue
        result = canonical_for(inputs, f)
        if not result.ok or result.skip_flagging:
            continue
        info = inputs.title_of_file(f)
        rel_parts = result.current_relative.split("/")
        title_folder_rel = "/".join(rel_parts[:2])
        if not result.file_matches:
            target_name = result.target_relative.rsplit("/", 1)[-1]
            detail = f"The file name is not the library's canonical name. Rename it to '{target_name}'."
            if not result.folder_matches:
                detail += (
                    f" Its title folder '{result.current_folder}' also differs from "
                    f"'{result.canonical_folder}'; rename the folder separately."
                )
            items.append(make_item(
                NEEDS_RENAME, SUBJECT_FILE, f.id,
                title=f"Rename {f.file_name}",
                detail=detail,
                severity="low" if f.role == "version" else "medium",
                fingerprint=result.current_relative,
                title_info=info,
                file_row=f,
                current=result.current_relative,
                expected=result.target_relative,
                reasons=["file_name"] + ([] if result.folder_matches else ["title_folder"]),
            ))
            file_paths.add(_norm(f.file_path))
            if not result.folder_matches:
                folder_paths.add(title_folder_rel.lower())
        elif not result.folder_matches and info is not None and (info.kind, info.id) not in titles_flagged:
            titles_flagged.add((info.kind, info.id))
            folder_paths.add(title_folder_rel.lower())
            items.append(make_item(
                NEEDS_RENAME, SUBJECT_TITLE, info.id,
                title=f"Rename folder {result.current_folder}",
                detail=(
                    f"The title folder is not the canonical '{result.canonical_folder}'. "
                    "Rename the folder (the files inside already follow its name)."
                ),
                severity="low",
                fingerprint=title_folder_rel,
                title_info=info,
                relative_path=title_folder_rel,
                current=result.current_folder,
                expected=result.canonical_folder,
                created_at=getattr(f, "created_at", None),
                reasons=["title_folder"],
            ))
    items.extend(_naming_finding_items(inputs, file_paths, folder_paths))
    return items


def _state_text(state: Any, *keys: str) -> Optional[str]:
    if not isinstance(state, dict):
        return None
    for key in keys:
        value = state.get(key)
        if value:
            return str(value)
    return None


def _folder_rel(path: Any) -> Optional[str]:
    from services import storage_paths

    rel = storage_paths.to_library_relative(path)
    if not rel:
        return None
    parts = rel.split("/")
    return "/".join(parts[:2]).lower() if len(parts) >= 2 else None


def _naming_finding_items(inputs: AttentionInputs, file_paths: set, folder_paths: set) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for finding in inputs.findings:
        if finding.issue_type not in NAMING_FINDING_TYPES or (finding.status or "open") != "open":
            continue
        if finding.file_path:
            if _norm(finding.file_path) in file_paths:
                continue
        elif finding.folder_path and finding.issue_type == "naming_mismatch":
            if _folder_rel(finding.folder_path) in folder_paths:
                continue
        row = inputs.file_by_path(finding.file_path) if finding.file_path else None
        info = inputs.title_of_file(row) if row is not None else None
        path = finding.file_path or finding.folder_path
        label = _basename(path)
        items.append(make_item(
            NEEDS_RENAME, SUBJECT_FINDING, finding.id,
            title=f"Rename {label}" if label else "Naming finding",
            detail=(finding.rationale or "The compliance scan found a naming problem.").rstrip(".")
            + ". Review it in Library compliance.",
            severity=finding.severity if finding.severity in SEVERITY_RANK else "low",
            fingerprint=f"{finding.issue_type}|{_norm(path)}",
            title_info=info,
            file_row=row,
            file_path=finding.file_path or finding.folder_path,
            current=_state_text(finding.current_state, "fileName", "seasonFolder", "folderName"),
            expected=_state_text(finding.expected_state, "suggestedFileName", "suggestedFolder", "pattern"),
            created_at=finding.created_at,
            reasons=[finding.issue_type],
        ))
    return items


# -- needs_review -------------------------------------------------------------

@dataclass
class _Reason:
    code: str
    title: str
    detail: str
    severity: str
    fingerprint: str
    dismissible: bool = True
    current: Optional[str] = None
    expected: Optional[str] = None
    created_at: Any = None


def build_needs_review(inputs: AttentionInputs) -> List[Dict[str, Any]]:
    per_file: Dict[str, List[_Reason]] = {}
    order: List[str] = []

    def add(file_id: str, reason: _Reason) -> None:
        if file_id not in per_file:
            per_file[file_id] = []
            order.append(file_id)
        per_file[file_id].append(reason)

    items: List[Dict[str, Any]] = []
    for f in inputs.files:
        if getattr(f, "needs_review", None) is True:
            note = getattr(f, "review_note", None)
            add(f.id, _Reason(
                "flagged",
                f"Check {f.file_name}",
                f"Flagged for review{': ' + note if note else ''}. Clear the flag once it has been looked at.",
                "medium",
                f"flagged|{note or ''}",
                dismissible=False,
                created_at=getattr(f, "updated_at", None),
            ))
    for a in inputs.assignments:
        if a.is_manual_assignment or a.confidence is None or a.confidence >= inputs.threshold:
            continue
        if not a.primary_file_id or inputs.file_by_id(a.primary_file_id) is None:
            continue
        add(a.primary_file_id, _Reason(
            "low_confidence",
            "Confirm an automatic match",
            f"It was assigned automatically with confidence {a.confidence} (below {inputs.threshold}). "
            "Check that the title is right, or reassign it.",
            "medium",
            f"low_confidence|{a.id}|{a.confidence}",
            created_at=a.assigned_date or a.created_at,
        ))
    for finding in inputs.findings:
        if finding.issue_type != DUPLICATE_FINDING_TYPE or (finding.status or "open") != "open":
            continue
        state = finding.current_state if isinstance(finding.current_state, dict) else {}
        detail = (
            f"'{state.get('primaryCandidate')}' and '{state.get('secondaryCandidate')}' look like two copies of "
            "the main feature. Keep one, or label the other as a version."
            if state.get("primaryCandidate") else
            "Two similarly sized main-feature files are in this folder. Keep one, or label the other as a version."
        )
        row = inputs.file_by_path(finding.file_path) if finding.file_path else None
        reason = _Reason(
            DUPLICATE_FINDING_TYPE, "Possible duplicate main feature", detail, "high",
            f"{DUPLICATE_FINDING_TYPE}|{_norm(finding.file_path or finding.folder_path)}",
            current=state.get("secondaryCandidate"), expected=state.get("primaryCandidate"),
            created_at=finding.created_at,
        )
        if row is not None:
            add(row.id, reason)
        else:
            items.append(make_item(
                NEEDS_REVIEW, SUBJECT_FINDING, finding.id,
                title=reason.title, detail=reason.detail, severity=reason.severity,
                fingerprint=reason.fingerprint, file_path=finding.file_path or finding.folder_path,
                current=reason.current, expected=reason.expected, created_at=finding.created_at,
                reasons=[reason.code],
            ))
    for extra in inputs.extra_files:
        if extra.confirmed:
            continue
        if inputs.file_by_id(extra.media_file_id) is None:
            continue
        category = extra.category
        add(extra.media_file_id, _Reason(
            "extra_unconfirmed",
            "Confirm an extra's category",
            (f"The extra was classified as '{category}' but nobody confirmed it." if category
             else "The extra has no category yet.") + " Confirm or change its category.",
            "low",
            f"extra_unconfirmed|{extra.id}|{category or ''}",
            current=category,
            created_at=extra.created_at,
        ))
    for op in inputs.operations:
        if op.op != "move" or op.status != "done" or op.undone_at is not None:
            continue
        if not op.dst or not op.planned_dst or _norm(op.dst) == _norm(op.planned_dst):
            continue
        row = inputs.file_by_path(op.dst)
        if row is None:  # the file has moved on since: nothing left to check
            continue
        add(row.id, _Reason(
            "moved_elsewhere",
            "File was put somewhere unplanned",
            f"Ingest moved it to '{_basename(op.dst)}' instead of the planned '{_basename(op.planned_dst)}' "
            "(something was already there). Check which copy to keep.",
            "medium",
            f"moved_elsewhere|{op.id}|{_norm(op.dst)}",
            current=_norm(op.dst),
            expected=_norm(op.planned_dst),
            created_at=op.executed_at or op.created_at,
        ))

    for file_id in order:
        row = inputs.file_by_id(file_id)
        reasons = per_file[file_id]
        reasons.sort(key=lambda r: SEVERITY_RANK.get(r.severity, 9))
        first = reasons[0]
        detail = " ".join(r.detail for r in reasons)
        title = first.title if len(reasons) == 1 else f"Check {row.file_name} ({len(reasons)} things)"
        with_values = next((r for r in reasons if r.current or r.expected), None)
        items.append(make_item(
            NEEDS_REVIEW, SUBJECT_FILE, file_id,
            title=title,
            detail=detail,
            severity=first.severity,
            fingerprint=";".join(sorted(r.fingerprint for r in reasons)),
            title_info=inputs.title_of_file(row),
            file_row=row,
            current=with_values.current if with_values else None,
            expected=with_values.expected if with_values else None,
            created_at=first.created_at,
            dismissible=all(r.dismissible for r in reasons),
            reasons=[r.code for r in reasons],
        ))
    return items


# -- missing_file / unprobed --------------------------------------------------

def build_missing_file(inputs: AttentionInputs) -> List[Dict[str, Any]]:
    items = []
    for f in inputs.files:
        if f.is_available is not False:
            continue
        since = _iso(getattr(f, "missing_since", None))
        items.append(make_item(
            MISSING_FILE, SUBJECT_FILE, f.id,
            title=f"Missing: {f.file_name}",
            detail=(
                f"The file is no longer at its path{' (since ' + since[:10] + ')' if since else ''}. "
                "Put it back or reconnect the share, or remove the record if it is gone for good."
            ),
            severity="high" if f.role in ("main", "episode") else "medium",
            fingerprint=since or "missing",
            title_info=inputs.title_of_file(f),
            file_row=f,
            created_at=getattr(f, "missing_since", None) or getattr(f, "created_at", None),
            reasons=["missing"],
        ))
    return items


def build_unprobed(inputs: AttentionInputs) -> List[Dict[str, Any]]:
    items = []
    for f in inputs.files:
        if not _is_library(f) or not _available(f):
            continue
        if f.probed_at is not None and not f.probe_error:
            continue
        error = f.probe_error
        items.append(make_item(
            UNPROBED, SUBJECT_FILE, f.id,
            title=f"No technical details for {f.file_name}",
            detail=(
                f"Reading the file's technical details failed: {error}. Check the file is a playable video."
                if error else
                "The file's technical details (codec, resolution, length) have not been read yet. The next inventory scan reads them."
            ),
            severity="low",
            fingerprint=f"error|{error}" if error else "unprobed",
            title_info=inputs.title_of_file(f),
            file_row=f,
            reasons=["probe_failed" if error else "never_probed"],
        ))
    return items


# -- discs --------------------------------------------------------------------

def _disc_titles(inputs: AttentionInputs) -> Dict[Tuple[str, str], List[Any]]:
    """Discs linked to each title: ``disc_media_links`` and the legacy ``raw_data.mediaId``."""
    discs_by_id = {d.id: d for d in inputs.discs}
    linked: Dict[Tuple[str, str], List[Any]] = {}

    def link(key: Tuple[str, str], disc: Any) -> None:
        bucket = linked.setdefault(key, [])
        if disc not in bucket:
            bucket.append(disc)

    for row in inputs.disc_links:
        disc = discs_by_id.get(row.disc_id)
        if disc is None:
            continue
        kind = "series" if row.media_type in ("series", "episode", "tv") else "movie"
        link((kind, row.media_id), disc)
    for disc in inputs.discs:
        raw = disc.raw_data if isinstance(disc.raw_data, dict) else {}
        media_id = raw.get("mediaId")
        if not media_id:
            continue
        for kind in ("movie", "series"):
            if (kind, str(media_id)) in inputs.titles:
                link((kind, str(media_id)), disc)
    return linked


def build_no_disc_link(inputs: AttentionInputs) -> List[Dict[str, Any]]:
    linked = _disc_titles(inputs)
    mains: Dict[Tuple[str, str], List[Any]] = {}
    for f in inputs.files:
        if f.is_available is False:
            continue
        if f.movie_id and f.role == "main":
            mains.setdefault(("movie", f.movie_id), []).append(f)
        elif f.series_id and f.role == "episode":
            mains.setdefault(("series", f.series_id), []).append(f)
    items = []
    for key, discs in linked.items():
        info = inputs.titles.get(key)
        files = mains.get(key) or []
        if info is None or not files or any(f.disc_id for f in files):
            continue
        discs = sorted(discs, key=lambda d: str(d.title or ""))
        names = ", ".join(str(d.title) for d in discs[:3]) + ("…" if len(discs) > 3 else "")
        what = "episodes name" if key[0] == "series" else "main file names"
        items.append(make_item(
            NO_DISC_LINK, SUBJECT_TITLE, info.id,
            title=f"Link {info.title} to its disc",
            detail=(
                f"{len(discs)} disc{'s' if len(discs) != 1 else ''} ({names}) "
                f"{'are' if len(discs) != 1 else 'is'} linked to this title, but none of its {what} a source disc. "
                "Set the source disc on the file."
            ),
            severity="low",
            fingerprint="|".join(sorted(d.id for d in discs)),
            title_info=info,
            disc_id=discs[0].id,
            expected=names,
            created_at=min((f.created_at for f in files if getattr(f, "created_at", None)), default=None),
            reasons=["no_disc_link"],
        ))
    return items


def build_unripped_disc(inputs: AttentionInputs) -> List[Dict[str, Any]]:
    used = {f.disc_id for f in inputs.files if getattr(f, "disc_id", None)}
    title_of_disc: Dict[str, TitleInfo] = {}
    for key, discs in _disc_titles(inputs).items():
        info = inputs.titles.get(key)
        for disc in discs:
            if info is not None:
                title_of_disc.setdefault(disc.id, info)
    items = []
    for disc in inputs.discs:
        if disc.id in used:
            continue
        info = title_of_disc.get(disc.id)
        items.append(make_item(
            UNRIPPED_DISC, SUBJECT_DISC, disc.id,
            title=f"{disc.title} has no ripped files",
            detail="No library file is linked to this disc. Rip it, or link the files that came from it.",
            severity="low",
            fingerprint="unripped",
            title_info=info,
            disc_id=disc.id,
            current=disc.format,
            created_at=disc.created_at,
            reasons=["unripped"],
        ))
    return items


BUILDERS: Dict[str, Callable[[AttentionInputs], List[Dict[str, Any]]]] = {
    NEEDS_ASSIGNMENT: build_needs_assignment,
    NEEDS_RENAME: build_needs_rename,
    NEEDS_REVIEW: build_needs_review,
    MISSING_FILE: build_missing_file,
    NO_DISC_LINK: build_no_disc_link,
    UNPROBED: build_unprobed,
    UNRIPPED_DISC: build_unripped_disc,
}


def build_items(inputs: AttentionInputs, kinds: Iterable[str] = KINDS) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for kind in kinds:
        items.extend(BUILDERS[kind](inputs))
    return sort_items(items)


def sort_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    order = {kind: i for i, kind in enumerate(KINDS)}
    return sorted(items, key=lambda i: (
        SEVERITY_RANK.get(i["severity"], 9),
        order.get(i["kind"], 99),
        (i.get("mediaTitle") or "").lower(),
        (i.get("title") or "").lower(),
        i["id"],
    ))


# ---------------------------------------------------------------------------
# Dismissals
# ---------------------------------------------------------------------------

def _aware(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


def dismissal_applies(dismissal: Any, item: Dict[str, Any], now: datetime) -> bool:
    """Whether a dismissal hides an item: same subject, same fact, not expired."""
    if (dismissal.kind, dismissal.subject_type, dismissal.subject_id) != (
        item["kind"], item["subjectType"], item["subjectId"]
    ):
        return False
    if not item.get("dismissible", True):
        return False
    until = _aware(dismissal.dismissed_until)
    if until is not None and until <= now:
        return False
    return (dismissal.fingerprint or None) == (item.get("fingerprint") or None)


def apply_dismissals(items: List[Dict[str, Any]], dismissals: Iterable[Any], now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    moment = now or _now()
    by_key = {(d.kind, d.subject_type, d.subject_id): d for d in dismissals}
    kept = []
    for item in items:
        d = by_key.get((item["kind"], item["subjectType"], item["subjectId"]))
        if d is not None and dismissal_applies(d, item, moment):
            continue
        kept.append(item)
    return kept


def summarize(items: List[Dict[str, Any]], now: Optional[datetime] = None) -> Dict[str, Any]:
    counts = {kind: 0 for kind in KINDS}
    for item in items:
        counts[item["kind"]] = counts.get(item["kind"], 0) + 1
    total = sum(n for kind, n in counts.items() if kind not in EXCLUDED_FROM_TOTAL)
    return {"counts": counts, "total": total, "generatedAt": (now or _now()).isoformat()}


def public(item: Dict[str, Any]) -> Dict[str, Any]:
    return {key: item.get(key) for key in ITEM_KEYS}


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

async def _all(session: Any, stmt: Any) -> List[Any]:
    return list((await session.execute(stmt)).scalars().all())


async def latest_scan_id(session: Any) -> Optional[str]:
    from sqlalchemy import select
    from db.models import ComplianceScan

    for condition in (ComplianceScan.status == "completed", None):
        stmt = select(ComplianceScan)
        if condition is not None:
            stmt = stmt.where(condition)
        rows = await _all(session, stmt.order_by(ComplianceScan.started_at.desc()).limit(1))
        if rows:
            return rows[0].id
    return None


async def load_inputs(session: Any, *, threshold: Optional[int] = None) -> AttentionInputs:
    """Everything the builders need, read from the database."""
    from sqlalchemy import select
    from config.settings import settings
    from db.models import (
        AssignmentExtraFile,
        ComplianceFinding,
        Disc,
        DiscMediaLink,
        Episode,
        IngestOperation,
        IngressQueueItem,
        MediaAssignment,
        MediaFile,
        Movie,
        Series,
    )

    inputs = AttentionInputs(threshold=threshold if threshold is not None else settings.ingress_auto_assign_threshold)
    inputs.files = await _all(session, select(MediaFile))
    for kind, model in (("movie", Movie), ("series", Series)):
        for row in await _all(session, select(model)):
            inputs.titles[(kind, row.id)] = title_info(kind, row)
    inputs.queue_items = await _all(
        session, select(IngressQueueItem).where(IngressQueueItem.status.in_(QUEUE_STATUSES))
    )
    inputs.assignments = await _all(
        session,
        select(MediaAssignment).where(
            MediaAssignment.is_manual_assignment.isnot(True),
            MediaAssignment.confidence < inputs.threshold,
        ),
    )
    inputs.extra_files = await _all(
        session, select(AssignmentExtraFile).where(AssignmentExtraFile.confirmed.isnot(True))
    )
    inputs.operations = await _all(
        session,
        select(IngestOperation).where(
            IngestOperation.op == "move",
            IngestOperation.status == "done",
            IngestOperation.undone_at.is_(None),
        ),
    )
    scan_id = await latest_scan_id(session)
    if scan_id is not None:
        inputs.findings = await _all(
            session,
            select(ComplianceFinding).where(
                ComplianceFinding.scan_id == scan_id,
                ComplianceFinding.status == "open",
                ComplianceFinding.issue_type.in_(NAMING_FINDING_TYPES + (DUPLICATE_FINDING_TYPE,)),
            ),
        )
    inputs.discs = await _all(session, select(Disc))
    inputs.disc_links = await _all(session, select(DiscMediaLink))
    series_ids = sorted({f.series_id for f in inputs.files if f.series_id})
    if series_ids:
        rows = (await session.execute(
            select(Episode.series_id, Episode.season_number, Episode.episode_number, Episode.title)
            .where(Episode.series_id.in_(series_ids))
        )).all()
        inputs.episode_titles = {
            (r[0], r[1], r[2]): r[3] for r in rows if r[3] and r[1] is not None and r[2] is not None
        }
    return inputs


async def load_dismissals(session: Any) -> List[Any]:
    from sqlalchemy import select
    from db.models import AttentionDismissal

    return await _all(session, select(AttentionDismissal))


async def collect_items(
    session: Any,
    *,
    threshold: Optional[int] = None,
    now: Optional[datetime] = None,
    include_dismissed: bool = False,
) -> List[Dict[str, Any]]:
    """Every open item, dismissals applied."""
    inputs = await load_inputs(session, threshold=threshold)
    items = build_items(inputs)
    if include_dismissed:
        return items
    return apply_dismissals(items, await load_dismissals(session), now)


async def attach_file_dtos(session: Any, items: List[Dict[str, Any]]) -> None:
    """Fill ``file`` (the catalog file DTO) on items whose subject is a file."""
    from sqlalchemy import select
    from api.catalog import _media_file_to_dict
    from db.models import Disc, Tape

    rows = [item.get("_file_row") for item in items if item.get("_file_row") is not None]
    disc_ids = sorted({r.disc_id for r in rows if r.disc_id})
    tape_ids = sorted({r.tape_id for r in rows if r.tape_id})
    discs = {d.id: d for d in await _all(session, select(Disc).where(Disc.id.in_(disc_ids)))} if disc_ids else {}
    tapes = {t.id: t for t in await _all(session, select(Tape).where(Tape.id.in_(tape_ids)))} if tape_ids else {}
    for item in items:
        row = item.get("_file_row")
        if row is not None:
            item["file"] = _media_file_to_dict(row, disc=discs.get(row.disc_id), tape=tapes.get(row.tape_id))


# ---------------------------------------------------------------------------
# Summary cache
# ---------------------------------------------------------------------------

SUMMARY_TTL_SECONDS = 60


class SummaryCache:
    """One summary reused for ``ttl_seconds`` (same pattern as
    ``DomainMetricsCollector``); writes that change the list call :meth:`invalidate`."""

    def __init__(self, ttl_seconds: int = SUMMARY_TTL_SECONDS, clock: Callable[[], float] = time.monotonic):
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._value: Optional[Dict[str, Any]] = None
        self._sampled_at: Optional[float] = None
        self._lock = asyncio.Lock()
        self.builds = 0

    def is_stale(self) -> bool:
        return self._sampled_at is None or (self._clock() - self._sampled_at) >= self.ttl_seconds

    def invalidate(self) -> None:
        self._value = None
        self._sampled_at = None

    async def get(self, build: Callable[[], Any]) -> Dict[str, Any]:
        if not self.is_stale() and self._value is not None:
            return self._value
        async with self._lock:
            if not self.is_stale() and self._value is not None:
                return self._value
            value = await build()
            self.builds += 1
            self._value = value
            self._sampled_at = self._clock()
            return value


summary_cache = SummaryCache()


def invalidate_summary() -> None:
    summary_cache.invalidate()

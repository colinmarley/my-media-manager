"""
Coverage of the physical collection against the library, and file
suggestions for a release. Phase 2 of
docs/architecture/PHYSICAL_RELEASES_AND_DISC_LINKING.md.

Everything here is derived from rows the caller passes in; nothing is
stored and nothing touches the database. Rows only need the attributes read
below, so ORM objects, column-only result rows and test stand-ins all work.

Vocabulary:

- A release's *targets* are what it holds: its ``release_contents`` rows, or,
  when it has none, the title links of its discs (the phone app links titles
  to discs, not to releases).
- A file is *counted* when it is the main file of a movie or an episode of a
  series. Versions, extras and unassigned files are reported apart, so two
  thousand extras do not drown the numbers.
- A file is linked to a release when ``release_id`` names it. A file linked
  to a disc always carries that disc's release too.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

# Disc states.
DISC_RIPPED = "ripped"        # a file names this disc
DISC_COVERED = "covered"      # no file names it, but its release has the files it holds
DISC_SKIPPED = "skipped"      # never meant to be ripped
DISC_UNRIPPED = "unripped"
DISC_STATES = (DISC_RIPPED, DISC_COVERED, DISC_UNRIPPED, DISC_SKIPPED)

# Release states.
RELEASE_COMPLETE = "complete"
RELEASE_PARTIAL = "partial"
RELEASE_NONE = "none"
RELEASE_SKIPPED = "skipped"   # every disc is skipped and nothing is linked
RELEASE_STATES = (RELEASE_COMPLETE, RELEASE_PARTIAL, RELEASE_NONE, RELEASE_SKIPPED)

# File states.
FILE_LINKED_DISC = "linkedDisc"
FILE_LINKED_RELEASE = "linkedRelease"
FILE_SUGGESTED = "suggested"        # unlinked, and a release holds its title
FILE_NO_SOURCE = "noSource"         # unlinked, nothing catalogued holds its title
FILE_NOT_PHYSICAL = "notPhysical"   # a download or a tape transfer
FILE_STATES = (FILE_LINKED_DISC, FILE_LINKED_RELEASE, FILE_SUGGESTED, FILE_NO_SOURCE, FILE_NOT_PHYSICAL)

# Resolution tiers, shared by disc formats and files.
TIER_SD = "sd"
TIER_HD = "hd"
TIER_UHD = "uhd"

FIT_FITS = "fits"
FIT_MISMATCH = "mismatch"
FIT_UNKNOWN = "unknown"

COUNTED_ROLES = ("main", "episode")
PACKAGING_LOOSE = "loose"


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def format_tier(disc_format: Any) -> Optional[str]:
    """Resolution tier of a disc format as clients spell it ("DVD", "Blu-ray",
    "BLURAY", "4K UHD", "UHD_BLURAY", "HD DVD", "LaserDisc", ...)."""
    if not disc_format:
        return None
    text = str(disc_format).lower().replace("_", " ").replace("-", " ")
    if "uhd" in text or "4k" in text:
        return TIER_UHD
    if "blu" in text or "hd dvd" in text:
        return TIER_HD
    if "dvd" in text or "laser" in text or "vcd" in text:
        return TIER_SD
    return None


def file_tier(row: Any) -> Optional[str]:
    """Resolution tier of a probed file. Width counts as well as height: a
    Blu-ray rip cropped to 1920x800 is still HD."""
    width = getattr(row, "width", None) or 0
    height = getattr(row, "height", None) or 0
    if not width and not height:
        return None
    if width >= 3000 or height >= 1500:
        return TIER_UHD
    if width >= 1100 or height >= 650:
        return TIER_HD
    return TIER_SD


def fit(tiers: Iterable[Optional[str]], row: Any) -> str:
    """Whether a file's resolution is what a disc of one of these tiers gives."""
    known = {t for t in tiers if t}
    tier = file_tier(row)
    if not known or tier is None:
        return FIT_UNKNOWN
    return FIT_FITS if tier in known else FIT_MISMATCH


def is_counted(row: Any) -> bool:
    """The main file of a movie, or an episode of a series, that is still on disk."""
    if getattr(row, "is_available", True) is False:
        return False
    role = getattr(row, "role", None)
    if role == "main":
        return bool(getattr(row, "movie_id", None))
    if role == "episode":
        return bool(getattr(row, "series_id", None))
    return False


def is_not_physical(row: Any) -> bool:
    return getattr(row, "source_kind", None) in ("digital", "tape") or bool(getattr(row, "tape_id", None))


@dataclass(frozen=True)
class Target:
    """One thing a release or disc holds: a movie, a series, a season, or an
    episode range of a season."""
    media_type: str  # "movie" | "series"
    media_id: str
    season_number: Optional[int] = None
    episode_start: Optional[int] = None
    episode_end: Optional[int] = None

    @property
    def title_key(self) -> Tuple[str, str]:
        return (self.media_type, self.media_id)

    def holds(self, row: Any) -> bool:
        """Whether a counted-or-version file belongs to this target."""
        if self.media_type == "movie":
            return getattr(row, "movie_id", None) == self.media_id
        if getattr(row, "series_id", None) != self.media_id:
            return False
        if self.season_number is None:
            return True
        if getattr(row, "season_number", None) != self.season_number:
            return False
        episode = getattr(row, "episode_number", None)
        if self.episode_start is not None and (episode is None or episode < self.episode_start):
            return False
        if self.episode_end is not None and (episode is None or episode > self.episode_end):
            return False
        return True


def _target(row: Any) -> Optional[Target]:
    media_type = "series" if getattr(row, "media_type", None) in ("series", "episode", "tv") else "movie"
    media_id = getattr(row, "media_id", None)
    if not media_id:
        return None
    return Target(
        media_type, str(media_id),
        getattr(row, "season_number", None),
        getattr(row, "episode_start", None),
        getattr(row, "episode_end", None),
    )


def _dedupe(targets: Iterable[Optional[Target]]) -> List[Target]:
    seen: Set[Target] = set()
    out: List[Target] = []
    for target in targets:
        if target is not None and target not in seen:
            seen.add(target)
            out.append(target)
    return out


def season_episode_counts(series_row: Any) -> Dict[int, int]:
    """{season number: episode count} from the TMDB detail stored on a series."""
    data = getattr(series_row, "tmdb_data", None)
    seasons = data.get("seasons") if isinstance(data, dict) else None
    counts: Dict[int, int] = {}
    for season in seasons or []:
        if not isinstance(season, dict):
            continue
        number, count = season.get("season_number"), season.get("episode_count")
        if isinstance(number, int) and isinstance(count, int) and count > 0:
            counts[number] = count
    return counts


# ---------------------------------------------------------------------------
# Index
# ---------------------------------------------------------------------------

@dataclass
class CoverageIndex:
    """The rows, with the lookups every question below needs."""
    discs: List[Any] = field(default_factory=list)
    releases: List[Any] = field(default_factory=list)
    contents: List[Any] = field(default_factory=list)      # release_contents rows
    disc_links: List[Any] = field(default_factory=list)    # disc_media_links rows
    files: List[Any] = field(default_factory=list)         # media_files rows
    series: List[Any] = field(default_factory=list)        # series rows (id, total_episodes, tmdb_data)

    def __post_init__(self) -> None:
        self.release_by_id: Dict[str, Any] = {r.id: r for r in self.releases}
        self.discs_by_release: Dict[str, List[Any]] = {}
        for disc in self.discs:
            if getattr(disc, "set_id", None):
                self.discs_by_release.setdefault(disc.set_id, []).append(disc)

        self.disc_targets: Dict[str, List[Target]] = {}
        for link in self.disc_links:
            self.disc_targets.setdefault(link.disc_id, []).append(_target(link))
        # A disc's legacy single title (raw_data.mediaId, set by reassign-discs).
        for disc in self.discs:
            raw = disc.raw_data if isinstance(getattr(disc, "raw_data", None), dict) else {}
            if raw.get("mediaId"):
                legacy_type = "series" if raw.get("mediaType") in ("series", "episode", "tv") else "movie"
                self.disc_targets.setdefault(disc.id, []).append(Target(legacy_type, str(raw["mediaId"])))
        self.disc_targets = {disc_id: _dedupe(targets) for disc_id, targets in self.disc_targets.items()}

        own: Dict[str, List[Optional[Target]]] = {}
        for content in self.contents:
            own.setdefault(content.release_id, []).append(_target(content))
        self.release_targets: Dict[str, List[Target]] = {}
        for release in self.releases:
            targets = _dedupe(own.get(release.id, []))
            if not targets:
                targets = _dedupe(
                    t for disc in self.discs_by_release.get(release.id, []) for t in self.disc_targets.get(disc.id, [])
                )
            self.release_targets[release.id] = targets

        self.files_by_disc: Dict[str, List[Any]] = {}
        self.files_by_release: Dict[str, List[Any]] = {}
        self.files_by_title: Dict[Tuple[str, str], List[Any]] = {}
        for row in self.files:
            if getattr(row, "is_available", True) is False:
                continue
            if getattr(row, "disc_id", None):
                self.files_by_disc.setdefault(row.disc_id, []).append(row)
            if getattr(row, "release_id", None):
                self.files_by_release.setdefault(row.release_id, []).append(row)
            if getattr(row, "movie_id", None):
                self.files_by_title.setdefault(("movie", row.movie_id), []).append(row)
            elif getattr(row, "series_id", None):
                self.files_by_title.setdefault(("series", row.series_id), []).append(row)

        self.series_by_id: Dict[str, Any] = {s.id: s for s in self.series}
        # Titles some release holds, for the "suggested" file state.
        self.targets_by_title: Dict[Tuple[str, str], List[Target]] = {}
        for targets in self.release_targets.values():
            for target in targets:
                self.targets_by_title.setdefault(target.title_key, []).append(target)

    # -- discs -------------------------------------------------------------

    def disc_state(self, disc: Any) -> str:
        if self.files_by_disc.get(disc.id):
            return DISC_RIPPED
        if getattr(disc, "rip_intent", None) == "skip":
            return DISC_SKIPPED
        release_files = self.files_by_release.get(getattr(disc, "set_id", None) or "", [])
        if release_files:
            targets = self.disc_targets.get(disc.id) or []
            # A disc that says what it holds is covered by files of those
            # titles; one that does not is covered by any file of its release.
            if not targets or any(t.holds(f) for t in targets for f in release_files):
                return DISC_COVERED
        return DISC_UNRIPPED

    # -- releases ----------------------------------------------------------

    def expected_episodes(self, target: Target) -> Optional[int]:
        """How many episodes a series target should have, when that is known."""
        if target.episode_start is not None and target.episode_end is not None:
            return target.episode_end - target.episode_start + 1
        series = self.series_by_id.get(target.media_id)
        if series is None:
            return None
        if target.season_number is None:
            total = getattr(series, "total_episodes", None)
            return total if isinstance(total, int) and total > 0 else None
        if target.episode_start is not None or target.episode_end is not None:
            return None  # an open-ended range
        return season_episode_counts(series).get(target.season_number)

    def target_progress(self, release_id: str, target: Target) -> Dict[str, Any]:
        """Linked files of one target: ``have`` distinct movies/episodes,
        ``expected`` when known, and whether that satisfies the target."""
        linked = [
            f for f in self.files_by_release.get(release_id, [])
            if target.holds(f) and getattr(f, "role", None) in COUNTED_ROLES
        ]
        if target.media_type == "movie":
            have, expected = (1 if linked else 0), 1
        else:
            have = len({(f.season_number, f.episode_number) for f in linked})
            expected = self.expected_episodes(target)
        satisfied = have >= expected if expected else have > 0
        return {"have": have, "expected": expected, "satisfied": satisfied}

    def release_state(self, release: Any) -> str:
        linked = self.files_by_release.get(release.id, [])
        targets = self.release_targets.get(release.id, [])
        if not linked:
            discs = self.discs_by_release.get(release.id, [])
            if discs and all(getattr(d, "rip_intent", None) == "skip" for d in discs):
                return RELEASE_SKIPPED
            return RELEASE_NONE
        if not targets:
            return RELEASE_COMPLETE  # it says nothing about what it holds, and it has files
        if all(self.target_progress(release.id, t)["satisfied"] for t in targets):
            return RELEASE_COMPLETE
        return RELEASE_PARTIAL

    def is_incomplete_set(self, release: Any) -> bool:
        """Fewer discs catalogued than the release says it has."""
        expected = getattr(release, "expected_disc_count", None)
        return bool(expected) and len(self.discs_by_release.get(release.id, [])) < expected

    def release_tiers(self, release_id: str) -> Set[str]:
        """Resolution tiers of the release's discs that are meant to be ripped
        (all of them when every disc is skipped)."""
        discs = self.discs_by_release.get(release_id, [])
        wanted = [d for d in discs if getattr(d, "rip_intent", None) != "skip"] or discs
        return {t for t in (format_tier(getattr(d, "format", None)) for d in wanted) if t}

    # -- files -------------------------------------------------------------

    def file_state(self, row: Any) -> str:
        if getattr(row, "disc_id", None):
            return FILE_LINKED_DISC
        if getattr(row, "release_id", None):
            return FILE_LINKED_RELEASE
        if is_not_physical(row):
            return FILE_NOT_PHYSICAL
        key = ("movie", row.movie_id) if getattr(row, "movie_id", None) else ("series", getattr(row, "series_id", None))
        if any(t.holds(row) for t in self.targets_by_title.get(key, [])):
            return FILE_SUGGESTED
        return FILE_NO_SOURCE


# ---------------------------------------------------------------------------
# Coverage counts
# ---------------------------------------------------------------------------

def build_coverage(index: CoverageIndex) -> Dict[str, Any]:
    """Counts for GET /api/catalog/coverage."""
    discs = {state: 0 for state in DISC_STATES}
    for disc in index.discs:
        discs[index.disc_state(disc)] += 1

    releases = {state: 0 for state in RELEASE_STATES}
    loose = incomplete_sets = 0
    for release in index.releases:
        releases[index.release_state(release)] += 1
        if getattr(release, "packaging", None) == PACKAGING_LOOSE:
            loose += 1
        if index.is_incomplete_set(release):
            incomplete_sets += 1

    files = {state: 0 for state in FILE_STATES}
    other = {"version": 0, "extra": 0, "other": 0, "unassigned": 0}
    counted_titles: Set[Tuple[str, str]] = set()
    counted = 0
    for row in index.files:
        if getattr(row, "is_available", True) is False:
            continue
        if is_counted(row):
            counted += 1
            files[index.file_state(row)] += 1
            counted_titles.add(("movie", row.movie_id) if row.role == "main" else ("series", row.series_id))
            continue
        role = getattr(row, "role", None)
        if not (getattr(row, "movie_id", None) or getattr(row, "series_id", None)):
            other["unassigned"] += 1
        elif role in ("version", "extra"):
            other[role] += 1
        else:
            other["other"] += 1

    disc_titles = set(index.targets_by_title)
    return {
        "discs": {
            "total": len(index.discs),
            **discs,
            # Discs that need nothing more: ripped, covered by their release, or skipped on purpose.
            "done": discs[DISC_RIPPED] + discs[DISC_COVERED] + discs[DISC_SKIPPED],
        },
        "releases": {
            "total": len(index.releases),
            **releases,
            "loose": loose,
            "incompleteSets": incomplete_sets,
        },
        "files": {
            "total": counted,
            **files,
            "linked": files[FILE_LINKED_DISC] + files[FILE_LINKED_RELEASE],
            "unlinked": files[FILE_SUGGESTED] + files[FILE_NO_SOURCE],
        },
        "otherFiles": other,
        "titles": {
            "withBoth": len(counted_titles & disc_titles),
            "filesOnly": len(counted_titles - disc_titles),
            "discsOnly": len(disc_titles - counted_titles),
        },
    }


# ---------------------------------------------------------------------------
# Suggestions
# ---------------------------------------------------------------------------

def _sort_key(row: Any) -> Tuple:
    return (
        getattr(row, "season_number", None) or 0,
        getattr(row, "episode_number", None) or 0,
        str(getattr(row, "file_name", "") or "").lower(),
    )


def suggest_files(index: CoverageIndex, release: Any) -> List[Dict[str, Any]]:
    """For each target of a release, the library files that could have come
    from it: same title (and season / episode range), a main file, version or
    episode, not yet linked to any disc or release, not marked as a download
    or tape. Each carries ``fit`` (does its resolution match the release's
    disc formats) and ``preselected`` (fits, or cannot be told and is the only
    kind of candidate there is).

    Returns ``[{"target": Target, "progress": {...}, "files": [{"row", "fit", "preselected"}]}]``.
    """
    tiers = index.release_tiers(release.id)
    out: List[Dict[str, Any]] = []
    offered: Set[str] = set()
    for target in index.release_targets.get(release.id, []):
        candidates = []
        for row in index.files_by_title.get(target.title_key, []):
            if row.id in offered or not target.holds(row):
                continue
            if getattr(row, "role", None) not in ("main", "version", "episode"):
                continue
            if getattr(row, "disc_id", None) or getattr(row, "release_id", None) or is_not_physical(row):
                continue
            candidates.append(row)
        candidates.sort(key=_sort_key)
        fits = {row.id: fit(tiers, row) for row in candidates}
        any_fit = any(v == FIT_FITS for v in fits.values())
        entries = []
        for row in candidates:
            offered.add(row.id)
            entries.append({
                "row": row,
                "fit": fits[row.id],
                # With nothing known to fit, files of unknown resolution are the best guess.
                "preselected": fits[row.id] == FIT_FITS or (fits[row.id] == FIT_UNKNOWN and not any_fit),
            })
        out.append({"target": target, "progress": index.target_progress(release.id, target), "files": entries})
    return out


def suggestion_counts(index: CoverageIndex, release: Any) -> Dict[str, int]:
    """``{"candidates", "preselected"}`` for one release, for the bulk review list."""
    groups = suggest_files(index, release)
    files = [entry for group in groups for entry in group["files"]]
    return {"candidates": len(files), "preselected": sum(1 for entry in files if entry["preselected"])}

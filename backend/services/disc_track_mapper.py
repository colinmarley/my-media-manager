"""
Map MakeMKV track files of a TV disc rip to episodes.

A TV disc ripped with MakeMKV arrives as a folder of ``B1_t00.mkv``,
``B1_t01.mkv`` ... files with no episode information. The folder name is the
only identity evidence and the track order plus the file durations are the
only episode evidence. This is the "TV set with track numbers only" case of
section 6.6 of docs/architecture/INGEST_AUTOMATION_ANALYSIS_AND_REDESIGN.md.

What this module does, for one folder (a *set*):

1. Identify the series: search TMDB TV for the folder title (and, for a
   folder like ``Show (Volume name) (1999-)``, the title without the
   parenthetical, and the parent folder title). The set is only treated as TV
   when a series scores clearly and no TMDB *movie* scores as well, so a movie
   disc (``Premium Rush (2012)/B1_t00.mkv``) is left to the normal matcher.
2. Sort the tracks (``A1_t00`` < ``A1_t01`` < ``B1_t00``), drop Play-All
   tracks (duration close to the sum of the others) and tracks too short to be
   an episode (extras).
3. Slide a window of ``n`` consecutive episodes over the series' episodes
   (seasons concatenated in order, specials excluded) and keep every window
   where each track's duration is within tolerance of its episode's TMDB
   runtime.
4. Exactly one fitting window is a *mapping*. Zero or several is not: the set
   stays unmapped and the reason says why.

Even a mapping is a guess from durations, so the queue never auto-assigns it:
the files go to review with the proposal pre-filled for a person to confirm.
"""

import re
from dataclasses import dataclass, field
from statistics import median
from typing import Any, Dict, List, Optional, Tuple

from utils.logging import logger

# Whole-stem MakeMKV disc code: A1_t00, B4_t10.
TRACK_STEM_PATTERN = re.compile(r"^([A-Za-z])(\d+)_t(\d+)$")

# A series must score at least this on title + year before the set is treated as TV.
SERIES_MIN_SCORE = 60
# A track fits an episode when within 10% of its runtime, or 2 minutes for short episodes.
RUNTIME_TOLERANCE_PCT = 0.10
RUNTIME_TOLERANCE_MIN = 2.0
# Shorter than this share of the typical episode runtime: an extra, not an episode.
EXTRA_MAX_SHARE = 0.6
# Longer than this share of the longest episode runtime: a double episode or a
# feature; not mapped in this slice.
LONG_MIN_SHARE = 1.25
# Play-All: within 3% of the sum of at least two other tracks.
PLAY_ALL_TOLERANCE_PCT = 0.03
# Seasons fetched per series (one HTTP call each).
MAX_SEASONS = 15
# Alternative windows listed in a review reason.
MAX_LISTED_WINDOWS = 3

ROLE_EPISODE = "episode"
ROLE_EXTRA = "extra"
ROLE_PLAY_ALL = "play_all"
ROLE_LONG = "long"
ROLE_UNKNOWN = "unknown"


def track_stem_key(stem: str) -> Optional[Tuple[str, int, int]]:
    """Sort key (letter, disc, track) for a MakeMKV track stem, or None when it is not one."""
    match = TRACK_STEM_PATTERN.match(stem or "")
    if not match:
        return None
    return match.group(1).upper(), int(match.group(2)), int(match.group(3))


def is_track_stem(stem: str) -> bool:
    return track_stem_key(stem) is not None


@dataclass
class TrackFile:
    file_path: str
    stem: str
    duration_ms: Optional[float] = None

    @property
    def minutes(self) -> Optional[float]:
        if not self.duration_ms or self.duration_ms <= 0:
            return None
        return float(self.duration_ms) / 60000.0


@dataclass
class EpisodeSlot:
    season: int
    episode: int
    runtime: Optional[float]
    name: Optional[str]

    @property
    def label(self) -> str:
        return f"S{self.season:02d}E{self.episode:02d}"


@dataclass
class SetMapping:
    """Outcome for one set. ``series`` is a MatchCandidate dict (with its identity breakdown)."""

    series: Dict[str, Any]
    mapped: bool
    review_reason: str
    # file_path -> {"role", "position", "season", "episode", "episode_title", "runtime", "note"}
    files: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    set_entries: List[Dict[str, Any]] = field(default_factory=list)


def _range_label(slots: List[EpisodeSlot]) -> str:
    first, last = slots[0], slots[-1]
    if first.season == last.season:
        return f"{first.label}-E{last.episode:02d}" if len(slots) > 1 else first.label
    return f"{first.label}-{last.label}"


class DiscTrackMapper:
    """Identifies the series of a track-file set and maps its tracks to episodes."""

    def __init__(self, matcher: Any):
        self.matcher = matcher

    def available(self) -> bool:
        return bool(getattr(self.matcher, "tmdb_api_key", None))

    # ------------------------------------------------------------------
    # Series identity
    # ------------------------------------------------------------------

    def identify_series(
        self, queries: List[Tuple[str, Optional[int]]]
    ) -> Tuple[Optional[Any], Optional[str], List[Dict[str, Any]]]:
        """Return (series candidate, reason it could not be settled, alternatives).

        (None, None, []) means "not a TV set": no series scored, or a movie
        scored at least as well, so the caller should use the normal matcher.
        """
        m = self.matcher
        for title, year in queries:
            if not title:
                continue
            parsed = {"title": title, "year": year}
            series = m._search_tmdb_series(title, year)
            if not series:
                continue
            for candidate in series:
                score, breakdown = m._score_candidate(candidate, parsed)
                candidate.confidence_score = score
                candidate.score_breakdown = breakdown
            series.sort(key=lambda c: -c.confidence_score)
            best = series[0]
            if best.confidence_score < SERIES_MIN_SCORE:
                continue

            movies = m._search_tmdb_movie(title, year)
            best_movie_score = 0
            best_movie = None
            for movie in movies:
                score, _ = m._score_candidate(movie, parsed)
                if score > best_movie_score:
                    best_movie_score, best_movie = score, movie
            if best_movie is not None and best_movie_score >= best.confidence_score:
                logger.info(
                    "Track set looks like a movie disc; leaving it to the matcher",
                    title=title, movie=best_movie.title, movie_score=best_movie_score,
                    series=best.title, series_score=best.confidence_score,
                )
                return None, None, []

            alternatives = [c.to_dict() for c in series[1:5]]
            best.score_breakdown.append({
                "rule": "series_query",
                "points": 0,
                "note": f"TMDB TV search for '{title}'" + (f" ({year})" if year else ""),
            })
            if best_movie is not None:
                best.score_breakdown.append({
                    "rule": "not_a_movie",
                    "points": 0,
                    "note": f"best TMDB movie '{best_movie.title}' scored only {best_movie_score}",
                })
            if len(series) > 1:
                runner_up = series[1]
                margin = best.confidence_score - runner_up.confidence_score
                if margin < m.ambiguity_margin:
                    note = (
                        f"'{runner_up.title}'{f' ({runner_up.year})' if runner_up.year else ''}"
                        f" scored {runner_up.confidence_score}, only {margin} below"
                    )
                    best.score_breakdown.append({"rule": "ambiguous", "points": 0, "note": note})
                    best.match_reason = m._format_reason(best.score_breakdown)
                    return best, f"series ambiguous: {note}", alternatives
            best.match_reason = m._format_reason(best.score_breakdown)
            return best, None, alternatives
        return None, None, []

    def season_slots(self, series: Any) -> List[EpisodeSlot]:
        """Every regular episode of the series in broadcast order (season 0 excluded)."""
        m = self.matcher
        m._enrich_from_tmdb(series)
        raw = series.raw_data or {}
        try:
            season_count = int(raw.get("number_of_seasons") or 1)
        except (TypeError, ValueError):
            season_count = 1
        cache: Dict[Tuple[str, int], Optional[Dict[str, Any]]] = {}
        slots: List[EpisodeSlot] = []
        for season in range(1, min(max(season_count, 1), MAX_SEASONS) + 1):
            payload = m._fetch_tmdb_season(series.media_id, season, cache)
            if payload is None:
                continue
            for ep in sorted(
                (e for e in payload.get("episodes") or [] if isinstance(e, dict)),
                key=lambda e: e.get("episode_number") or 0,
            ):
                number = ep.get("episode_number")
                if not isinstance(number, int):
                    continue
                runtime = ep.get("runtime")
                slots.append(EpisodeSlot(
                    season=season,
                    episode=number,
                    runtime=float(runtime) if isinstance(runtime, (int, float)) and runtime > 0 else None,
                    name=ep.get("name") or None,
                ))
        return slots

    # ------------------------------------------------------------------
    # Track roles and window matching
    # ------------------------------------------------------------------

    @staticmethod
    def classify_tracks(
        tracks: List[TrackFile], typical_runtime: float, longest_runtime: float
    ) -> Dict[str, str]:
        """Role per file path: episode, extra, play_all or long."""
        roles: Dict[str, str] = {}
        minutes = {t.file_path: t.minutes or 0.0 for t in tracks}
        extra_limit = EXTRA_MAX_SHARE * typical_runtime
        for track in tracks:
            own = minutes[track.file_path]
            # A Play-All title is the episodes back to back; extras are not part of it.
            others = [
                v for path, v in minutes.items() if path != track.file_path and extra_limit <= v < own
            ]
            if own < extra_limit:
                roles[track.file_path] = ROLE_EXTRA
            elif len(others) >= 2 and abs(own - sum(others)) <= PLAY_ALL_TOLERANCE_PCT * own:
                roles[track.file_path] = ROLE_PLAY_ALL
            elif own > LONG_MIN_SHARE * longest_runtime:
                roles[track.file_path] = ROLE_LONG
            else:
                roles[track.file_path] = ROLE_EPISODE
        return roles

    @staticmethod
    def _fits(track_minutes: float, runtime: Optional[float]) -> Optional[float]:
        """Relative difference when within tolerance, else None."""
        if runtime is None or runtime <= 0:
            return None
        diff = abs(track_minutes - runtime)
        if diff <= max(RUNTIME_TOLERANCE_PCT * runtime, RUNTIME_TOLERANCE_MIN):
            return diff / runtime
        return None

    def fitting_windows(
        self, episode_tracks: List[TrackFile], slots: List[EpisodeSlot]
    ) -> List[Tuple[float, int]]:
        """(mean relative difference, start index) of every window that fits, best first."""
        n = len(episode_tracks)
        fits: List[Tuple[float, int]] = []
        for start in range(0, len(slots) - n + 1):
            diffs = []
            for offset, track in enumerate(episode_tracks):
                diff = self._fits(track.minutes or 0.0, slots[start + offset].runtime)
                if diff is None:
                    break
                diffs.append(diff)
            else:
                fits.append((sum(diffs) / n, start))
        fits.sort()
        return fits

    # ------------------------------------------------------------------
    # Entry point
    # ------------------------------------------------------------------

    def map_set(
        self,
        folder_name: str,
        queries: List[Tuple[str, Optional[int]]],
        tracks: List[TrackFile],
    ) -> Optional[SetMapping]:
        """Map one set. None when the set is not a TV set (leave it to the normal matcher)."""
        if not self.available() or len(tracks) < 2:
            return None
        tracks = sorted(tracks, key=lambda t: track_stem_key(t.stem) or ("", 0, 0))

        series, series_problem, _ = self.identify_series(queries)
        if series is None:
            return None
        series_dict = series.to_dict()
        set_entry = {
            "rule": "disc_track_set",
            "points": 0,
            "note": f"{len(tracks)} MakeMKV track files in '{folder_name}'",
        }

        def unmapped(reason: str, files: Optional[Dict[str, Dict[str, Any]]] = None) -> SetMapping:
            entries = [set_entry, {"rule": "track_mapping_unresolved", "points": 0, "note": reason}]
            return SetMapping(series=series_dict, mapped=False, review_reason=f"disc track set: {reason}",
                              files=files or {}, set_entries=entries)

        if series_problem:
            return unmapped(series_problem)

        missing = [t.stem for t in tracks if t.minutes is None]
        if missing:
            return unmapped(
                f"no duration for {len(missing)} of {len(tracks)} tracks ({', '.join(missing[:3])}"
                f"{'…' if len(missing) > 3 else ''}); cannot match them to episode runtimes"
            )

        slots = self.season_slots(series)
        series_dict = series.to_dict()  # enrichment added the IMDb id
        known = [s.runtime for s in slots if s.runtime]
        if not slots:
            return unmapped(f"TMDB lists no episodes for '{series.title}'")
        if not known:
            return unmapped(f"TMDB has no episode runtimes for '{series.title}'")
        typical = float(median(known))

        longest = float(max(known))
        roles = self.classify_tracks(tracks, typical, longest)
        files: Dict[str, Dict[str, Any]] = {}
        role_notes = {
            ROLE_EXTRA: f"shorter than {EXTRA_MAX_SHARE:.0%} of a typical {typical:.0f}-min episode; likely an extra",
            ROLE_PLAY_ALL: "duration is the sum of the other tracks; a Play-All title",
            ROLE_LONG: f"longer than {LONG_MIN_SHARE:.0%} of the longest {longest:.0f}-min episode; a double episode "
                       "or feature, not mapped automatically",
        }
        for track in tracks:
            role = roles[track.file_path]
            if role != ROLE_EPISODE:
                files[track.file_path] = {"role": role, "note": f"{track.stem} ({track.minutes:.0f} min): "
                                                                 f"{role_notes[role]}"}

        episode_tracks = [t for t in tracks if roles[t.file_path] == ROLE_EPISODE]
        counts = {role: sum(1 for r in roles.values() if r == role) for role in set(roles.values())}
        set_entry["note"] += "; " + ", ".join(
            f"{counts[role]} {label}" for role, label in (
                (ROLE_EPISODE, "episode-length"), (ROLE_PLAY_ALL, "play-all"),
                (ROLE_EXTRA, "extra"), (ROLE_LONG, "double-length"),
            ) if counts.get(role)
        )
        if roles and counts.get(ROLE_LONG):
            return unmapped(
                f"{counts[ROLE_LONG]} track(s) are double-length (double episodes are not mapped yet)", files
            )
        if not episode_tracks:
            return unmapped("no episode-length tracks", files)

        fits = self.fitting_windows(episode_tracks, slots)
        n = len(episode_tracks)
        durations = ", ".join(f"{t.minutes:.0f}" for t in episode_tracks[:6]) + ("…" if n > 6 else "")
        if not fits:
            return unmapped(
                f"no run of {n} consecutive episodes of '{series.title}' matches the track durations "
                f"({durations} min) within {RUNTIME_TOLERANCE_PCT:.0%}",
                files,
            )
        if len(fits) > 1:
            listed = "; ".join(
                _range_label(slots[start:start + n]) for _, start in fits[:MAX_LISTED_WINDOWS]
            )
            more = f" and {len(fits) - MAX_LISTED_WINDOWS} more" if len(fits) > MAX_LISTED_WINDOWS else ""
            return unmapped(
                f"{len(fits)} runs of {n} episodes of '{series.title}' fit the track durations "
                f"({listed}{more}); durations alone cannot tell which",
                files,
            )

        _, start = fits[0]
        window = slots[start:start + n]
        range_label = _range_label(window)
        for position, (track, slot) in enumerate(zip(episode_tracks, window), start=1):
            files[track.file_path] = {
                "role": ROLE_EPISODE,
                "position": position,
                "season": slot.season,
                "episode": slot.episode,
                "episode_title": slot.name,
                "runtime": slot.runtime,
                "note": f"{track.stem} is episode track {position} of {n} -> {slot.label}"
                        + (f" '{slot.name}'" if slot.name else ""),
            }
        entries = [
            set_entry,
            {
                "rule": "track_window",
                "points": 0,
                "note": f"tracks {episode_tracks[0].stem}..{episode_tracks[-1].stem} -> {range_label}: "
                        f"the only run of {n} consecutive episodes within {RUNTIME_TOLERANCE_PCT:.0%} "
                        "of every track duration",
            },
        ]
        reason = (
            f"disc track set mapped to {range_label} of '{series.title}' from track order and durations; "
            "confirm before organizing"
        )
        return SetMapping(series=series_dict, mapped=True, review_reason=reason, files=files, set_entries=entries)

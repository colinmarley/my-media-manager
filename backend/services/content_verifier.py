"""
Content verification: does what is in the file agree with the match the queue proposes?

The matcher works from names, folders and runtime. This checks the proposal
against the content itself (services/content_evidence_service.py):

- title:   the title is on screen, or two known cast/crew names are -> confirm.
           A director credit that names none of the title's directors -> veto.
- episode: an episode title card, dialogue matched against the season's TMDB
           synopses (decision model), or guest names in the credits.
- no match yet: on-screen text is searched on TMDB and a result is suggested
           only when its cast or crew is also read in the credits.

Results are advisory. They are stored at parsed_info["content_verification"]
and shown in review; nothing here changes a status, a match or a path.

Measured on 118 library files (scripts/content-verify-bench): a correct title
was confirmed for 83% of films and episodes and a wrong one never; the episode
pick was right 94% of the time it answered. Frames added nothing to the
feature-versus-bonus question beyond the runtime rule, so that is not judged here.
"""

import asyncio
import re
import time
import unicodedata
from datetime import datetime
from datetime import time as clock_time
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from config.settings import settings
from services.content_evidence_service import ContentEvidence, gather_evidence
from services.ingest_ai_classifier import HOSTED_BASE_URL, SystemOneClient, is_hosted
from utils.logging import logger

VERIFY_MODES = {"off", "shadow"}
SERIES_TYPES = {"episode", "series", "tv"}
TMDB_BASE_URL = "https://api.themoviedb.org/3"

CONFIRM, VETO, SUGGEST, PARTIAL, NO_EVIDENCE = "confirm", "veto", "suggest", "partial", "no_evidence"

_STOPWORDS = {"the", "a", "an", "of", "and", "in", "to"}
_CREDIT_WORDS = re.compile(
    r"(directed|produced|written|created|starring|screenplay|music|edited|photography|producer|casting) by"
    r"|(guest star|co star|executive producer|costume designer|production designer)"
)
_DIRECTOR_CARD = re.compile(r"directed by|director")
_CREW_JOBS = {"Producer", "Executive Producer", "Screenplay", "Writer", "Story", "Original Music Composer",
              "Director of Photography", "Editor", "Casting", "Production Design", "Costume Design"}
_TITLE_CARD_WORDS = 12
_DIALOGUE_CHARS = 7000
_MIN_DIALOGUE_CHARS = 400


class ContentVerificationError(Exception):
    """Raised when a file could not be checked at all (unreadable, or the vision model is down)."""


# --------------------------------------------------------------------------- text matching

def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower().replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def _frame_text(frame: Dict[str, Any]) -> str:
    return norm(str(frame.get("visibleText") or ""))


def title_tokens(title: str) -> List[str]:
    tokens = norm(title).split()
    kept = [t for t in tokens if t not in _STOPWORDS]
    return kept or tokens


def title_seen(title: str, frames: List[Dict[str, Any]]) -> Optional[str]:
    """The on-screen text of the first frame that shows the title, or None."""
    tokens = title_tokens(title)
    if not tokens:
        return None
    phrase = f" {norm(title)} "
    for frame in frames:
        text = _frame_text(frame)
        words = text.split()
        if not words:
            continue
        hits = sum(1 for t in tokens if t in words)
        need = len(tokens) if len(tokens) < 4 else max(3, round(len(tokens) * 0.8))
        if hits < need:
            continue
        # A one-word title only counts on a sparse frame (a title card), not inside running text.
        if len(tokens) == 1 and (len(words) > 6 or len(tokens[0]) < 3):
            continue
        # In a long text (a disclaimer, a subtitle, a crawl) scattered title words prove nothing: a
        # biography notice naming "Anne Frank" confirmed "A Diary for Anne Frank". The title must be
        # there as a phrase.
        if len(words) > _TITLE_CARD_WORDS and phrase not in f" {text} ":
            continue
        return str(frame.get("visibleText"))[:160]
    return None


def names_seen(names: List[str], frames: List[Dict[str, Any]]) -> List[str]:
    blob = " " + "  ".join(_frame_text(f) for f in frames) + " "
    found: List[str] = []
    for name in names or []:
        n = norm(name)
        if len(n.split()) >= 2 and f" {n} " in blob and name not in found:
            found.append(name)
    return found


def director_card_read(frames: List[Dict[str, Any]]) -> bool:
    """A frame that names a director: a headline credit TMDB always has, unlike deep crew lists."""
    for frame in frames:
        text = _frame_text(frame)
        if len(text.split()) > 12 or "director of" in text or "assistant director" in text:
            continue
        if _DIRECTOR_CARD.search(text):
            return True
    return False


def identity_check(ref: Dict[str, Any], frames: List[Dict[str, Any]], allow_veto: bool = True) -> Dict[str, Any]:
    """Does the on-screen text support this title?

    Confirm: the title is on screen, or two known cast/crew names are. Veto needs a positive
    contradiction: a director credit was read and it names none of the title's directors. Crew lists
    that merely fail to overlap are not a contradiction (TMDB lists are partial), and bonus material
    carries its own credits, so the caller turns veto off for short files.
    """
    titles = [t for t in {ref.get("title"), ref.get("original_title")} if t]
    shown = next((s for s in (title_seen(t, frames) for t in titles) if s), None)
    people = names_seen((ref.get("cast") or []) + (ref.get("directors") or []) + (ref.get("crew") or []), frames)
    if shown or len(people) >= 2:
        verdict = CONFIRM
    elif allow_veto and not people and ref.get("directors") and director_card_read(frames):
        verdict = VETO
    else:
        verdict = NO_EVIDENCE
    return {"verdict": verdict, "title_shown": shown, "people": people[:8]}


def episode_from_title_card(ref: Dict[str, Any], frames: List[Dict[str, Any]]) -> Optional[int]:
    series = set(title_tokens(ref.get("title") or ""))
    hits = []
    for episode in ref.get("episodes") or []:
        name = episode.get("name") or ""
        tokens = title_tokens(name)
        # Skip placeholder names ("Episode 4") and names that are just the series title.
        if not tokens or re.fullmatch(r"episode \d+", norm(name)) or set(tokens) <= series:
            continue
        if title_seen(name, frames):
            hits.append((len(tokens), episode["n"]))
    if not hits:
        return None
    hits.sort(reverse=True)
    if len(hits) > 1 and hits[0][0] == hits[1][0]:
        return None
    return hits[0][1]


def episode_from_guests(ref: Dict[str, Any], frames: List[Dict[str, Any]]) -> Optional[int]:
    scored = sorted(
        ((len(names_seen(episode.get("guests") or [], frames)), episode["n"]) for episode in ref.get("episodes") or []),
        reverse=True,
    )
    if not scored or scored[0][0] == 0:
        return None
    if len(scored) > 1 and scored[0][0] == scored[1][0]:
        return None
    return scored[0][1]


def title_candidates(frames: List[Dict[str, Any]], limit: int = 4) -> List[str]:
    """Short on-screen texts that could be a title card, most repeated first. For files with no match."""
    counts: Dict[str, Tuple[int, str]] = {}
    for frame in frames:
        if frame.get("zone") == "mid":
            continue
        text = _frame_text(frame)
        words = text.split()
        if not 1 <= len(words) <= 6 or len(text) < 4 or _CREDIT_WORDS.search(text) or text.isdigit():
            continue
        count, shown = counts.get(text, (0, " ".join(str(frame.get("visibleText")).split())))
        counts[text] = (count + 1, shown)
    ranked = sorted(counts.values(), key=lambda entry: -entry[0])
    return [shown for _, shown in ranked[:limit]]


# --------------------------------------------------------------------------- TMDB reference data

def _crew_names(crew: List[Dict[str, Any]]) -> List[str]:
    out: List[str] = []
    for member in crew or []:
        jobs = {member.get("job")} | {j.get("job") for j in (member.get("jobs") or [])}
        if jobs & _CREW_JOBS and member.get("name") and member["name"] not in out:
            out.append(member["name"])
    return out[:30]


class TmdbReference:
    """What TMDB knows about a title, in the shape the checks compare against."""

    def __init__(self, api_key: str, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.api_key = api_key
        self._transport = transport
        self._cache: Dict[Tuple[str, Tuple[Tuple[str, Any], ...]], Optional[Dict[str, Any]]] = {}

    async def _get(self, path: str, **params: Any) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            return None
        key = (path, tuple(sorted(params.items())))
        if key in self._cache:
            return self._cache[key]
        data: Optional[Dict[str, Any]] = None
        try:
            async with httpx.AsyncClient(timeout=20.0, transport=self._transport) as client:
                response = await client.get(f"{TMDB_BASE_URL}{path}", params={**params, "api_key": self.api_key})
            if response.status_code == 200:
                data = response.json()
            elif response.status_code != 404:
                return None  # transient: do not cache
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Content verification: TMDB lookup failed", path=path, error=type(exc).__name__)
            return None
        if len(self._cache) > 256:
            self._cache.clear()
        self._cache[key] = data
        return data

    async def resolve(self, match: Dict[str, Any]) -> Optional[Tuple[str, int]]:
        """(kind, tmdb id) for a stored match: its own id, else by IMDb id, else by title and year."""
        kind = "tv" if str(match.get("media_type") or "movie").lower() in SERIES_TYPES else "movie"
        media_id = str(match.get("media_id") or "")
        if str(match.get("source") or "").lower() == "tmdb" and media_id.isdigit():
            return kind, int(media_id)
        imdb_id = str(match.get("imdb_id") or "")
        if imdb_id.startswith("tt"):
            found = await self._get(f"/find/{imdb_id}", external_source="imdb_id") or {}
            results = found.get(f"{kind}_results") or []
            if results:
                return kind, int(results[0]["id"])
            episodes = found.get("tv_episode_results") or []
            if kind == "tv" and episodes and episodes[0].get("show_id"):
                return kind, int(episodes[0]["show_id"])
        title = str(match.get("title") or "").strip()
        if not title:
            return None
        params: Dict[str, Any] = {"query": title}
        if match.get("year"):
            params["first_air_date_year" if kind == "tv" else "year"] = match["year"]
        results = (await self._get(f"/search/{kind}", **params) or {}).get("results") or []
        return (kind, int(results[0]["id"])) if results else None

    async def movie(self, tmdb_id: int) -> Optional[Dict[str, Any]]:
        details = await self._get(f"/movie/{tmdb_id}", append_to_response="credits")
        if not details:
            return None
        credits = details.get("credits") or {}
        return {
            "kind": "movie",
            "tmdb_id": tmdb_id,
            "title": details.get("title"),
            "original_title": details.get("original_title"),
            "year": int(str(details.get("release_date") or "")[:4]) if str(details.get("release_date") or "")[:4].isdigit() else None,
            "runtime_min": details.get("runtime"),
            "cast": [c["name"] for c in (credits.get("cast") or [])[:20]],
            "directors": [c["name"] for c in (credits.get("crew") or []) if c.get("job") == "Director"],
            "crew": _crew_names(credits.get("crew") or []),
        }

    async def series(self, tmdb_id: int, season: Optional[int]) -> Optional[Dict[str, Any]]:
        show = await self._get(f"/tv/{tmdb_id}", append_to_response="aggregate_credits")
        if not show:
            return None
        credits = show.get("aggregate_credits") or {}
        episodes: List[Dict[str, Any]] = []
        if season is not None:
            listing = await self._get(f"/tv/{tmdb_id}/season/{season}") or {}
            episodes = [
                {
                    "n": e.get("episode_number"),
                    "name": e.get("name"),
                    "overview": e.get("overview"),
                    "guests": [g["name"] for g in (e.get("guest_stars") or [])[:8]],
                }
                for e in (listing.get("episodes") or [])
                if e.get("episode_number") is not None
            ]
        return {
            "kind": "tv",
            "tmdb_id": tmdb_id,
            "title": show.get("name"),
            "original_title": show.get("original_name"),
            "year": int(str(show.get("first_air_date") or "")[:4]) if str(show.get("first_air_date") or "")[:4].isdigit() else None,
            "cast": [c["name"] for c in (credits.get("cast") or [])[:20]],
            "directors": [c["name"] for c in (show.get("created_by") or [])],
            "crew": _crew_names(credits.get("crew") or []),
            "episodes": episodes,
        }

    async def for_match(self, match: Dict[str, Any], season: Optional[int]) -> Optional[Dict[str, Any]]:
        resolved = await self.resolve(match)
        if resolved is None:
            return None
        kind, tmdb_id = resolved
        return await (self.series(tmdb_id, season) if kind == "tv" else self.movie(tmdb_id))

    async def search(self, text: str, limit: int = 2) -> List[Dict[str, Any]]:
        """Reference data for the first films and series TMDB returns for on-screen text."""
        results = (await self._get("/search/multi", query=text) or {}).get("results") or []
        refs = []
        for result in [r for r in results if r.get("media_type") in ("movie", "tv")][:limit]:
            ref = await (self.series(result["id"], None) if result["media_type"] == "tv" else self.movie(result["id"]))
            if ref:
                refs.append(ref)
        return refs


# --------------------------------------------------------------------------- the verifier

def claim_of(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """What the queue currently proposes for this file, or None when it has no match."""
    match = item.get("best_match") or {}
    if not match.get("title"):
        return None
    parsed = item.get("parsed_info") or {}
    media_type = str(match.get("media_type") or "movie").lower()
    is_series = media_type in SERIES_TYPES

    def pick(key: str) -> Optional[int]:
        value = match.get(key) if match.get(key) is not None else parsed.get(key)
        try:
            return int(value) if is_series and value is not None else None
        except (TypeError, ValueError):
            return None

    return {
        "title": match.get("title"),
        "year": match.get("year"),
        "media_type": media_type,
        "season": pick("season"),
        "episode": pick("episode"),
    }


def is_current(result: Optional[Dict[str, Any]], item: Dict[str, Any]) -> bool:
    """True when a stored result was computed for the match the item has now."""
    return isinstance(result, dict) and result.get("verdict") is not None and result.get("claim") == claim_of(item)


def parse_quiet_hours(spec: str) -> Optional[Tuple[clock_time, clock_time]]:
    match = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*", spec or "")
    if not match:
        return None
    h1, m1, h2, m2 = (int(g) for g in match.groups())
    if h1 > 23 or h2 > 23 or m1 > 59 or m2 > 59:
        return None
    return clock_time(h1, m1), clock_time(h2, m2)


def in_quiet_hours(now: clock_time, spec: str) -> bool:
    window = parse_quiet_hours(spec)
    if window is None:
        return False
    start, end = window
    return start <= now < end if start <= end else (now >= start or now < end)


class ContentVerifier:
    def __init__(
        self,
        reference: TmdbReference,
        mode: str = "shadow",
        decider: Optional[SystemOneClient] = None,
        min_confidence: float = 0.7,
        gather: Callable[[str, float, bool], Awaitable[ContentEvidence]] = gather_evidence,
    ):
        self.reference = reference
        self.mode = mode if mode in VERIFY_MODES else "off"
        self.decider = decider
        self.min_confidence = min_confidence
        self._gather = gather

    @classmethod
    def from_settings(cls) -> "ContentVerifier":
        """Always built, so the review page can check one file on demand; `mode` only gates the loop."""
        mode = (settings.content_verify_mode or "off").strip().lower()
        if mode not in VERIFY_MODES:
            logger.warning("Unknown content verify mode; treating as off", mode=mode)
            mode = "off"
        decider = None
        base_url = (settings.ingest_ai_base_url or HOSTED_BASE_URL).strip()
        if not is_hosted(base_url) or settings.ingest_ai_api_key:
            decider = SystemOneClient(
                api_key=settings.ingest_ai_api_key,
                base_url=base_url,
                model=settings.ingest_ai_model,
                # Ten minutes of dialogue against a season of synopses: a minute or two on a CPU decider.
                timeout_seconds=settings.content_verify_decider_timeout_seconds,
            )
        return cls(
            TmdbReference(settings.tmdb_api_key),
            mode=mode,
            decider=decider,
            min_confidence=settings.content_verify_min_confidence,
        )

    @property
    def runs_automatically(self) -> bool:
        return self.mode == "shadow"

    async def _episode_from_dialogue(
        self, ref: Dict[str, Any], season: Optional[int], dialogue: str
    ) -> Optional[Dict[str, Any]]:
        criteria = {}
        for episode in ref.get("episodes") or []:
            overview = (episode.get("overview") or "").strip()
            if overview:
                criteria[f"e{episode['n']}"] = f"Episode {episode['n']}, \"{episode.get('name')}\": {overview[:500]}"
        if self.decider is None or len(criteria) < 2 or len(dialogue) < _MIN_DIALOGUE_CHARS:
            return None
        state = {"series": ref.get("title"), "season": season, "dialogue_excerpt": dialogue[:_DIALOGUE_CHARS]}
        question = {
            "type": "choice",
            "instructions": (
                "dialogue_excerpt is about ten minutes of spoken dialogue from one episode of this season. "
                "Which episode's synopsis does the dialogue fit?"
            ),
            "criteria": criteria,
        }
        try:
            response = await self.decider.ask(state, {"ep": question})
        except Exception as exc:  # the title and credit checks still stand without it
            logger.warning("Content verification: dialogue judgement failed", error=str(exc))
            return None
        answer = (response.get("answers") or {}).get("ep") or {}
        choice = str(answer.get("choice") or "")
        if not re.fullmatch(r"e\d+", choice):
            return None
        probabilities = answer.get("probabilities") or {}
        return {"episode": int(choice[1:]), "confidence": round(float(probabilities.get(choice) or 0.0), 3)}

    async def _episode_check(
        self, claim: Dict[str, Any], ref: Dict[str, Any], frames: List[Dict[str, Any]], dialogue: str
    ) -> Dict[str, Any]:
        check: Dict[str, Any] = {
            "title_card": episode_from_title_card(ref, frames),
            "guests": episode_from_guests(ref, frames),
            "dialogue": await self._episode_from_dialogue(ref, claim.get("season"), dialogue),
        }
        spoken = check["dialogue"]
        if check["title_card"] is not None:
            check["pick"], check["pick_by"] = check["title_card"], "title_card"
        elif spoken and spoken["confidence"] >= self.min_confidence:
            check["pick"], check["pick_by"] = spoken["episode"], "dialogue"
        elif check["guests"] is not None:
            check["pick"], check["pick_by"] = check["guests"], "guests"
        else:
            check["pick"], check["pick_by"] = None, None

        if check["pick"] is None:
            check["verdict"] = NO_EVIDENCE
        elif claim.get("episode") is None:
            check["verdict"] = SUGGEST
        else:
            check["verdict"] = CONFIRM if check["pick"] == claim["episode"] else VETO
        return check

    async def _identify(self, frames: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], List[str], List[str]]:
        """For a file with no match: (suggestion, on-screen texts tried, names that backed the suggestion)."""
        candidates = title_candidates(frames)
        for text in candidates:
            for ref in await self.reference.search(text):
                check = identity_check(ref, frames, allow_veto=False)
                # A title alone would be circular (it is what was searched), so credits must agree too.
                if len(check["people"]) >= 2 or (check["title_shown"] and check["people"]):
                    suggestion = {
                        "title": ref.get("title"),
                        "year": ref.get("year"),
                        "media_type": "series" if ref.get("kind") == "tv" else "movie",
                        "tmdb_id": ref.get("tmdb_id"),
                    }
                    return suggestion, candidates, check["people"]
        return None, candidates, []

    async def verify(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Check one queue item (its dict form). Raises ContentVerificationError when nothing could be read."""
        started = time.time()
        claim = claim_of(item)
        duration_ms = float(item.get("media_duration_ms") or 0)
        if duration_ms <= 0:
            raise ContentVerificationError("the file has no readable duration")

        ref: Optional[Dict[str, Any]] = None
        is_series = bool(claim) and claim["media_type"] in SERIES_TYPES
        if claim:
            ref = await self.reference.for_match(item.get("best_match") or {}, claim.get("season"))
            if ref is None:  # no TMDB data: the on-screen title is still checkable
                ref = {"title": claim["title"]}
        want_dialogue = is_series and self.decider is not None and len((ref or {}).get("episodes") or []) >= 2

        evidence = await self._gather(str(item.get("file_path")), duration_ms, want_dialogue)
        frames = [f for f in evidence.frames if "error" not in f]
        if not frames:
            errors = sorted({str(f.get("error")) for f in evidence.frames})
            raise ContentVerificationError(
                f"no frame could be read ({'; '.join(errors)[:200]})" if errors else "no frame could be extracted"
            )

        checks: Dict[str, Any] = {}
        suggested: Optional[Dict[str, Any]] = None
        lines: List[str] = []
        if claim and ref:
            # Bonus material carries its own credits; only feature-length or episode files can be vetoed.
            allow_veto = is_series or duration_ms / 60000.0 >= 0.5 * (ref.get("runtime_min") or 80)
            title = checks["title"] = identity_check(ref, frames, allow_veto)
            if title["title_shown"]:
                lines.append(f"Title on screen: \"{title['title_shown']}\"")
            if title["people"]:
                lines.append(f"Credits name {', '.join(title['people'][:5])}")
            if title["verdict"] == VETO:
                lines.append(f"A director credit was read, and it names none of this title's directors "
                             f"({', '.join((ref.get('directors') or [])[:3])})")
            verdict = title["verdict"]

            if is_series and ref.get("episodes"):
                episode = checks["episode"] = await self._episode_check(claim, ref, frames, evidence.dialogue)
                names = {e["n"]: e.get("name") for e in ref["episodes"]}
                if episode["pick"] is not None:
                    how = {
                        "title_card": "The episode title card reads",
                        "dialogue": f"The dialogue ({evidence.dialogue_source}) fits",
                        "guests": "Guest names in the credits fit",
                    }[episode["pick_by"]]
                    confidence = (
                        f" at {round(100 * episode['dialogue']['confidence'])}%" if episode["pick_by"] == "dialogue" else ""
                    )
                    lines.append(f"{how} episode {episode['pick']}, \"{names.get(episode['pick'])}\"{confidence}")
                if episode["verdict"] in (VETO, SUGGEST):
                    suggested = {"season": claim.get("season"), "episode": episode["pick"],
                                 "episode_title": names.get(episode["pick"])}
                if verdict != VETO:
                    if episode["verdict"] != NO_EVIDENCE:
                        verdict = episode["verdict"]
                    elif verdict == CONFIRM:
                        verdict = PARTIAL  # the series is right; which episode is unchecked
            elif is_series and verdict == CONFIRM:
                verdict = PARTIAL
        else:
            suggested, tried, people = await self._identify(frames)
            verdict = SUGGEST if suggested else NO_EVIDENCE
            if suggested:
                lines.append(f"On-screen title and credits ({', '.join(people[:5])}) fit "
                             f"{suggested['title']} ({suggested['year']})")
            elif tried:
                lines.append("On-screen text that may be a title: " + "; ".join(f'"{t}"' for t in tried))

        if not lines:
            lines.append(f"No title or known name was read in {len(frames)} frames")

        return {
            "verdict": verdict,
            "claim": claim,
            "checks": checks,
            "suggested": suggested,
            "evidence": lines,
            "dialogue_source": evidence.dialogue_source,
            "frames": len(evidence.frames),
            "frames_unusable": evidence.unusable_frames,
            "model": settings.localai_vision_model,
            "timings": evidence.timings,
            "took_s": round(time.time() - started, 1),
            "verified_at": time.time(),
        }


def _wall_clock() -> datetime:
    """Now in the configured timezone; the container's own clock when that zone is unknown."""
    try:
        return datetime.now(ZoneInfo(settings.content_verify_timezone))
    except (ZoneInfoNotFoundError, ValueError):
        return datetime.now()


async def run_content_verify_loop(
    queue_service: Any,
    queue_busy: Callable[[], bool],
    initial_delay_seconds: float = 120.0,
    now: Callable[[], datetime] = _wall_clock,
):
    """Work through review items that have no current result, a small batch per tick, until cancelled.

    Stays idle while ingest is processing and during the quiet hours (the GPU host's night shift).
    A file that cannot be checked is not retried until the next restart.
    """
    verifier: Optional[ContentVerifier] = getattr(queue_service, "content_verifier", None)
    if verifier is None or not verifier.runs_automatically:
        return
    interval = max(30, int(settings.content_verify_interval_seconds))
    gave_up: set = set()
    await asyncio.sleep(initial_delay_seconds)
    while True:
        try:
            if not queue_busy() and not in_quiet_hours(now().time(), settings.content_verify_quiet_hours):
                batch = await queue_service.content_verify_candidates(
                    max(1, int(settings.content_verify_batch_size)), exclude=gave_up
                )
                for item_id in batch:
                    if queue_busy() or in_quiet_hours(now().time(), settings.content_verify_quiet_hours):
                        break
                    if await queue_service.refresh_content_verification(item_id, force=False) is None:
                        gave_up.add(item_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Content verify loop failed", error=str(exc))
        await asyncio.sleep(interval)

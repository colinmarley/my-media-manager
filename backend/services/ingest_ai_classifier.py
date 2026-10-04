"""
AI decision-model classification for ingest files.

Asks a "System One" decision model (TypeSafe Jev, or anything that speaks the
same POST /systemone API, e.g. a self-hosted OpenJev) to label every video in
a disc/source folder as main_feature, alternate_version or special_feature.
The whole folder is sent as one `state` so the model can compare titles
against each other (runtimes, names, sizes) the way a person would, with one
`choice` question per file.

Results are advisory: IngressQueueService stores them on the queue item and,
in "assist" mode, treats confident answers like a classification override.
Any failure here must never break ingest, so callers catch DecisionModelError.
"""

import asyncio
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from config.settings import settings
from utils.logging import logger

AI_MODES = {"off", "shadow", "assist"}

LABEL_MAIN = "main_feature"
LABEL_VERSION = "alternate_version"
LABEL_SPECIAL = "special_feature"

_LABEL_CRITERIA: Dict[str, str] = {
    LABEL_MAIN: (
        "The film itself in its primary/standard cut: the full-length feature "
        "presentation a viewer would pick from the disc's Play Movie option."
    ),
    LABEL_VERSION: (
        "Another full-length cut of the same film: extended, director's, "
        "unrated, theatrical-vs-special edition, alternate ending cut, or the "
        "same feature mastered differently. Runtime is close to the main feature."
    ),
    LABEL_SPECIAL: (
        "Bonus material that is not the film: making-of, featurettes, "
        "interviews, deleted or extended scenes, trailers, gag reels, short "
        "films, music videos, or disc filler such as intros and short loops."
    ),
}

_INSTRUCTIONS = (
    "This is one movie's ingest folder (usually a single disc rip). Using every "
    "file's runtime, size and name relative to the others, classify file {file_id} "
    "(\"{file_name}\")."
)
_INSTRUCTIONS_MAIN_EXISTS = (
    " The main feature is already in the library{library_runtime}, so this file "
    "is either another cut of the film or bonus material."
)

# Jev allows up to 255 choice options but questions are per file; keep the
# request small and the folder plausible as a single disc.
MAX_GROUP_FILES = 40
_RETRY_STATUSES = {429, 529}
_MAX_ATTEMPTS = 3


class DecisionModelError(Exception):
    """Raised when the decision model cannot produce answers."""


class SystemOneClient:
    """Minimal async client for the TypeSafe /systemone decision API."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.typesafe.ai/v1",
        model: str = "jev-latest",
        timeout_seconds: float = 15.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self._transport = transport

    async def ask(self, state: Any, questions: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        """POST one decision request; returns the raw response JSON."""
        payload = {"state": state, "model": self.model, "questions": questions}
        headers = {"Authorization": f"Bearer {self.api_key}"}
        url = f"{self.base_url}/systemone"

        async with httpx.AsyncClient(timeout=self.timeout_seconds, transport=self._transport) as client:
            for attempt in range(1, _MAX_ATTEMPTS + 1):
                try:
                    response = await client.post(url, json=payload, headers=headers)
                except httpx.HTTPError as exc:
                    raise DecisionModelError(f"Decision model request failed: {exc}") from exc

                if response.status_code in _RETRY_STATUSES and attempt < _MAX_ATTEMPTS:
                    await asyncio.sleep(0.5 * 2 ** (attempt - 1))
                    continue
                if response.status_code >= 400:
                    raise DecisionModelError(
                        f"Decision model returned HTTP {response.status_code}: {response.text[:300]}"
                    )
                try:
                    return response.json()
                except ValueError as exc:
                    raise DecisionModelError("Decision model returned non-JSON response") from exc

        raise DecisionModelError("Decision model request retries exhausted")


def _minutes(duration_ms: Optional[float]) -> Optional[float]:
    if not duration_ms or duration_ms <= 0:
        return None
    return round(float(duration_ms) / 60000.0, 1)


class IngestAIClassifier:
    """Builds per-folder decision requests and normalizes the answers."""

    def __init__(
        self,
        client: SystemOneClient,
        mode: str = "shadow",
        min_confidence: float = 0.7,
    ):
        self.client = client
        self.mode = mode if mode in AI_MODES else "off"
        self.min_confidence = min_confidence

    @classmethod
    def from_settings(cls) -> Optional["IngestAIClassifier"]:
        """Return a classifier when an API key is configured, else None.

        The classifier exists whenever a key is set (so on-demand runs work in
        any mode); `mode` controls whether ingest calls it automatically.
        """
        mode = (settings.ingest_ai_mode or "off").strip().lower()
        if mode not in AI_MODES:
            logger.warning("Unknown ingest AI mode; treating as off", mode=mode)
            mode = "off"
        if not settings.ingest_ai_api_key:
            if mode != "off":
                logger.warning("Ingest AI mode is set but no API key is configured", mode=mode)
            return None
        client = SystemOneClient(
            api_key=settings.ingest_ai_api_key,
            base_url=settings.ingest_ai_base_url,
            model=settings.ingest_ai_model,
            timeout_seconds=settings.ingest_ai_timeout_seconds,
        )
        return cls(client, mode=mode, min_confidence=settings.ingest_ai_min_confidence)

    @property
    def runs_automatically(self) -> bool:
        return self.mode in ("shadow", "assist")

    @property
    def drives_decisions(self) -> bool:
        return self.mode == "assist"

    def confident_label(self, ai_classification: Optional[Dict[str, Any]]) -> Optional[str]:
        """Return the stored AI label if it is confident enough to act on."""
        if not isinstance(ai_classification, dict):
            return None
        label = ai_classification.get("label")
        confidence = ai_classification.get("confidence")
        if label not in _LABEL_CRITERIA or not isinstance(confidence, (int, float)):
            return None
        return label if confidence >= self.min_confidence else None

    def build_request(
        self,
        group: List[Dict[str, Any]],
        main_in_library: bool = False,
        library_main_duration_ms: Optional[float] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, Dict[str, Any]], Dict[str, str]]:
        """Return (state, questions, question_id -> item_id) for a folder group.

        Each group entry needs id, file_name, file_path, media_duration_ms,
        file_size and best_match; the first entry's best_match names the film.
        """
        group = group[:MAX_GROUP_FILES]
        anchor = group[0].get("best_match") or {}
        longest_ms = max((float(g.get("media_duration_ms") or 0) for g in group), default=0.0)
        library_minutes = _minutes(library_main_duration_ms)

        files: List[Dict[str, Any]] = []
        question_ids: Dict[str, str] = {}
        for n, entry in enumerate(group, start=1):
            file_id = f"f{n}"
            question_ids[file_id] = entry["id"]
            duration_ms = float(entry.get("media_duration_ms") or 0)
            match = entry.get("best_match") or {}
            file_info: Dict[str, Any] = {
                "id": file_id,
                "file_name": entry.get("file_name"),
                "folder": os.path.basename(os.path.dirname(str(entry.get("file_path") or ""))),
                "runtime_minutes": _minutes(duration_ms),
                "size_gb": round(float(entry.get("file_size") or 0) / 1e9, 2),
                "percent_of_longest_runtime": (
                    round(100.0 * duration_ms / longest_ms) if longest_ms and duration_ms else None
                ),
            }
            if match.get("title") and match.get("title") != anchor.get("title"):
                file_info["matched_title"] = match.get("title")
            files.append(file_info)

        state: Dict[str, Any] = {
            "title": anchor.get("title"),
            "year": anchor.get("year"),
            "media_type": anchor.get("media_type") or "movie",
            "main_feature_already_in_library": main_in_library,
            "library_main_feature_runtime_minutes": library_minutes,
            "files": files,
        }
        if anchor.get("runtime"):
            state["expected_runtime"] = anchor.get("runtime")

        labels = [LABEL_VERSION, LABEL_SPECIAL] if main_in_library else list(_LABEL_CRITERIA)
        criteria = {label: _LABEL_CRITERIA[label] for label in labels}
        questions: Dict[str, Dict[str, Any]] = {}
        for file_info in files:
            instructions = _INSTRUCTIONS.format(file_id=file_info["id"], file_name=file_info["file_name"])
            if main_in_library:
                instructions += _INSTRUCTIONS_MAIN_EXISTS.format(
                    library_runtime=f" ({library_minutes} min)" if library_minutes is not None else ""
                )
            questions[file_info["id"]] = {
                "type": "choice",
                "instructions": instructions,
                "criteria": criteria,
            }
        return state, questions, question_ids

    async def classify_group(
        self,
        group: List[Dict[str, Any]],
        main_in_library: bool = False,
        library_main_duration_ms: Optional[float] = None,
    ) -> Dict[str, Dict[str, Any]]:
        """Classify every file in the group; returns item_id -> ai_classification."""
        if not group:
            return {}
        state, questions, question_ids = self.build_request(
            group, main_in_library, library_main_duration_ms
        )
        started = time.time()
        response = await self.client.ask(state, questions)
        latency_ms = int((time.time() - started) * 1000)

        answers = response.get("answers") or {}
        model = response.get("model") or self.client.model
        results: Dict[str, Dict[str, Any]] = {}
        for file_id, item_id in question_ids.items():
            answer = answers.get(file_id) or {}
            probabilities = {
                str(k): float(v)
                for k, v in (answer.get("probabilities") or {}).items()
                if isinstance(v, (int, float))
            }
            label = answer.get("choice")
            if label not in _LABEL_CRITERIA:
                continue
            results[item_id] = {
                "label": label,
                "confidence": float(answer.get("confidence") or 0.0),
                "probabilities": probabilities,
                "model": model,
                "group_size": len(question_ids),
                "latency_ms": latency_ms,
                "classified_at": time.time(),
            }

        _enforce_single_main(results)
        return results


def _enforce_single_main(results: Dict[str, Dict[str, Any]]) -> None:
    """A folder has at most one main feature: keep the most probable one and
    move the rest to their next-best label with zero confidence, so assist
    mode falls back to the heuristic for them instead of trusting a demotion."""
    mains = [item_id for item_id, r in results.items() if r["label"] == LABEL_MAIN]
    if len(mains) <= 1:
        return
    keep = max(mains, key=lambda i: results[i]["probabilities"].get(LABEL_MAIN, results[i]["confidence"]))
    for item_id in mains:
        if item_id == keep:
            continue
        entry = results[item_id]
        others = {k: v for k, v in entry["probabilities"].items() if k != LABEL_MAIN}
        entry["label"] = max(others, key=others.get) if others else LABEL_VERSION
        entry["confidence"] = 0.0
        entry["demoted_from_main"] = True

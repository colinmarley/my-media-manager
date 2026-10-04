import asyncio
import json

import httpx
import pytest

import services.ingest_ai_classifier as ai_module
from services.ingest_ai_classifier import (
    DecisionModelError,
    IngestAIClassifier,
    SystemOneClient,
)
from services.ingress_queue_service import IngressQueueService


def _answer(choice, probabilities, confidence):
    return {"type": "choice", "choice": choice, "probabilities": probabilities, "confidence": confidence}


def _client(handler):
    return SystemOneClient(api_key="test-key", transport=httpx.MockTransport(handler))


def _group():
    return [
        {
            "id": "a",
            "file_name": "Heat (1995).mkv",
            "file_path": "/ingest/Heat (1995)/Heat (1995).mkv",
            "media_duration_ms": 170 * 60_000,
            "file_size": 30_000_000_000,
            "best_match": {"title": "Heat", "year": 1995, "media_type": "movie"},
        },
        {
            "id": "b",
            "file_name": "B1_t03.mkv",
            "file_path": "/ingest/Heat (1995)/B1_t03.mkv",
            "media_duration_ms": 12 * 60_000,
            "file_size": 900_000_000,
            "best_match": {},
        },
    ]


def test_build_request_sends_folder_state_and_one_choice_per_file():
    classifier = IngestAIClassifier(_client(lambda r: httpx.Response(500)))

    state, questions, ids = classifier.build_request(_group())

    assert ids == {"f1": "a", "f2": "b"}
    assert state["title"] == "Heat" and state["main_feature_already_in_library"] is False
    assert [f["runtime_minutes"] for f in state["files"]] == [170.0, 12.0]
    assert state["files"][1]["percent_of_longest_runtime"] == 7
    assert set(questions) == {"f1", "f2"}
    assert questions["f2"]["type"] == "choice"
    assert set(questions["f2"]["criteria"]) == {"main_feature", "alternate_version", "special_feature"}


def test_build_request_drops_main_feature_option_when_library_has_one():
    classifier = IngestAIClassifier(_client(lambda r: httpx.Response(500)))

    state, questions, _ = classifier.build_request(_group(), main_in_library=True, library_main_duration_ms=171 * 60_000)

    assert state["library_main_feature_runtime_minutes"] == 171.0
    assert set(questions["f1"]["criteria"]) == {"alternate_version", "special_feature"}
    assert "already in the library (171.0 min)" in questions["f1"]["instructions"]


def test_classify_group_posts_to_systemone_and_maps_answers_to_items():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "model": "jev-1.13.0",
            "answers": {
                "f1": _answer("main_feature", {"main_feature": 0.95, "alternate_version": 0.04, "special_feature": 0.01}, 0.92),
                "f2": _answer("special_feature", {"main_feature": 0.01, "alternate_version": 0.02, "special_feature": 0.97}, 0.95),
            },
        })

    classifier = IngestAIClassifier(_client(handler))
    results = asyncio.run(classifier.classify_group(_group()))

    assert seen["url"] == "https://api.typesafe.ai/v1/systemone"
    assert seen["auth"] == "Bearer test-key"
    assert seen["body"]["model"] == "jev-latest"
    assert results["a"]["label"] == "main_feature"
    assert results["b"]["label"] == "special_feature"
    assert results["b"]["model"] == "jev-1.13.0"


def test_classify_group_keeps_only_the_most_probable_main_feature():
    def handler(request):
        return httpx.Response(200, json={"answers": {
            "f1": _answer("main_feature", {"main_feature": 0.6, "alternate_version": 0.35, "special_feature": 0.05}, 0.5),
            "f2": _answer("main_feature", {"main_feature": 0.9, "alternate_version": 0.05, "special_feature": 0.05}, 0.85),
        }})

    results = asyncio.run(IngestAIClassifier(_client(handler)).classify_group(_group()))

    assert results["b"]["label"] == "main_feature"
    assert results["a"]["label"] == "alternate_version"
    assert results["a"]["confidence"] == 0.0
    assert results["a"]["demoted_from_main"] is True


def test_client_retries_overload_then_succeeds(monkeypatch):
    calls = []

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(ai_module.asyncio, "sleep", no_sleep)

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(529)
        return httpx.Response(200, json={"answers": {}})

    assert asyncio.run(_client(handler).ask("state", {})) == {"answers": {}}
    assert len(calls) == 2


def test_client_raises_on_auth_error():
    with pytest.raises(DecisionModelError, match="HTTP 401"):
        asyncio.run(_client(lambda r: httpx.Response(401, text="bad key")).ask("state", {}))


def test_confident_label_respects_threshold():
    classifier = IngestAIClassifier(_client(lambda r: httpx.Response(500)), min_confidence=0.7)

    assert classifier.confident_label({"label": "alternate_version", "confidence": 0.8}) == "alternate_version"
    assert classifier.confident_label({"label": "alternate_version", "confidence": 0.6}) is None
    assert classifier.confident_label({"label": "bogus", "confidence": 0.99}) is None
    assert classifier.confident_label(None) is None


# ── IngressQueueService integration ─────────────────────────────────────────


def _theatrical_and_extended_items():
    """Two cuts of one movie on one disc; the heuristic calls the shorter one a special."""
    match = {"title": "Aliens", "year": 1986, "media_type": "movie"}
    return [
        {
            "id": "theatrical",
            "file_path": "/ingest/Aliens (1986)/Aliens (1986).mkv",
            "ingress_path": "/ingest",
            "file_name": "Aliens (1986).mkv",
            "best_match": dict(match),
            "parsed_info": {
                "title": "Aliens",
                "media_type": "movie",
                "ai_classification": {"label": "main_feature", "confidence": 0.9},
            },
            "media_duration_ms": 137 * 60_000,
        },
        {
            "id": "extended",
            "file_path": "/ingest/Aliens (1986)/Aliens (1986) - Version 2.mkv",
            "ingress_path": "/ingest",
            "file_name": "Aliens (1986) - Version 2.mkv",
            "best_match": dict(match),
            "parsed_info": {
                "title": "Aliens",
                "media_type": "movie",
                "ai_classification": {"label": "alternate_version", "confidence": 0.85},
            },
            "media_duration_ms": 154 * 60_000,
        },
    ]


def _service(mode, tmp_path, monkeypatch):
    monkeypatch.setattr("services.ingress_queue_service.settings.jellyfin_dest_base", str(tmp_path))
    classifier = IngestAIClassifier(_client(lambda r: httpx.Response(500)), mode=mode, min_confidence=0.7)
    return IngressQueueService(ai_classifier=classifier)


def test_assist_mode_uses_confident_ai_labels(tmp_path, monkeypatch):
    items = _theatrical_and_extended_items()

    _service("assist", tmp_path, monkeypatch)._enrich_proposed_paths(items)

    assert items[0]["proposed_path"].endswith("Aliens (1986)/Aliens (1986).mkv")
    assert "Version" in items[1]["proposed_path"]


def test_shadow_mode_leaves_heuristic_in_charge(tmp_path, monkeypatch):
    items = _theatrical_and_extended_items()

    _service("shadow", tmp_path, monkeypatch)._enrich_proposed_paths(items)

    # Heuristic: longest file is the main feature, everything else a special.
    assert items[1]["proposed_path"].endswith("Aliens (1986)/Aliens (1986).mkv")
    assert "Special Feature" in items[0]["proposed_path"]


def test_manual_override_beats_ai_in_assist_mode(tmp_path, monkeypatch):
    items = _theatrical_and_extended_items()
    items[1]["classification_override"] = "special_feature"

    _service("assist", tmp_path, monkeypatch)._enrich_proposed_paths(items)

    assert "Special Feature" in items[1]["proposed_path"]


def test_refresh_ai_classification_stores_labels_on_folder_siblings(tmp_path, monkeypatch):
    folder = tmp_path / "ingest" / "Heat (1995)"
    folder.mkdir(parents=True)
    main_file = folder / "Heat (1995).mkv"
    extra_file = folder / "B1_t03.mkv"
    main_file.write_bytes(b"main")
    extra_file.write_bytes(b"extra")

    def handler(request):
        return httpx.Response(200, json={"answers": {
            "f1": _answer("main_feature", {"main_feature": 0.9}, 0.9),
            "f2": _answer("special_feature", {"special_feature": 0.9}, 0.88),
        }})

    monkeypatch.setattr("services.ingress_queue_service.settings.jellyfin_dest_base", str(tmp_path / "library"))
    service = IngressQueueService(ai_classifier=IngestAIClassifier(_client(handler), mode="shadow"))
    main_item = service.add_manual_file(str(main_file), ingress_path=str(tmp_path / "ingest"))
    extra_item = service.add_manual_file(str(extra_file), ingress_path=str(tmp_path / "ingest"))
    main_item.best_match = {"title": "Heat", "year": 1995, "media_type": "movie"}
    main_item.media_duration_ms = 170 * 60_000
    extra_item.media_duration_ms = 12 * 60_000

    results = asyncio.run(service.refresh_ai_classification(main_item.id))

    assert set(results) == {main_item.id, extra_item.id}
    assert main_item.parsed_info["ai_classification"]["label"] == "main_feature"
    assert extra_item.parsed_info["ai_classification"]["label"] == "special_feature"
    assert service.processing_history[-1]["event"] == "ai_classified"


def test_refresh_ai_classification_failure_is_recorded_not_raised(tmp_path, monkeypatch):
    source = tmp_path / "ingest" / "Heat (1995)" / "Heat (1995).mkv"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"main")

    monkeypatch.setattr("services.ingress_queue_service.settings.jellyfin_dest_base", str(tmp_path / "library"))
    service = IngressQueueService(
        ai_classifier=IngestAIClassifier(_client(lambda r: httpx.Response(401)), mode="assist")
    )
    item = service.add_manual_file(str(source), ingress_path=str(tmp_path / "ingest"))
    item.best_match = {"title": "Heat", "year": 1995, "media_type": "movie"}
    item.media_duration_ms = 170 * 60_000

    assert asyncio.run(service.refresh_ai_classification(item.id)) == {}
    assert service.processing_history[-1]["event"] == "ai_classification_failed"


def test_ai_report_counts_corrections_the_ai_already_proposed(tmp_path, monkeypatch):
    service = _service("shadow", tmp_path, monkeypatch)
    service.processing_history = [
        {"event": "classification_updated", "item_id": "1", "file_name": "a.mkv",
         "classification_override": "alternate_version", "ai_label": "alternate_version", "ai_confidence": 0.9},
        {"event": "classification_updated", "item_id": "2", "file_name": "b.mkv",
         "classification_override": "special_feature", "ai_label": "main_feature", "ai_confidence": 0.8},
        {"event": "classification_updated", "item_id": "3", "file_name": "c.mkv",
         "classification_override": "special_feature", "ai_label": None, "ai_confidence": None},
        {"event": "classification_updated", "item_id": "4", "file_name": "d.mkv",
         "classification_override": None},
    ]

    report = asyncio.run(service.get_ai_agreement_report())

    assert report["manual_corrections"] == 3
    assert report["corrections_with_ai_label"] == 2
    assert report["ai_agreed"] == 1
    assert report["confident_ai_agreed"] == 1

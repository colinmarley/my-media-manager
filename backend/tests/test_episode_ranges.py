"""A file that holds more than one episode (a two-part episode on one disc
title) keeps its whole range from the rip record to the proposed path and the
manual assignment.
"""

import asyncio
import os

import pytest
from fastapi import HTTPException

from api.ingress_operations import QueueManualAssignRequest, _requested_episode_end
from config.settings import settings
from services import canonical_path, rip_records
from services.ingress_queue_service import IngressQueueService

SHOW = "Burn Notice (2007) [imdbid-tt0810788]"
FILE_NAME = "Burn Notice S01E11-E12 - Dead Drop and Loose Ends.mkv"


def _queue_entry(**overrides) -> dict:
    entry = {
        "id": "ep-1",
        "file_name": FILE_NAME,
        "best_match": {"title": "Burn Notice", "year": 2007, "media_type": "series", "imdb_id": "tt0810788"},
        "parsed_info": {
            "title": "Burn Notice", "media_type": "episode", "season": 1, "episode": 11, "episode_end": 12,
            "episode_title": "Dead Drop and Loose Ends",
        },
        "media_duration_ms": None,
    }
    entry.update(overrides)
    return entry


# ── Proposed path ───────────────────────────────────────────────────────────


def test_proposed_path_keeps_the_episode_range():
    items = [_queue_entry()]

    IngressQueueService()._enrich_proposed_paths(items)

    assert items[0]["proposed_path"] == (
        f"{settings.folder_tv_shows}/{SHOW}/Season 01/{SHOW} S01E11E12 Dead Drop and Loose Ends.mkv"
    )
    assert items[0]["best_match"]["episode_end"] == 12


def test_proposed_path_is_the_name_the_canonical_renamer_gives():
    items = [_queue_entry()]
    IngressQueueService()._enrich_proposed_paths(items)
    proposed = items[0]["proposed_path"]

    row = {
        "location": "library", "relative_path": proposed, "is_available": True, "series_id": "series-1",
        "role": "episode", "season_number": 1, "episode_number": 11, "episode_end_number": 12,
    }
    identity = canonical_path.TitleIdentity(
        kind="series", id="series-1", title="Burn Notice", year=2007, imdb_id="tt0810788",
    )
    result = canonical_path.compute(row, identity)

    assert result.ok
    assert result.canonical_relative == proposed


def test_range_is_not_carried_to_a_different_episode():
    """The matcher named another episode: the end parsed from the name is not its end."""
    entry = _queue_entry()
    entry["best_match"].update({"season": 1, "episode": 5})

    IngressQueueService()._enrich_proposed_paths([entry])

    assert "S01E05 " in entry["proposed_path"]
    assert entry["best_match"].get("episode_end") is None


def test_single_episode_proposed_path_is_unchanged():
    entry = _queue_entry()
    entry["parsed_info"]["episode_end"] = None

    IngressQueueService()._enrich_proposed_paths([entry])

    assert entry["proposed_path"].endswith(f"{SHOW} S01E11 Dead Drop and Loose Ends.mkv")


# ── Rip record ──────────────────────────────────────────────────────────────


def _show_declaration(**overrides) -> dict:
    base = {
        "rip_id": "11111111-2222-3333-4444-555555555555", "disc_id": "disc-1",
        "media_type": "show", "title": "Burn Notice", "year": 2007,
        "imdb_id": "tt0810788", "tmdb_id": 2919, "rip_season": 1,
        "title_index": 4, "content_type": "episode", "is_main_feature": None,
        "season": 1, "episode": 11, "episode_end": 12, "tmdb_episode_id": None,
        "episode_name": "Dead Drop and Loose Ends", "custom_name": None,
        "read_errors": 0, "duration_seconds": None,
    }
    base.update(overrides)
    return base


def test_a_declared_range_is_trusted_and_not_held_for_review():
    parsed = {"title": "Burn Notice", "media_type": "episode", "season": 1, "episode": 11, "episode_end": 12}

    assert rip_records.apply_declaration(parsed, _show_declaration()) is None
    assert (parsed["season"], parsed["episode"], parsed["episode_end"]) == (1, 11, 12)
    assert parsed["episode_title"] == "Dead Drop and Loose Ends"


def test_an_end_that_is_not_after_the_episode_is_no_range():
    parsed = {"title": "Burn Notice"}

    assert rip_records.apply_declaration(parsed, _show_declaration(episode_end=11)) is None
    assert parsed["episode_end"] is None


def test_a_custom_name_typed_as_an_episode_code_is_an_assignment():
    """The workaround before ranges could be picked: the code typed as a custom name."""
    parsed = {"title": "Burn Notice", "media_type": "episode", "season": 1, "episode": 11, "episode_end": 12}
    declaration = _show_declaration(
        content_type=None, season=None, episode=None, episode_end=None, episode_name=None,
        custom_name="S01E11-E12 - Dead Drop and Loose Ends",
    )

    assert rip_records.apply_declaration(parsed, declaration) is None
    assert (parsed["season"], parsed["episode"], parsed["episode_end"]) == (1, 11, 12)
    assert parsed["episode_title"] == "Dead Drop and Loose Ends"


def test_any_other_custom_name_is_still_held():
    parsed = {"title": "Burn Notice", "media_type": "episode", "season": 1, "episode": 3}
    declaration = _show_declaration(
        content_type=None, season=None, episode=None, episode_end=None, episode_name=None,
        custom_name="Season 1 recap",
    )

    reason = rip_records.apply_declaration(parsed, declaration)

    assert reason and "without an episode assignment" in reason


# ── Manual assignment ───────────────────────────────────────────────────────


class _CapturingOrchestrator:
    def __init__(self):
        self.calls = []

    async def auto_assign(self, queue_item, force_organize=False):
        self.calls.append(dict(queue_item))
        return {"assignment_id": "a-1", "organized": False, "organization_result": None}


def _assign(tmp_path, file_name, payload_extra):
    path = tmp_path / "ingest" / file_name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    orchestrator = _CapturingOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = service.add_manual_file(os.fspath(path))
    payload = {
        "source": "tmdb", "title": "Burn Notice", "year": 2007, "media_type": "episode",
        "media_id": "2919", "imdb_id": "tt0810788", "season": 1, "episode": 11,
    }
    payload.update(payload_extra)
    result = asyncio.run(service.manual_assign_item(item.id, payload, manual_action=True))
    return result, orchestrator.calls[-1]


def test_manual_assignment_takes_a_last_episode(tmp_path):
    result, call = _assign(tmp_path, "title_t04.mkv", {"episode_end": 12})

    assert call["parsed_info"]["episode_end"] == 12      # what the orchestrator stores as episodeEnd
    assert call["best_match"]["episode_end"] == 12
    assert os.path.basename(result.proposed_path) == f"{SHOW} S01E11E12.mkv"


def test_manual_assignment_keeps_the_range_read_from_the_name(tmp_path):
    """An older caller that sends no last episode leaves the parsed range alone."""
    item_path = tmp_path / "ingest" / FILE_NAME
    item_path.parent.mkdir(parents=True, exist_ok=True)
    item_path.write_bytes(b"x")
    orchestrator = _CapturingOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = service.add_manual_file(os.fspath(item_path))
    item.parsed_info = {"title": "Burn Notice", "season": 1, "episode": 11, "episode_end": 12}

    result = asyncio.run(service.manual_assign_item(item.id, {
        "source": "tmdb", "title": "Burn Notice", "year": 2007, "media_type": "episode",
        "media_id": "2919", "imdb_id": "tt0810788", "season": 1, "episode": 11,
    }))

    assert orchestrator.calls[-1]["parsed_info"]["episode_end"] == 12
    assert f"{SHOW} S01E11E12" in result.proposed_path


@pytest.mark.parametrize("payload_extra", [
    {"episode_end": None},     # the reviewer cleared the last episode
    {"episode": 5},            # reassigned to another episode: the parsed end was not its end
])
def test_manual_assignment_drops_a_range_that_no_longer_applies(tmp_path, payload_extra):
    item_path = tmp_path / "ingest" / FILE_NAME
    item_path.parent.mkdir(parents=True, exist_ok=True)
    item_path.write_bytes(b"x")
    orchestrator = _CapturingOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = service.add_manual_file(os.fspath(item_path))
    item.parsed_info = {"title": "Burn Notice", "season": 1, "episode": 11, "episode_end": 12}

    payload = {
        "source": "tmdb", "title": "Burn Notice", "year": 2007, "media_type": "episode",
        "media_id": "2919", "imdb_id": "tt0810788", "season": 1, "episode": 11,
    }
    payload.update(payload_extra)
    result = asyncio.run(service.manual_assign_item(item.id, payload))

    call = orchestrator.calls[-1]
    assert "episode_end" not in call["parsed_info"]
    assert call["best_match"]["episode_end"] is None
    assert os.path.basename(result.proposed_path) == f"{SHOW} S01E{payload['episode']:02d}.mkv"


# ── Manual-assign request ───────────────────────────────────────────────────


def _request(**fields) -> QueueManualAssignRequest:
    return QueueManualAssignRequest(itemId="q-1", mediaType="episode", title="Burn Notice", **fields)


def test_request_last_episode_is_read():
    assert _requested_episode_end(_request(season=1, episode=11, episodeEnd=12)) == 12


def test_request_last_episode_equal_to_the_first_is_a_single_episode():
    assert _requested_episode_end(_request(season=1, episode=11, episodeEnd=11)) is None


def test_request_last_episode_is_ignored_for_an_unknown_episode():
    assert _requested_episode_end(_request(unknownEpisode=True, episodeEnd=12)) is None


@pytest.mark.parametrize("fields", [
    {"season": 1, "episode": 11, "episodeEnd": 10},
    {"season": 1, "episodeEnd": 12},
])
def test_request_with_an_impossible_range_is_refused(fields):
    with pytest.raises(HTTPException) as refused:
        _requested_episode_end(_request(**fields))
    assert refused.value.status_code == 422


def test_request_says_whether_a_last_episode_was_sent():
    assert "episodeEnd" not in _request(season=1, episode=11).model_fields_set
    assert "episodeEnd" in _request(season=1, episode=11, episodeEnd=None).model_fields_set

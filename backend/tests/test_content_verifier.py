"""Content verification: what was read from a file against the match the queue proposes.

No model, TMDB or ffmpeg is called: the evidence gatherer, the reference lookup and the decider are stubs.
"""

import asyncio
from datetime import datetime
from datetime import time as clock_time
from types import SimpleNamespace

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

import services.content_verifier as cv
from services.content_evidence_service import ContentEvidence, dialogue_windows, frame_times
from services.content_verifier import ContentVerificationError, ContentVerifier, TmdbReference
from services.ingress_queue_service import IngressQueueService

HEAT = {
    "kind": "movie", "tmdb_id": 949, "title": "Heat", "original_title": "Heat", "year": 1995, "runtime_min": 170,
    "cast": ["Al Pacino", "Robert De Niro", "Val Kilmer"], "directors": ["Michael Mann"], "crew": ["Art Linson"],
}
ARCHER = {
    "kind": "tv", "tmdb_id": 10283, "title": "Archer", "original_title": "Archer", "year": 2009,
    "cast": ["H. Jon Benjamin", "Aisha Tyler"], "directors": ["Adam Reed"], "crew": [],
    "episodes": [
        {"n": 1, "name": "Mole Hunt", "overview": "Archer breaks into the mainframe to hide his expenses.", "guests": []},
        {"n": 2, "name": "Training Day", "overview": "Cyril is trained as a field agent.", "guests": ["Coby Bell"]},
        {"n": 3, "name": "Diversity Hire", "overview": "A new agent joins and is not what he seems.", "guests": []},
    ],
}


def frame(text, zone="head"):
    return {"zone": zone, "t": 10.0, "visibleText": text, "textKind": "none", "contentKind": "feature_scene"}


class StubReference:
    def __init__(self, ref=None, found=None):
        self.ref, self.found, self.searched = ref, found or [], []

    async def for_match(self, match, season):
        return self.ref

    async def search(self, text, limit=2):
        self.searched.append(text)
        return self.found


class StubDecider:
    def __init__(self, choice=None, probability=0.9, fail=False):
        self.choice, self.probability, self.fail, self.asked = choice, probability, fail, []

    async def ask(self, state, questions):
        self.asked.append((state, questions))
        if self.fail:
            raise RuntimeError("decider down")
        return {"answers": {"ep": {"choice": self.choice, "probabilities": {self.choice: self.probability}}}}


def verifier(ref=None, frames=(), dialogue="", decider=None, found=None, mode="shadow"):
    calls = []

    async def gather(path, duration_ms, want_dialogue):
        calls.append(want_dialogue)
        return ContentEvidence(frames=list(frames), dialogue=dialogue, dialogue_source="subtitles" if dialogue else None)

    built = ContentVerifier(StubReference(ref, found), mode=mode, decider=decider, gather=gather)
    built.gather_calls = calls
    return built


def movie_item(**overrides):
    return {"file_path": "/ingest/x/title_t00.mkv", "media_duration_ms": 170 * 60_000, "parsed_info": {},
            "best_match": {"title": "Heat", "year": 1995, "media_type": "movie", "source": "tmdb", "media_id": "949"},
            **overrides}


def episode_item(episode=2):
    return {"file_path": "/ingest/x/title_t01.mkv", "media_duration_ms": 21 * 60_000, "parsed_info": {},
            "best_match": {"title": "Archer", "media_type": "episode", "season": 1, "episode": episode,
                           "source": "tmdb", "media_id": "10283"}}


def run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------------------- reading on-screen text

class TestIdentityCheck:
    def test_title_on_screen_confirms(self):
        check = cv.identity_check(HEAT, [frame("HEAT")])
        assert check["verdict"] == "confirm"
        assert check["title_shown"] == "HEAT"

    def test_a_one_word_title_inside_running_text_is_not_a_title_card(self):
        subtitle = frame("I can feel the heat coming off the street tonight, Vincent")
        assert cv.identity_check(HEAT, [subtitle])["verdict"] == "no_evidence"

    def test_title_words_scattered_through_a_long_text_do_not_confirm(self):
        # Seen on a real ingest file: a biography notice confirmed a different Anne Frank title.
        ref = {"title": "A Diary for Anne Frank", "cast": [], "directors": [], "crew": []}
        notice = frame("The following dramatization is based on Melissa Müller's biography of Anne Frank "
                       "and original research for this film")
        assert cv.identity_check(ref, [notice])["verdict"] == "no_evidence"
        crawl = frame("Tonight on this channel we are proud to present A Diary for Anne Frank in full")
        assert cv.identity_check(ref, [crawl])["verdict"] == "confirm"

    def test_two_known_names_confirm_without_a_title(self):
        check = cv.identity_check(HEAT, [frame("AL PACINO"), frame("ROBERT DE NIRO", zone="tail")])
        assert check["verdict"] == "confirm"
        assert check["people"] == ["Al Pacino", "Robert De Niro"]

    def test_one_known_name_is_not_enough(self):
        assert cv.identity_check(HEAT, [frame("Val Kilmer")])["verdict"] == "no_evidence"

    def test_a_director_credit_for_someone_else_vetoes(self):
        assert cv.identity_check(HEAT, [frame("Directed by Ridley Scott")])["verdict"] == "veto"

    def test_unknown_crew_names_alone_never_veto(self):
        # TMDB crew lists are partial: failing to overlap is not a contradiction.
        frames = [frame("Casting by Jane Doe"), frame("Costume Designer John Roe")]
        assert cv.identity_check(HEAT, frames)["verdict"] == "no_evidence"

    def test_veto_can_be_switched_off_for_bonus_material(self):
        frames = [frame("Directed by Ridley Scott")]
        assert cv.identity_check(HEAT, frames, allow_veto=False)["verdict"] == "no_evidence"

    def test_accents_and_ampersands_do_not_block_a_match(self):
        ref = {"title": "Amélie & Friends", "cast": [], "directors": [], "crew": []}
        assert cv.identity_check(ref, [frame("AMELIE AND FRIENDS")])["verdict"] == "confirm"


class TestEpisodePickers:
    def test_title_card_names_the_episode(self):
        assert cv.episode_from_title_card(ARCHER, [frame("Training Day")]) == 2

    def test_a_card_that_only_shows_the_series_title_names_no_episode(self):
        assert cv.episode_from_title_card(ARCHER, [frame("ARCHER")]) is None

    def test_guest_names_point_at_one_episode(self):
        assert cv.episode_from_guests(ARCHER, [frame("Guest Starring Coby Bell", zone="tail")]) == 2
        assert cv.episode_from_guests(ARCHER, [frame("Guest Starring Nobody Known")]) is None


def test_title_candidates_are_short_texts_from_the_opening_and_end():
    frames = [
        frame("THE THIRD MAN"), frame("THE THIRD MAN"), frame("Produced by Alexander Korda"),
        frame("He never grew up. The world grew up round him, that's all."), frame("VIENNA", zone="mid"),
        frame("The End", zone="tail"),
    ]
    assert cv.title_candidates(frames) == ["THE THIRD MAN", "The End"]


def test_quiet_hours_cover_the_window_and_wrap_past_midnight():
    assert cv.in_quiet_hours(clock_time(3, 0), "01:55-06:45")
    assert not cv.in_quiet_hours(clock_time(6, 45), "01:55-06:45")
    assert cv.in_quiet_hours(clock_time(23, 30), "22:00-02:00")
    assert cv.in_quiet_hours(clock_time(1, 0), "22:00-02:00")
    assert not cv.in_quiet_hours(clock_time(12, 0), "22:00-02:00")
    assert not cv.in_quiet_hours(clock_time(3, 0), "")
    assert not cv.in_quiet_hours(clock_time(3, 0), "nonsense")


def test_frames_are_dense_at_both_ends_and_inside_the_file():
    spots = frame_times(7200.0)
    assert [s["zone"] for s in spots].count("head") == 16
    assert [s["zone"] for s in spots].count("tail") == 10
    assert all(0 < s["t"] < 7200 for s in spots)
    assert len(frame_times(90.0)) == 8  # a short clip: evenly spread
    assert len(dialogue_windows(300.0, 300.0)) == 1 and len(dialogue_windows(2700.0, 300.0)) == 2


# --------------------------------------------------------------------------- verdicts

class TestVerify:
    def test_movie_with_its_title_on_screen_is_confirmed(self):
        built = verifier(HEAT, [frame("HEAT"), frame("Al Pacino")])
        result = run(built.verify(movie_item()))
        assert result["verdict"] == "confirm"
        assert result["claim"] == {"title": "Heat", "year": 1995, "media_type": "movie", "season": None, "episode": None}
        assert result["evidence"][0] == 'Title on screen: "HEAT"'
        assert built.gather_calls == [False]  # dialogue is only fetched to tell episodes apart

    def test_feature_length_file_with_another_director_is_vetoed(self):
        result = run(verifier(HEAT, [frame("Directed by Ridley Scott")]).verify(movie_item()))
        assert result["verdict"] == "veto"
        assert "Michael Mann" in result["evidence"][-1]

    def test_a_short_file_is_never_vetoed_because_extras_have_their_own_credits(self):
        item = movie_item(media_duration_ms=12 * 60_000)
        assert run(verifier(HEAT, [frame("Directed by Ridley Scott")]).verify(item))["verdict"] == "no_evidence"

    def test_nothing_legible_is_no_evidence_with_a_reason(self):
        result = run(verifier(HEAT, [frame(""), frame("")]).verify(movie_item()))
        assert result["verdict"] == "no_evidence"
        assert result["evidence"] == ["No title or known name was read in 2 frames"]

    def test_episode_confirmed_by_dialogue(self):
        decider = StubDecider("e2", 0.93)
        built = verifier(ARCHER, [frame("ARCHER")], dialogue="Cyril, " * 100, decider=decider)
        result = run(built.verify(episode_item(2)))
        assert result["verdict"] == "confirm"
        assert result["checks"]["episode"]["pick_by"] == "dialogue"
        assert "fits episode 2, \"Training Day\" at 93%" in result["evidence"][-1]
        assert built.gather_calls == [True]
        state, questions = decider.asked[0]
        assert set(questions["ep"]["criteria"]) == {"e1", "e2", "e3"}
        assert "title_t01" not in str(state)  # the file name is never shown to a model

    def test_episode_whose_dialogue_fits_another_is_vetoed_with_a_suggestion(self):
        built = verifier(ARCHER, [frame("ARCHER")], dialogue="mainframe " * 100, decider=StubDecider("e1", 0.88))
        result = run(built.verify(episode_item(2)))
        assert result["verdict"] == "veto"
        assert result["suggested"] == {"season": 1, "episode": 1, "episode_title": "Mole Hunt"}

    def test_an_unsure_dialogue_answer_does_not_decide(self):
        built = verifier(ARCHER, [frame("ARCHER")], dialogue="um " * 300, decider=StubDecider("e1", 0.4))
        result = run(built.verify(episode_item(2)))
        assert result["verdict"] == "partial"  # the series is right; the episode is unchecked
        assert result["suggested"] is None

    def test_a_title_card_outranks_the_dialogue(self):
        built = verifier(ARCHER, [frame("Training Day")], dialogue="mainframe " * 100, decider=StubDecider("e1", 0.95))
        result = run(built.verify(episode_item(2)))
        assert result["verdict"] == "confirm"
        assert result["checks"]["episode"]["pick_by"] == "title_card"

    def test_a_decider_failure_leaves_the_title_check_standing(self):
        built = verifier(ARCHER, [frame("ARCHER")], dialogue="words " * 200, decider=StubDecider(fail=True))
        assert run(built.verify(episode_item(2)))["verdict"] == "partial"

    def test_series_without_an_episode_number_gets_one_suggested(self):
        item = episode_item(None)
        built = verifier(ARCHER, [frame("ARCHER"), frame("Guest Starring Coby Bell", zone="tail")])
        result = run(built.verify(item))
        assert result["verdict"] == "suggest"
        assert result["suggested"]["episode"] == 2

    def test_unmatched_file_is_suggested_only_when_credits_back_the_search_hit(self):
        frames = [frame("HEAT"), frame("AL PACINO"), frame("ROBERT DE NIRO", zone="tail")]
        built = verifier(None, frames, found=[HEAT])
        result = run(built.verify(movie_item(best_match={})))
        assert result["verdict"] == "suggest"
        assert result["claim"] is None
        assert result["suggested"] == {"title": "Heat", "year": 1995, "media_type": "movie", "tmdb_id": 949}
        assert built.reference.searched[0] == "HEAT"

    def test_unmatched_file_whose_title_alone_matches_is_not_suggested(self):
        built = verifier(None, [frame("HEAT")], found=[HEAT])
        result = run(built.verify(movie_item(best_match={})))
        assert result["verdict"] == "no_evidence"
        assert result["evidence"] == ['On-screen text that may be a title: "HEAT"']

    def test_no_readable_frame_is_an_error_not_a_verdict(self):
        built = verifier(HEAT, [{"zone": "head", "t": 5.0, "error": "ConnectError"}])
        with pytest.raises(ContentVerificationError, match="ConnectError"):
            run(built.verify(movie_item()))

    def test_stored_result_is_current_only_for_the_match_it_judged(self):
        item = movie_item()
        result = run(verifier(HEAT, [frame("HEAT")]).verify(item))
        assert cv.is_current(result, item)
        item["best_match"] = {"title": "Heat", "year": 1986, "media_type": "movie"}
        assert not cv.is_current(result, item)
        assert not cv.is_current(None, item)


# --------------------------------------------------------------------------- TMDB reference

class TestTmdbReference:
    def _reference(self, routes):
        seen = []

        def handler(request):
            seen.append(request.url.path)
            body = routes.get(request.url.path)
            return httpx.Response(200, json=body) if body is not None else httpx.Response(404)

        reference = TmdbReference("key", transport=httpx.MockTransport(handler))
        reference.seen = seen
        return reference

    def test_a_tmdb_match_is_looked_up_by_its_own_id(self):
        reference = self._reference({"/3/movie/949": {
            "title": "Heat", "original_title": "Heat", "release_date": "1995-12-15", "runtime": 170,
            "credits": {"cast": [{"name": "Al Pacino"}],
                        "crew": [{"name": "Michael Mann", "job": "Director"}, {"name": "Art Linson", "job": "Producer"},
                                 {"name": "Some Grip", "job": "Grip"}]},
        }})
        ref = run(reference.for_match({"source": "tmdb", "media_id": "949", "media_type": "movie", "title": "Heat"}, None))
        assert ref["directors"] == ["Michael Mann"] and ref["crew"] == ["Art Linson"] and ref["year"] == 1995
        assert reference.seen == ["/3/movie/949"]

    def test_an_episode_match_brings_the_season_listing(self):
        reference = self._reference({
            "/3/find/tt1486217": {"tv_results": [{"id": 10283}]},
            "/3/tv/10283": {"name": "Archer", "first_air_date": "2009-09-17", "created_by": [{"name": "Adam Reed"}],
                            "aggregate_credits": {"cast": [{"name": "H. Jon Benjamin"}], "crew": []}},
            "/3/tv/10283/season/1": {"episodes": [
                {"episode_number": 1, "name": "Mole Hunt", "overview": "x", "guest_stars": [{"name": "A B"}]}]},
        })
        match = {"source": "omdb", "media_id": "tt1486217", "imdb_id": "tt1486217", "media_type": "episode", "title": "Archer"}
        ref = run(reference.for_match(match, 1))
        assert ref["episodes"] == [{"n": 1, "name": "Mole Hunt", "overview": "x", "guests": ["A B"]}]

    def test_without_a_key_nothing_is_fetched(self):
        assert run(TmdbReference("").for_match({"title": "Heat", "media_type": "movie"}, None)) is None


# --------------------------------------------------------------------------- queue service

def _queue(tmp_path, monkeypatch, built, name="title_t00.mkv"):
    source = tmp_path / "ingest" / "DISC" / name
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"video")
    monkeypatch.setattr("services.ingress_queue_service.settings.jellyfin_dest_base", str(tmp_path / "library"))
    service = IngressQueueService(content_verifier=built)
    item = service.add_manual_file(str(source), ingress_path=str(tmp_path / "ingest"))
    item.status = "needs_review"
    item.best_match = {"title": "Heat", "year": 1995, "media_type": "movie"}
    item.media_duration_ms = 170 * 60_000
    return service, item, source


class TestQueueService:
    def test_result_is_stored_and_nothing_else_changes(self, tmp_path, monkeypatch):
        service, item, _ = _queue(tmp_path, monkeypatch, verifier(HEAT, [frame("Directed by Ridley Scott")]))
        before = (item.status, dict(item.best_match), item.proposed_path, item.classification_override)

        result = run(service.refresh_content_verification(item.id))

        assert result["verdict"] == "veto"
        assert item.parsed_info["content_verification"] is result
        assert (item.status, item.best_match, item.proposed_path, item.classification_override) == before
        event = service.processing_history[-1]
        assert event["event"] == "content_verified" and event["content_verdict"] == "veto"

    def test_a_current_result_is_reused_unless_forced(self, tmp_path, monkeypatch):
        built = verifier(HEAT, [frame("HEAT")])
        service, item, _ = _queue(tmp_path, monkeypatch, built)

        run(service.refresh_content_verification(item.id))
        run(service.refresh_content_verification(item.id, force=False))
        assert len(built.gather_calls) == 1
        run(service.refresh_content_verification(item.id))  # the review button always checks again
        assert len(built.gather_calls) == 2

        item.best_match = {"title": "Heat", "year": 1986, "media_type": "movie"}  # re-matched since
        run(service.refresh_content_verification(item.id, force=False))
        assert len(built.gather_calls) == 3

    def test_a_missing_file_is_skipped_without_a_history_event(self, tmp_path, monkeypatch):
        service, item, source = _queue(tmp_path, monkeypatch, verifier(HEAT, [frame("HEAT")]))
        source.unlink()
        events = len(service.processing_history)

        assert run(service.refresh_content_verification(item.id)) is None
        assert "content_verification" not in (item.parsed_info or {})
        assert len(service.processing_history) == events

    def test_a_failed_check_is_recorded_not_raised(self, tmp_path, monkeypatch):
        service, item, _ = _queue(tmp_path, monkeypatch, verifier(HEAT, [{"zone": "head", "t": 5.0, "error": "timeout"}]))

        assert run(service.refresh_content_verification(item.id)) is None
        assert service.processing_history[-1]["event"] == "content_verification_failed"
        assert item.status == "needs_review"

    def test_candidates_are_review_items_on_disk_without_a_current_result_films_first(self, tmp_path, monkeypatch):
        service, film, _ = _queue(tmp_path, monkeypatch, verifier(HEAT, [frame("HEAT")]))
        ingest = tmp_path / "ingest"

        def add(name, status="needs_review", match=None, exists=True):
            path = ingest / "DISC" / name
            path.write_bytes(b"v")
            added = service.add_manual_file(str(path), ingress_path=str(ingest))
            added.status, added.best_match = status, match
            if not exists:
                path.unlink()
            return added

        episode = add("ep.mkv", match={"title": "Archer", "media_type": "episode", "season": 1, "episode": 2})
        unmatched = add("mystery.mkv")
        add("gone.mkv", match={"title": "Ghost", "media_type": "movie"}, exists=False)
        add("done.mkv", status="completed", match={"title": "Done", "media_type": "movie"})

        assert run(service.content_verify_candidates(10)) == [film.id, unmatched.id, episode.id]
        assert run(service.content_verify_candidates(1)) == [film.id]
        assert run(service.content_verify_candidates(10, exclude={film.id})) == [unmatched.id, episode.id]

        run(service.refresh_content_verification(film.id))
        assert run(service.content_verify_candidates(10)) == [unmatched.id, episode.id]


# --------------------------------------------------------------------------- background loop

class _LoopDone(Exception):
    pass


class TestLoop:
    def _run(self, monkeypatch, queue_service, hour, busy=False):
        async def stop(_seconds):
            raise _LoopDone

        monkeypatch.setattr(cv.settings, "content_verify_quiet_hours", "01:55-06:45")
        monkeypatch.setattr(cv.settings, "content_verify_batch_size", 2)

        async def go():
            # First sleep is the start-up delay; the second ends the test after one tick.
            sleeps = iter([None])

            async def sleep(seconds):
                if next(sleeps, "stop") == "stop":
                    await stop(seconds)

            monkeypatch.setattr(cv.asyncio, "sleep", sleep)
            await cv.run_content_verify_loop(
                queue_service, lambda: busy, now=lambda: datetime(2026, 11, 22, hour, 0)
            )

        with pytest.raises(_LoopDone):
            asyncio.run(go())

    def _service(self, results, mode="shadow"):
        checked = []

        async def candidates(limit, exclude=None):
            return [i for i in ["a", "b", "c"] if i not in (exclude or set())][:limit]

        async def refresh(item_id, force=True):
            checked.append((item_id, force))
            return results.get(item_id)

        service = SimpleNamespace(
            content_verifier=SimpleNamespace(runs_automatically=mode == "shadow"),
            content_verify_candidates=candidates, refresh_content_verification=refresh,
        )
        return service, checked

    def test_one_tick_checks_a_batch_without_forcing(self, monkeypatch):
        service, checked = self._service({"a": {"verdict": "confirm"}, "b": {"verdict": "veto"}})
        self._run(monkeypatch, service, hour=14)
        assert checked == [("a", False), ("b", False)]

    def test_idle_in_quiet_hours_and_while_ingest_is_processing(self, monkeypatch):
        service, checked = self._service({})
        self._run(monkeypatch, service, hour=3)
        self._run(monkeypatch, service, hour=14, busy=True)
        assert checked == []

    def test_loop_does_not_start_when_mode_is_off(self):
        service, checked = self._service({}, mode="off")
        asyncio.run(cv.run_content_verify_loop(service, lambda: False))
        assert checked == []


# --------------------------------------------------------------------------- routes

@pytest.fixture()
def app():
    from main import app as fastapi_app

    previous = getattr(fastapi_app.state, "ingress_queue_service", None)
    yield fastapi_app
    fastapi_app.state.ingress_queue_service = previous


def _route_service(result, known=True, mode="off"):
    async def hydrate(item_id):
        return {"id": item_id} if known else None

    async def refresh(item_id):
        return result

    async def report():
        return {"verified": 1, "verdicts": {"confirm": {"total": 1, "kept": 1, "changed": 0, "open": 0}}, "cases": []}

    return SimpleNamespace(
        content_verifier=SimpleNamespace(mode=mode), hydrate_item=hydrate,
        refresh_content_verification=refresh, get_content_verify_report=report,
    )


class TestRoutes:
    async def _post(self, app, item_id="item-1"):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            return await ac.post("/api/ingress/queue/content-verify", json={"itemId": item_id})

    @pytest.mark.asyncio
    async def test_runs_on_demand_even_when_the_mode_is_off(self, app):
        app.state.ingress_queue_service = _route_service({"verdict": "confirm", "evidence": ["Title on screen"]})
        resp = await self._post(app)
        assert resp.status_code == 200
        assert resp.json()["data"] == {"mode": "off", "verification": {"verdict": "confirm", "evidence": ["Title on screen"]}}

    @pytest.mark.asyncio
    async def test_unknown_item_is_404_and_an_uncheckable_file_is_422(self, app):
        app.state.ingress_queue_service = _route_service(None, known=False)
        assert (await self._post(app)).status_code == 404
        app.state.ingress_queue_service = _route_service(None)
        resp = await self._post(app)
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "CONTENT_VERIFY_FAILED"

    @pytest.mark.asyncio
    async def test_backend_without_a_verifier_is_503(self, app):
        app.state.ingress_queue_service = SimpleNamespace(content_verifier=None)
        resp = await self._post(app)
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "CONTENT_VERIFY_NOT_CONFIGURED"

    @pytest.mark.asyncio
    async def test_report_carries_the_mode(self, app):
        app.state.ingress_queue_service = _route_service(None, mode="shadow")
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/ingress/queue/content-verify-report")
        assert resp.status_code == 200
        assert resp.json()["data"]["mode"] == "shadow" and resp.json()["data"]["verified"] == 1

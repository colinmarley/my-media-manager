"""Phase 4 (plan/execute) of the ingest redesign: one PathBuilder for the
proposal and the organizer, and the known limits of the stored proposals.

See docs/architecture/INGEST_AUTOMATION_ANALYSIS_AND_REDESIGN.md, 6.7 and 7.
"""

import asyncio
import os
import shutil
from datetime import datetime, timezone

import pytest

from services import assignment_orchestrator as orchestrator_module
from services.assignment_orchestrator import AssignmentOrchestrator
from services.file_organization_service import FileOrganizationService
from services.ingress_queue_service import QUEUE_COMPLETED, IngressQueueService
from services.path_builder import (
    ROLE_EPISODE,
    ROLE_KEEP_NAME,
    ROLE_MAIN,
    ROLE_SPECIAL,
    ROLE_VERSION,
    PathBuilder,
    PathSpec,
)
from tests.test_ingress_queue_service import _add_reviewed, _Row, _use_library


class _MovingFilesystem:
    def __init__(self):
        self.moves = []

    def move_file(self, source, destination, merge_contents=False):
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.move(source, destination)
        self.moves.append((source, destination))
        return {'success': True}


class _RenamingEnrichment:
    """Enrichment that returns a different canonical title than the match.

    The organizer used to build the folder from this payload while the queue
    showed the match's title, so the accepted path and the executed one could
    differ.
    """

    def enrich_payload(self, **kwargs):
        return {'title': f"{kwargs.get('title')} (Remastered)", 'year': kwargs.get('year')}


def _real_pipeline(tmp_path, monkeypatch):
    library_root = _use_library(tmp_path, monkeypatch)
    monkeypatch.setattr(orchestrator_module, 'metadata_enrichment_service', _RenamingEnrichment())
    filesystem = _MovingFilesystem()
    organizer = FileOrganizationService(
        filesystem_manager=filesystem,
        jellyfin_dest_base=os.fspath(library_root),
    )
    orchestrator = AssignmentOrchestrator(file_organization_service=organizer, auto_organize_enabled=True)
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    return service, library_root, filesystem


def _in_library(library_root, relative):
    return os.path.join(os.fspath(library_root), *relative.split('/'))


# ---------------------------------------------------------------------------
# One PathBuilder: the proposal is where the file goes
# ---------------------------------------------------------------------------


def test_accepting_moves_each_file_exactly_to_its_proposal(tmp_path, monkeypatch):
    service, library_root, filesystem = _real_pipeline(tmp_path, monkeypatch)
    match = {'title': 'Some Movie', 'year': 2010, 'media_type': 'movie', 'imdb_id': 'tt0123456'}
    main = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000, match=match)
    extra = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'C1_t01.mkv', 600_000, match=None)
    asyncio.run(service.refresh_proposals())

    proposals = {main.id: main.proposed_path, extra.id: extra.proposed_path}
    assert proposals[main.id] == 'Movies/Some Movie (2010) [imdbid-tt0123456]/Some Movie (2010) [imdbid-tt0123456].mkv'
    assert proposals[extra.id] == 'Movies/Some Movie (2010) [imdbid-tt0123456]/Special Feature 1.mkv'

    for item in (main, extra):
        done = asyncio.run(service.mark_complete(item.id, manual_action=True))
        assert done.status == QUEUE_COMPLETED, done.last_error

    for item_id, relative in proposals.items():
        destination = _in_library(library_root, relative)
        assert os.path.isfile(destination), f'{relative} was proposed but not executed'
        assert os.path.normpath(service.items_by_id[item_id].proposed_path) == os.path.normpath(destination)
    # Nothing landed under the enrichment's "(Remastered)" title.
    assert [os.path.basename(d) for _, d in filesystem.moves] == [
        'Some Movie (2010) [imdbid-tt0123456].mkv',
        'Special Feature 1.mkv',
    ]


def test_accepted_episode_lands_on_its_proposal(tmp_path, monkeypatch):
    service, library_root, _ = _real_pipeline(tmp_path, monkeypatch)
    match = {'title': 'Some Show', 'year': 2002, 'media_type': 'episode', 'season': 2, 'episode': 5}
    item = _add_reviewed(service, tmp_path, 'Some Show S02', 'Some.Show.S02E05.mkv', 1_300_000, match=match)
    item.parsed_info = {'title': 'Some Show', 'season': 2, 'episode': 5, 'episode_title': 'Pilot Two'}
    asyncio.run(service.refresh_proposals())
    proposal = item.proposed_path
    assert proposal == 'TV Shows/Some Show (2002)/Season 02/Some Show (2002) S02E05 Pilot Two.mkv'

    done = asyncio.run(service.mark_complete(item.id, manual_action=True))

    assert done.status == QUEUE_COMPLETED, done.last_error
    assert os.path.isfile(_in_library(library_root, proposal))


def test_plan_takes_a_free_name_when_the_planned_file_exists(tmp_path, monkeypatch):
    service, library_root, _ = _real_pipeline(tmp_path, monkeypatch)
    match = {'title': 'Some Show', 'year': 2002, 'media_type': 'episode', 'season': 1, 'episode': 1}
    item = _add_reviewed(service, tmp_path, 'Some Show', 'Some.Show.S01E01.mkv', 1_300_000, match=match)
    item.parsed_info = {'title': 'Some Show', 'season': 1, 'episode': 1}
    taken = _in_library(library_root, 'TV Shows/Some Show (2002)/Season 01/Some Show (2002) S01E01.mkv')
    os.makedirs(os.path.dirname(taken))
    with open(taken, 'wb') as handle:
        handle.write(b'already here')

    done = asyncio.run(service.mark_complete(item.id, manual_action=True))

    assert done.status == QUEUE_COMPLETED, done.last_error
    expected = _in_library(
        library_root, 'TV Shows/Some Show (2002)/Season 01/Some Show (2002) S01E01 - Some.Show.S01E01.mkv'
    )
    assert os.path.normpath(done.proposed_path) == os.path.normpath(expected)
    assert os.path.isfile(expected)
    with open(taken, 'rb') as handle:
        assert handle.read() == b'already here', 'an existing file is never overwritten'


@pytest.mark.parametrize(
    'match, role, number, assignment_extra',
    [
        ({'title': 'Film', 'year': 1999, 'media_type': 'movie', 'imdb_id': 'tt0000001'}, ROLE_MAIN, None, {}),
        (
            {'title': 'Film', 'year': 1999, 'media_type': 'movie'},
            ROLE_VERSION,
            3,
            {'isAlternateVersion': True, 'versionNumber': 3},
        ),
        ({'title': 'Doc', 'year': 2020, 'media_type': 'documentary'}, ROLE_SPECIAL, 2, {'specialFeatureNumber': 2}),
        (
            {'title': 'Show', 'year': 2001, 'media_type': 'episode', 'season': 3, 'episode': 4, 'episode_end': 5},
            ROLE_MAIN,
            None,
            {'seasonNumber': 3, 'episodeNumber': 4, 'parsedInfo': {'episode_end': 5}},
        ),
    ],
)
def test_organizer_without_a_proposal_builds_the_same_path(tmp_path, match, role, number, assignment_extra):
    """An assignment that did not come through the queue still gets the path
    the queue would have proposed: both go through PathBuilder."""
    file_name = 'source.mkv'
    proposal = PathBuilder.relative_path(PathBuilder.spec_from_match(match, file_name, role, number))

    organizer = FileOrganizationService(jellyfin_dest_base='/library')
    media_type = 'episode' if match['media_type'] == 'episode' else match['media_type']
    media = {'title': match['title'], 'year': match['year'], 'imdbId': match.get('imdb_id')}
    if media_type == 'episode':
        media['seriesTitle'] = match['title']
    assignment = {'sourceFile': {'filePath': f'/ingest/x/{file_name}', 'fileName': file_name}, **assignment_extra}

    target_dir = organizer._calculate_jellyfin_path(media, assignment, media_type)
    file_part = organizer._build_jellyfin_filename(f'/ingest/x/{file_name}', target_dir, media_type, assignment, media)

    assert f'{target_dir}/{file_part}' == f'/library/{proposal}'


def test_path_builder_spells_each_role():
    def path(**kw):
        defaults = dict(media_type='movie', title='A: Film?', year=2001, extension='.mkv')
        defaults.update(kw)
        return PathBuilder.relative_path(PathSpec(**defaults))

    assert path() == 'Movies/A Film (2001)/A Film (2001).mkv'
    assert path(role=ROLE_VERSION, number=2) == 'Movies/A Film (2001)/A Film (2001) - Version 2.mkv'
    assert path(role=ROLE_SPECIAL, number=4) == 'Movies/A Film (2001)/Special Feature 4.mkv'
    assert path(imdb_id='not-an-id') == 'Movies/A Film (2001)/A Film (2001).mkv'
    assert path(media_type='episode', title='Show', role=ROLE_EPISODE, season=0, episode=1) == (
        'TV Shows/Show (2001)/Specials/Show (2001) S00E01.mkv'
    )
    # Absolute numbering (no season) goes to Season 01; an unknown episode
    # keeps its own name in Season 00.
    assert path(media_type='episode', title='Show', role=ROLE_EPISODE, episode=12) == (
        'TV Shows/Show (2001)/Season 01/Show (2001) E012.mkv'
    )
    assert path(media_type='episode', title='Show', role=ROLE_KEEP_NAME, original_name='t01.mkv') == (
        'TV Shows/Show (2001)/Season 00/t01.mkv'
    )
    assert path(media_type='home_video') is None


# ---------------------------------------------------------------------------
# Known limit: special-feature numbers from two passes collided
# ---------------------------------------------------------------------------


def test_title_group_and_companion_specials_get_distinct_numbers(tmp_path, monkeypatch):
    _use_library(tmp_path, monkeypatch)
    service = IngressQueueService()
    main = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000)
    # Matched to the same title and shorter: a special from the title group.
    featurette = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie featurette.mkv', 900_000)
    # Unmatched companions in the folder: specials from the companion pass.
    extra_a = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'C1_t01.mkv', 600_000, match=None)
    extra_b = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'C1_t02.mkv', 300_000, match=None)

    asyncio.run(service.refresh_proposals())

    assert main.proposed_path == 'Movies/Some Movie (2010)/Some Movie (2010).mkv'
    specials = [featurette.proposed_path, extra_a.proposed_path, extra_b.proposed_path]
    assert specials == [
        'Movies/Some Movie (2010)/Special Feature 1.mkv',
        'Movies/Some Movie (2010)/Special Feature 2.mkv',
        'Movies/Some Movie (2010)/Special Feature 3.mkv',
    ]
    assert [featurette.special_feature_number, extra_a.special_feature_number, extra_b.special_feature_number] == [
        1,
        2,
        3,
    ]


def test_specials_number_past_disk_and_past_organized_items(tmp_path, monkeypatch):
    library_root = _use_library(tmp_path, monkeypatch)
    folder = library_root / 'Movies' / 'Some Movie (2010)'
    folder.mkdir(parents=True)
    (folder / 'Some Movie (2010).mkv').write_bytes(b'x')
    (folder / 'Special Feature 1.mkv').write_bytes(b'x')

    service = IngressQueueService()
    monkeypatch.setattr('services.ingress_queue_service._get_file_duration', lambda path: 7_000_000)
    # Organized in this run but, say, still being copied: number 2 is taken.
    done = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010) extra.mkv', 500_000)
    done.status = QUEUE_COMPLETED
    done.proposed_path = os.fspath(folder / 'Special Feature 2.mkv')
    shorter = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010) short.mkv', 400_000)
    companion = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'C1_t03.mkv', 300_000, match=None)

    asyncio.run(service.refresh_proposals())

    assert shorter.proposed_path == 'Movies/Some Movie (2010)/Special Feature 3.mkv'
    assert companion.proposed_path == 'Movies/Some Movie (2010)/Special Feature 4.mkv'


# ---------------------------------------------------------------------------
# Known limit: a source folder holding videos was moved to Unprocessed
# ---------------------------------------------------------------------------


def test_source_folder_with_videos_stays_in_place_after_accept(tmp_path, monkeypatch):
    service, library_root, _ = _real_pipeline(tmp_path, monkeypatch)
    main = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000)
    # A video the queue does not track (not detected yet, or never queued).
    untracked = tmp_path / 'ingest' / 'Some Movie (2010)' / 'bonus.mkv'
    untracked.write_bytes(b'x')

    done = asyncio.run(service.mark_complete(main.id, manual_action=True))

    assert done.status == QUEUE_COMPLETED, done.last_error
    assert untracked.is_file(), 'the leftover video stays in its source folder'
    assert not (library_root / 'Unprocessed').exists()


def test_source_folder_with_only_sidecars_is_merged_and_removed(tmp_path, monkeypatch):
    service, library_root, _ = _real_pipeline(tmp_path, monkeypatch)
    main = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000)
    sidecar = tmp_path / 'ingest' / 'Some Movie (2010)' / 'Some Movie (2010).en.srt'
    sidecar.write_bytes(b'1')

    asyncio.run(service.mark_complete(main.id, manual_action=True))

    assert not (tmp_path / 'ingest' / 'Some Movie (2010)').exists()
    assert (library_root / 'Movies' / 'Some Movie (2010)' / 'Some Movie (2010).en.srt').is_file()
    assert not (library_root / 'Unprocessed').exists()


# ---------------------------------------------------------------------------
# Known limit: completed anchors were lost on restart
# ---------------------------------------------------------------------------


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _SequencedSession:
    """Answers each execute() with the next canned result, in order."""

    def __init__(self, results):
        self.results = results

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, _query):
        return _Result(self.results.pop(0))


def test_restart_keeps_the_organized_movie_as_anchor_for_its_extras(tmp_path, monkeypatch):
    library_root = _use_library(tmp_path, monkeypatch)
    ingest = tmp_path / 'ingest'
    source = ingest / 'Some Movie (2010)'
    source.mkdir(parents=True)
    extra_file = source / 'C1_t01.mkv'
    extra_file.write_bytes(b'x')
    organized = library_root / 'Movies' / 'Some Movie (2010)' / 'Some Movie (2010).mkv'
    organized.parent.mkdir(parents=True)
    organized.write_bytes(b'x')
    # Organized before the restart; its source path no longer exists.
    main_source = os.fspath(source / 'Some Movie (2010).mkv')
    newer = datetime(2026, 11, 9, tzinfo=timezone.utc)

    open_row = _Row(
        id='extra', file_path=os.fspath(extra_file), file_name=extra_file.name, ingress_path=os.fspath(ingest),
        queued_at=newer, parsed_info={'title': 'C1_t01'}, media_duration_ms=600_000,
    )
    main_row = _Row(
        id='main', file_path=main_source, file_name='Some Movie (2010).mkv', ingress_path=os.fspath(ingest),
        status=QUEUE_COMPLETED, queued_at=newer, parsed_info={'title': 'Some Movie'},
        best_match={'title': 'Some Movie', 'year': 2010, 'media_type': 'movie'},
        proposed_path=os.fspath(organized), media_duration_ms=7_000_000,
    )
    unrelated = _Row(
        id='other', file_path=os.fspath(ingest / 'Other (2001)' / 'Other (2001).mkv'), ingress_path=os.fspath(ingest),
        status=QUEUE_COMPLETED, best_match={'title': 'Other', 'year': 2001, 'media_type': 'movie'},
        proposed_path=os.fspath(library_root / 'Movies' / 'Other (2001)' / 'Other (2001).mkv'),
    )
    results = [
        [open_row],  # open rows
        [(row.id, row.file_path, row.ingress_path) for row in (main_row, unrelated)],  # completed keys
        [main_row],  # completed rows in the open items' folders
    ]
    service = IngressQueueService(db_session_factory=lambda: _SequencedSession(results))
    monkeypatch.setattr('services.ingress_queue_service._get_file_duration', lambda path: 7_000_000)

    assert asyncio.run(service.restore_from_db()) == 1
    assert service.items_by_id['main'].status == QUEUE_COMPLETED
    assert 'other' not in service.items_by_id, 'only anchors of waiting files are loaded'

    asyncio.run(service.refresh_proposals())

    extra = service.items_by_id['extra']
    assert extra.proposed_path == 'Movies/Some Movie (2010)/Special Feature 1.mkv'
    assert service.items_by_id['main'].proposed_path == os.fspath(organized), 'an anchor is never rewritten'

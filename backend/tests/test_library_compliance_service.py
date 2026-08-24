from types import SimpleNamespace

import pytest

from services.library_compliance_service import LibraryComplianceService


def _mk_service() -> LibraryComplianceService:
    return LibraryComplianceService(db_session_factory=None, file_manager=SimpleNamespace())


def test_discover_show_folders_detects_series_roots(tmp_path):
    root = tmp_path / "Shows"
    root.mkdir()

    show_a = root / "Show A (2024)"
    show_a.mkdir()
    (show_a / "Season 01").mkdir()

    show_b = root / "Show B (2025)"
    show_b.mkdir()
    (show_b / "Specials").mkdir()

    non_show = root / "Movie Folder"
    non_show.mkdir()
    (non_show / "Movie Folder (2022).mkv").write_bytes(b"a")

    service = _mk_service()
    discovered = service._discover_show_folders(str(root))

    assert str(show_a) in discovered
    assert str(show_b) in discovered
    assert str(non_show) not in discovered


def test_analyze_show_folder_has_no_findings_when_compliant(tmp_path):
    show = tmp_path / "Series Name (2024)"
    season = show / "Season 01"
    specials = show / "Specials"
    season.mkdir(parents=True)
    specials.mkdir(parents=True)

    (season / "Series Name (2024) S01E01.mkv").write_bytes(b"a")
    (specials / "Series Name (2024) S00E01.mkv").write_bytes(b"b")

    service = _mk_service()
    findings = service._analyze_show_folder(str(show), media_type="series")

    assert findings == []


def test_analyze_show_folder_flags_season_folder_naming_mismatch(tmp_path):
    show = tmp_path / "Series Name (2024)"
    season = show / "S1"
    season.mkdir(parents=True)
    (season / "Series Name (2024) S01E01.mkv").write_bytes(b"a")

    service = _mk_service()
    findings = service._analyze_show_folder(str(show), media_type="series")

    by_type = {f["issueType"]: f for f in findings}
    assert "season_folder_naming_mismatch" in by_type
    action = by_type["season_folder_naming_mismatch"]["actions"][0]
    assert action["actionType"] == "rename"
    assert action["targetPath"].endswith("Season 01")


def test_analyze_show_folder_flags_episode_and_unknown_patterns(tmp_path):
    show = tmp_path / "Series Name (2024)"
    season = show / "Season 02"
    season.mkdir(parents=True)
    (season / "Series Name Finale.mkv").write_bytes(b"a")
    (season / "Series Name Unknown Episode.mkv").write_bytes(b"b")

    service = _mk_service()
    findings = service._analyze_show_folder(str(show), media_type="series")

    issue_types = [f["issueType"] for f in findings]
    assert "episode_naming_mismatch" in issue_types
    assert "unknown_episode_pattern" in issue_types


def test_analyze_show_folder_flags_s00_in_non_specials_and_suggests_move(tmp_path):
    show = tmp_path / "Series Name (2024)"
    season = show / "Season 01"
    season.mkdir(parents=True)
    s00_file = season / "Series Name (2024) S00E03.mkv"
    s00_file.write_bytes(b"a")

    service = _mk_service()
    findings = service._analyze_show_folder(str(show), media_type="series")

    matching = [f for f in findings if f["issueType"] == "specials_misplaced"]
    assert matching
    move_action = matching[0]["actions"][0]
    assert move_action["actionType"] == "move"
    assert "/Specials/" in move_action["targetPath"].replace("\\", "/")


def test_analyze_show_folder_flags_invalid_specials_filename(tmp_path):
    show = tmp_path / "Series Name (2024)"
    specials = show / "Specials"
    specials.mkdir(parents=True)
    (specials / "Behind The Scenes.mkv").write_bytes(b"a")

    service = _mk_service()
    findings = service._analyze_show_folder(str(show), media_type="series")

    matching = [f for f in findings if f["issueType"] == "specials_misplaced"]
    assert matching
    assert matching[0]["actions"][0]["actionType"] == "noop"


def test_analyze_movie_folder_flags_multiple_issue_types(tmp_path):
    movie = tmp_path / "Movie Name"
    movie.mkdir(parents=True)

    main = movie / "Movie Name copy 1.mkv"
    alt = movie / "Movie Name copy 2.mkv"
    extra = movie / "Making Of Featurette.mkv"

    main.write_bytes(b"a" * 100)
    alt.write_bytes(b"b" * 90)
    extra.write_bytes(b"c" * 20)

    service = _mk_service()
    findings = service._analyze_movie_folder(str(movie), media_type="movie")

    issue_types = [f["issueType"] for f in findings]
    assert "duplicate_main_feature" in issue_types
    assert "misplaced_special_feature" in issue_types
    assert "naming_mismatch" in issue_types


def test_duplicate_main_feature_uses_quality_tagged_renames(tmp_path, monkeypatch):
    movie = tmp_path / "Movie Name (2024)"
    movie.mkdir(parents=True)

    primary = movie / "Movie Name (2024) - Cut A.mkv"
    secondary = movie / "Movie Name (2024) - Cut B.mkv"
    primary.write_bytes(b"a" * 100)
    secondary.write_bytes(b"b" * 90)

    service = _mk_service()

    def fake_quality(path: str) -> str:
        if path.endswith("Cut A.mkv"):
            return "1080p"
        if path.endswith("Cut B.mkv"):
            return "720p"
        return "Unknown"

    monkeypatch.setattr(service, "_quality_label_for_file", fake_quality)

    findings = service._analyze_movie_folder(str(movie), media_type="movie")
    duplicate = next(f for f in findings if f["issueType"] == "duplicate_main_feature")

    rename_actions = [a for a in duplicate["actions"] if a["actionType"] == "rename"]
    noop_actions = [a for a in duplicate["actions"] if a["actionType"] == "noop"]
    assert len(rename_actions) == 2
    assert len(noop_actions) == 1
    assert any(a["targetPath"].endswith("[1080p].mkv") for a in rename_actions)
    assert any(a["targetPath"].endswith("[720p].mkv") for a in rename_actions)
    assert all(a["selected"] is True for a in rename_actions)
    assert noop_actions[0]["selected"] is False
    assert duplicate["currentState"]["primaryQuality"] == "1080p"
    assert duplicate["currentState"]["secondaryQuality"] == "720p"


def test_analyze_movie_folder_naming_mismatch_unique_targets(tmp_path):
    """Multiple mismatched files in the same folder must not get identical proposed target paths."""
    movie = tmp_path / "Featurettes"
    movie.mkdir(parents=True)

    (movie / "behind_the_scenes.mkv").write_bytes(b"a" * 50)
    (movie / "interview.mkv").write_bytes(b"b" * 50)
    (movie / "making_of_doc.mkv").write_bytes(b"c" * 50)

    service = _mk_service()
    findings = service._analyze_movie_folder(str(movie), media_type="movie")

    rename_targets = [
        a["targetPath"]
        for f in findings
        for a in f.get("actions", [])
        if a["actionType"] == "rename"
    ]

    assert len(rename_targets) == len(set(rename_targets)), (
        f"Duplicate target paths proposed: {rename_targets}"
    )


def test_misplaced_special_feature_clamps_target_to_single_level_under_title(tmp_path):
    movie = tmp_path / "Taking Lives (2004) [imdbid-tt0364045]"
    nested = movie / "Featurettes" / "Extras" / "Extras"
    nested.mkdir(parents=True)
    source = nested / "Featurettes.mkv"
    source.write_bytes(b"x" * 20)

    service = _mk_service()
    findings = service._analyze_movie_folder(str(nested), media_type="movie")

    misplaced = next(f for f in findings if f["issueType"] == "misplaced_special_feature")
    move_action = misplaced["actions"][0]
    expected_target = movie / "Featurettes" / "Featurettes.mkv"

    assert move_action["targetPath"] == str(expected_target)
    assert "/Featurettes/Extras/" not in move_action["targetPath"].replace("\\", "/")


def test_special_feature_in_single_level_extras_subfolder_is_not_flagged(tmp_path):
    movie = tmp_path / "Taking Lives (2004) [imdbid-tt0364045]"
    featurettes = movie / "Featurettes"
    featurettes.mkdir(parents=True)
    (featurettes / "Featurettes.mkv").write_bytes(b"x" * 20)

    service = _mk_service()
    findings = service._analyze_movie_folder(str(featurettes), media_type="movie")

    issue_types = [f["issueType"] for f in findings]
    assert "misplaced_special_feature" not in issue_types


def test_scan_wide_claims_prevent_cross_folder_target_collisions(tmp_path):
    claimed: set = set()
    base = str(tmp_path / "Taking Lives (2004) [imdbid-tt0364045]" / "Featurettes" / "Featurettes.mkv")

    first = LibraryComplianceService._unique_target_path(base, claimed)
    second = LibraryComplianceService._unique_target_path(base, claimed)

    assert first.endswith("Featurettes.mkv")
    assert second.endswith("Featurettes (1).mkv")


def test_title_folder_makemkv_companion_not_treated_as_duplicate_main(tmp_path):
    movie = tmp_path / "The Royal Tenenbaums (2002) [imdbid-tt0265666]"
    movie.mkdir(parents=True)
    (movie / "The Royal Tenenbaums (2002) [imdbid-tt0265666].mkv").write_bytes(b"a" * 100)
    (movie / "The Royal Tenenbaums (2002) [imdbid-tt0265666] - PD5_t00.mkv").write_bytes(b"b" * 90)

    service = _mk_service()
    findings = service._analyze_movie_folder(str(movie), media_type="movie")

    issue_types = [f["issueType"] for f in findings]
    assert "duplicate_main_feature" not in issue_types
    assert "misplaced_special_feature" in issue_types


def test_featurettes_folder_does_not_emit_duplicate_or_main_naming_mismatch(tmp_path):
    movie = tmp_path / "Eight Legged Freaks (2002) [imdbid-tt0271367]"
    featurettes = movie / "Featurettes"
    featurettes.mkdir(parents=True)
    (featurettes / "EIGHT LEGGED FREAKS-C2 t01.mkv").write_bytes(b"a" * 100)
    (featurettes / "EIGHT LEGGED FREAKS-A1 t06.mkv").write_bytes(b"b" * 90)

    service = _mk_service()
    findings = service._analyze_movie_folder(str(featurettes), media_type="movie")
    issue_types = [f["issueType"] for f in findings]

    assert "duplicate_main_feature" not in issue_types
    assert "naming_mismatch" not in issue_types


def test_extras_folder_with_movie_named_file_skips_main_feature_naming_mismatch(tmp_path):
    movie = tmp_path / "Rain Man (1988) [imdbid-tt0095953]"
    featurettes = movie / "Featurettes"
    featurettes.mkdir(parents=True)
    (featurettes / "Rain Man 1988 (1988).mkv").write_bytes(b"a" * 50)

    service = _mk_service()
    findings = service._analyze_movie_folder(str(featurettes), media_type="movie")

    assert all(f["issueType"] != "naming_mismatch" for f in findings)


def test_unique_target_path_increments_on_collision(tmp_path):
    """_unique_target_path appends a counter when the base path is already claimed or on disk."""
    base = str(tmp_path / "Movie.mkv")
    claimed: set = set()

    first = LibraryComplianceService._unique_target_path(base, claimed)
    assert first == base

    second = LibraryComplianceService._unique_target_path(base, claimed)
    assert second == str(tmp_path / "Movie (1).mkv")

    third = LibraryComplianceService._unique_target_path(base, claimed)
    assert third == str(tmp_path / "Movie (2).mkv")


def test_unique_target_path_skips_existing_file(tmp_path):
    """_unique_target_path skips paths that already exist on disk even if not claimed."""
    existing = tmp_path / "Movie.mkv"
    existing.write_bytes(b"x")

    claimed: set = set()
    result = LibraryComplianceService._unique_target_path(str(existing), claimed)
    assert result == str(tmp_path / "Movie (1).mkv")


class _FakeSession:
    def __init__(self):
        self.added = []
        self.flush_calls = 0
        self.commit_calls = 0
        self.rollback_calls = 0

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flush_calls += 1

    async def commit(self):
        self.commit_calls += 1

    async def rollback(self):
        self.rollback_calls += 1


class _FakeSessionFactory:
    def __init__(self):
        self.session = _FakeSession()

    def __call__(self):
        return self

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_persist_findings_flushes_parent_before_actions():
    session_factory = _FakeSessionFactory()
    service = LibraryComplianceService(
        db_session_factory=session_factory,
        file_manager=SimpleNamespace(),
    )

    findings = [
        {
            "mediaType": "movie",
            "folderPath": "/library/Movie",
            "issueType": "misplaced_special_feature",
            "actions": [
                {
                    "actionType": "move",
                    "sourcePath": "/library/Movie/extra.mkv",
                    "targetPath": "/library/Movie/Extras/extra.mkv",
                    "selected": True,
                }
            ],
        }
    ]

    await service._persist_findings("scan-1", findings)

    added_types = [type(item).__name__ for item in session_factory.session.added]
    assert added_types == ["ComplianceFinding", "ComplianceAction"]
    assert session_factory.session.flush_calls == 1
    assert session_factory.session.commit_calls == 1

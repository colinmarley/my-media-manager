"""Startup folder bootstrap and the persisted ingress runtime config."""

import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from config.settings import settings
from services import storage_paths


@pytest.fixture(autouse=True)
def _reset_overrides():
    storage_paths.clear_overrides()
    yield
    storage_paths.clear_overrides()


def test_bootstrap_creates_only_the_four_category_folders(tmp_path):
    from main import bootstrap_library_folders

    created = bootstrap_library_folders(os.fspath(tmp_path))

    expected = [
        settings.folder_movies,
        settings.folder_tv_shows,
        settings.folder_documentaries,
        settings.folder_live_performances,
    ]
    assert sorted(os.listdir(tmp_path)) == sorted(expected)
    assert [os.path.basename(path) for path in created] == expected
    for limbo in ("_NeedsReview", "Series", "Home Videos", "ingest", settings.folder_needs_review):
        assert not (tmp_path / limbo).exists()


def test_bootstrap_uses_configured_folder_names(tmp_path, monkeypatch):
    from main import bootstrap_library_folders

    monkeypatch.setattr(settings, "folder_movies", "Films")
    bootstrap_library_folders(os.fspath(tmp_path))
    assert (tmp_path / "Films").is_dir()
    assert not (tmp_path / "Movies").exists()


def test_apply_runtime_config_routes_paths_through_the_resolver(monkeypatch):
    from api.ingress_operations import apply_runtime_config

    monkeypatch.setattr(settings, "jellyfin_dest_base", "/ark/media/jellyfin")
    queue = SimpleNamespace(auto_assign_threshold=80)
    matcher = MagicMock()
    state = SimpleNamespace(
        ingress_runtime_config={"autoAssignThreshold": 80, "jellyfinDestBase": "/ark/media/jellyfin"},
        ingress_queue_service=queue,
        auto_matcher_service=matcher,
    )

    runtime = apply_runtime_config(state, {
        "jellyfinDestBase": "/new/library/",
        "defaultIngressPaths": ["/new/ingest"],
        "autoAssignThreshold": 90,
        "defaultMetadataSource": "omdb",
        "unknownKey": "dropped",
    })

    assert storage_paths.library_root() == "/new/library"
    assert storage_paths.ingest_roots() == ["/new/ingest"]
    assert runtime["jellyfinDestBase"] == "/new/library"
    assert runtime["defaultIngressPaths"] == ["/new/ingest"]
    assert "unknownKey" not in runtime
    assert queue.auto_assign_threshold == 90
    matcher.set_metadata_source.assert_called_once_with("omdb")


def test_apply_runtime_config_without_overrides_keeps_settings(monkeypatch):
    from api.ingress_operations import apply_runtime_config

    monkeypatch.setattr(settings, "jellyfin_dest_base", "/env/library")
    monkeypatch.setattr(settings, "ingress_default_paths", ["/env/ingest"])
    state = SimpleNamespace(ingress_runtime_config={})
    runtime = apply_runtime_config(state, {})
    assert runtime["jellyfinDestBase"] == "/env/library"
    assert runtime["defaultIngressPaths"] == ["/env/ingest"]


def _config_db(stored):
    row = None
    if stored is not None:
        row = MagicMock()
        row.value = json.dumps(stored)
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = row
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    return db, row


@pytest.mark.asyncio
async def test_put_config_persists_only_sent_fields_and_applies_the_root(monkeypatch):
    from db.database import get_db
    from main import app

    monkeypatch.setattr(settings, "jellyfin_dest_base", "/ark/media/jellyfin")
    db, row = _config_db({"autoAssignThreshold": 70})

    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    saved_state = {
        name: getattr(app.state, name, None)
        for name in ("ingress_runtime_config", "ingress_queue_service", "auto_matcher_service")
    }
    app.state.ingress_runtime_config = {"autoAssignThreshold": 70}
    app.state.ingress_queue_service = SimpleNamespace(auto_assign_threshold=70)
    app.state.auto_matcher_service = None
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.put("/api/ingress/config", json={"jellyfinDestBase": "/mnt/lib/"})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["jellyfinDestBase"] == "/mnt/lib"
        assert json.loads(row.value) == {"autoAssignThreshold": 70, "jellyfinDestBase": "/mnt/lib"}
        db.commit.assert_awaited()
        assert storage_paths.library_root() == "/mnt/lib"
    finally:
        app.dependency_overrides.clear()
        for name, value in saved_state.items():
            setattr(app.state, name, value)


@pytest.mark.asyncio
async def test_health_no_longer_checks_a_needs_review_folder(tmp_path, monkeypatch):
    from main import app

    monkeypatch.setattr(settings, "jellyfin_dest_base", os.fspath(tmp_path))
    monkeypatch.setattr(settings, "nas_host", "")
    saved = getattr(app.state, "ingress_runtime_config", None)
    app.state.ingress_runtime_config = {"defaultIngressPaths": [os.fspath(tmp_path)]}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/ingress/health")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert set(data) == {"ingress_paths", "destination", "nas", "typed_folders", "healthy"}
        names = [folder["name"] for folder in data["typed_folders"]]
        assert names == storage_paths.category_folders()
        assert settings.folder_needs_review not in names
        assert set(data["typed_folders"][0]) == {"name", "path", "exists", "writable"}
    finally:
        app.state.ingress_runtime_config = saved

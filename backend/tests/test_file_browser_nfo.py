import pytest

from api import file_browser


@pytest.mark.asyncio
async def test_read_nfo_includes_root_attributes_only(tmp_path, monkeypatch):
    monkeypatch.setattr(file_browser.settings, "jellyfin_dest_base", str(tmp_path))
    folder = tmp_path / "Movie (2020)"
    folder.mkdir()
    (folder / "movie.nfo").write_text(
        '<movie lockdata="true"><title>Movie</title>'
        '<uniqueid type="imdb">tt123</uniqueid>'
        '<actor kind="lead"><name>A</name></actor></movie>'
    )

    result = await file_browser.read_nfo_from_folder(
        file_browser.NfoRequest(folderPath=str(folder))
    )

    assert result["success"] is True
    assert result["data"] == {
        "movie": {
            "title": "Movie",
            "uniqueid": "tt123",
            "actor": {"name": "A"},
            "lockdata": "true",
        }
    }

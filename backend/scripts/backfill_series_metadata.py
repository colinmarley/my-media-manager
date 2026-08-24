import asyncio
import os
import re
from typing import Dict, Any

from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import Series

VIDEO_EXTENSIONS = {
    ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".flv",
    ".webm", ".m2ts", ".mts", ".ts", ".mpg", ".mpeg", ".iso", ".strm",
}


def canonical_series_root(path: str) -> str:
    leaf = os.path.basename(path.rstrip("/"))
    if re.match(r"^Season\s+\d+$", leaf, re.IGNORECASE):
        return os.path.dirname(path.rstrip("/"))
    return path


def summarize_series_files(series_root_path: str) -> Dict[str, Any]:
    total_files = 0
    seasons_with_files = set()
    episodes_with_files = set()
    season_dirs = set()

    if not os.path.isdir(series_root_path):
        return {
            "assignmentSummary": {
                "totalFiles": 0,
                "assignedFiles": 0,
                "unassignedFiles": 0,
                "seasonsWithFiles": 0,
                "episodesWithFiles": 0,
            },
            "seriesSummary": {
                "totalSeasons": 0,
                "totalEpisodes": 0,
            },
        }

    for root, dirs, files in os.walk(series_root_path):
        for d in dirs:
            m = re.match(r"^Season\s+(\d+)$", d, re.IGNORECASE)
            if m:
                season_dirs.add(int(m.group(1)))

        for file_name in files:
            ext = os.path.splitext(file_name)[1].lower()
            if ext not in VIDEO_EXTENSIONS:
                continue

            total_files += 1
            normalized_root = root.replace("\\", "/")

            season_from_path = None
            m_path = re.search(r"/Season\s+(\d+)(?:/|$)", normalized_root, re.IGNORECASE)
            if m_path:
                season_from_path = int(m_path.group(1))
                seasons_with_files.add(season_from_path)

            m_episode = re.search(r"[Ss](\d{1,2})[Ee](\d{1,3})", file_name)
            if m_episode:
                season_num = int(m_episode.group(1))
                episode_num = int(m_episode.group(2))
                seasons_with_files.add(season_num)
                episodes_with_files.add((season_num, episode_num))
            elif season_from_path is not None:
                episodes_with_files.add((season_from_path, total_files))

    total_seasons = max(len(season_dirs), len(seasons_with_files))
    total_episodes = len(episodes_with_files)

    return {
        "assignmentSummary": {
            "totalFiles": total_files,
            "assignedFiles": total_files,
            "unassignedFiles": 0,
            "seasonsWithFiles": len(seasons_with_files),
            "episodesWithFiles": total_episodes,
        },
        "seriesSummary": {
            "totalSeasons": total_seasons,
            "totalEpisodes": total_episodes,
        },
    }


async def main() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Series))
        rows = result.scalars().all()

        updated = 0
        skipped = 0

        for row in rows:
            raw = dict(row.raw_data or {})
            existing_folder = raw.get("folderPath") or (row.jellyfin_info or {}).get("folderPath")
            if not existing_folder or not os.path.isdir(existing_folder):
                skipped += 1
                continue

            canonical_root = canonical_series_root(existing_folder)
            summary_data = summarize_series_files(canonical_root)
            assignment_summary = summary_data["assignmentSummary"]
            series_summary = summary_data["seriesSummary"]

            jellyfin_info = dict(row.jellyfin_info or {})
            jellyfin_info["folderPath"] = canonical_root
            jellyfin_info["isOrganized"] = True

            raw["id"] = row.id
            raw["title"] = row.title
            raw["titleLower"] = (row.title or "").lower()
            raw["mediaType"] = "series"
            raw["folderPath"] = canonical_root
            raw["jellyfinInfo"] = jellyfin_info
            raw["assignmentSummary"] = assignment_summary
            raw["seriesSummary"] = series_summary
            raw["fileCount"] = int(assignment_summary.get("totalFiles") or 0)

            row.raw_data = raw
            row.jellyfin_info = jellyfin_info
            row.assignment_summary = assignment_summary
            row.series_summary = series_summary
            updated += 1

        await session.commit()

    print(f"Series metadata backfill complete: updated={updated}, skipped={skipped}")


if __name__ == "__main__":
    asyncio.run(main())

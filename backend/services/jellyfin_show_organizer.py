import os
import re
import shutil
from typing import Dict, List, Optional


def _load_settings_values() -> Dict[str, object]:
    try:
        from config.settings import settings  # pylint: disable=import-outside-toplevel

        return {
            "jellyfin_dest_base": settings.jellyfin_dest_base,
            "folder_tv_shows": settings.folder_tv_shows,
        }
    except Exception:
        return {
            "jellyfin_dest_base": "/ark/media/jellyfin",
            "folder_tv_shows": "TV Shows",
        }


class JellyfinShowOrganizer:
    """Reorganize processed TV show folders into Jellyfin-compliant layouts."""

    VIDEO_EXTENSIONS = {
        ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".flv",
        ".webm", ".m2ts", ".mts", ".ts", ".mpg", ".mpeg", ".iso", ".strm",
    }
    AUDIO_EXTENSIONS = {
        ".mp3", ".flac", ".wav", ".aac", ".ogg", ".m4a", ".opus", ".wma",
    }

    EXTRA_FOLDERS: Dict[str, str] = {
        "behind the scenes": "behind the scenes",
        "behindthescenes": "behind the scenes",
        "deleted scenes": "deleted scenes",
        "deletedscenes": "deleted scenes",
        "interviews": "interviews",
        "interview": "interviews",
        "scenes": "scenes",
        "scene": "scenes",
        "samples": "samples",
        "sample": "samples",
        "shorts": "shorts",
        "short": "shorts",
        "featurettes": "featurettes",
        "featurette": "featurettes",
        "clips": "clips",
        "clip": "clips",
        "other": "other",
        "extras": "extras",
        "extra": "extras",
        "trailers": "trailers",
        "trailer": "trailers",
        "theme-music": "theme-music",
        "thememusic": "theme-music",
        "backdrops": "backdrops",
        "backdrop": "backdrops",
    }

    EXTRA_SUFFIX_TO_FOLDER: Dict[str, str] = {
        "trailer": "trailers",
        "sample": "samples",
        "scene": "scenes",
        "clip": "clips",
        "interview": "interviews",
        "behindthescenes": "behind the scenes",
        "deleted": "deleted scenes",
        "deletedscene": "deleted scenes",
        "featurette": "featurettes",
        "short": "shorts",
        "other": "other",
        "extra": "extras",
    }

    PART_PATTERN = re.compile(
        r"(?:[ ._-]|^)(cd|dvd|part|pt|disc|disk)[ ._-]*([0-9]+|[a-d])$",
        re.IGNORECASE,
    )
    EPISODE_PATTERN = re.compile(
        r"(?:^|[ ._-])S?(\d{1,2})[EX](\d{1,3})(?:\s*[-_]?\s*(?:E)?(\d{1,3}))?",
        re.IGNORECASE,
    )
    ALT_EPISODE_PATTERN = re.compile(
        r"(?:^|[ ._-])(\d{1,2})x(\d{1,3})(?:\s*[-_]?\s*(\d{1,3}))?",
        re.IGNORECASE,
    )
    SEASON_DIR_PATTERN = re.compile(r"^Season\s*(\d+)$", re.IGNORECASE)

    def __init__(self, dry_run: bool = True):
        self.dry_run = dry_run
        settings_values = _load_settings_values()
        self.jellyfin_dest_base = str(settings_values["jellyfin_dest_base"])
        self.folder_tv_shows = str(settings_values["folder_tv_shows"])

    def list_supported_categories(self) -> List[str]:
        return [
            "episode",
            "special",
            "trailers",
            "samples",
            "featurettes",
            "behind the scenes",
            "deleted scenes",
            "interviews",
            "scenes",
            "clips",
            "shorts",
            "other",
            "extras",
            "theme-music",
            "backdrops",
        ]

    def preview_show_folder(
        self,
        folder_path: str,
        overrides: Optional[List[Dict[str, object]]] = None,
    ) -> Dict[str, object]:
        return self._build_show_plan(folder_path, overrides=overrides)

    def apply_show_folder(
        self,
        folder_path: str,
        overrides: Optional[List[Dict[str, object]]] = None,
    ) -> Dict[str, object]:
        plan = self._build_show_plan(folder_path, overrides=overrides)
        if not plan.get("success"):
            return plan

        performed: List[Dict[str, object]] = []
        for move in plan.get("moves", []):
            source = str(move.get("sourcePath") or "")
            destination = str(move.get("targetPath") or "")
            if not source or not destination:
                continue
            if os.path.realpath(source) == os.path.realpath(destination):
                continue

            os.makedirs(os.path.dirname(destination), exist_ok=True)
            unique_destination = self._unique_destination(destination)
            shutil.move(source, unique_destination)
            performed.append({
                "sourcePath": source,
                "targetPath": unique_destination,
                "category": move.get("category"),
                "targetFileName": os.path.basename(unique_destination),
                "seasonNumber": move.get("seasonNumber"),
                "episodeStart": move.get("episodeStart"),
                "episodeEnd": move.get("episodeEnd"),
                "partNumber": move.get("partNumber"),
            })

        return {
            "success": True,
            "folderPath": plan.get("folderPath"),
            "folderName": plan.get("folderName"),
            "movesPlanned": len(plan.get("moves", [])),
            "movesApplied": len(performed),
            "moves": performed,
        }

    def preview_all_shows(self, shows_root: Optional[str] = None) -> Dict[str, object]:
        root = os.path.realpath(shows_root or os.path.join(self.jellyfin_dest_base, self.folder_tv_shows))
        if not os.path.isdir(root):
            return {
                "success": False,
                "error": f"Shows root does not exist: {root}",
                "showsRoot": root,
                "folders": [],
            }

        folders: List[Dict[str, object]] = []
        total_moves = 0
        for entry in sorted(os.listdir(root), key=str.lower):
            folder_path = os.path.join(root, entry)
            if not os.path.isdir(folder_path):
                continue
            preview = self.preview_show_folder(folder_path)
            total_moves += int(preview.get("moveCount") or 0)
            folders.append(preview)

        return {
            "success": True,
            "showsRoot": root,
            "folderCount": len(folders),
            "totalMoveCount": total_moves,
            "folders": folders,
            "supportedCategories": self.list_supported_categories(),
        }

    def apply_all_shows(
        self,
        shows_root: Optional[str] = None,
        overrides: Optional[List[Dict[str, object]]] = None,
    ) -> Dict[str, object]:
        root = os.path.realpath(shows_root or os.path.join(self.jellyfin_dest_base, self.folder_tv_shows))
        if not os.path.isdir(root):
            return {
                "success": False,
                "error": f"Shows root does not exist: {root}",
                "showsRoot": root,
                "folders": [],
            }

        by_folder: Dict[str, List[Dict[str, object]]] = {}
        for override in overrides or []:
            src = str(override.get("sourcePath") or "")
            if not src:
                continue
            folder = os.path.dirname(src)
            by_folder.setdefault(folder, []).append(override)

        results: List[Dict[str, object]] = []
        total_moves = 0
        for entry in sorted(os.listdir(root), key=str.lower):
            folder_path = os.path.join(root, entry)
            if not os.path.isdir(folder_path):
                continue

            matching_overrides: List[Dict[str, object]] = []
            for source_dir, source_overrides in by_folder.items():
                if source_dir.startswith(folder_path + os.sep) or source_dir == folder_path:
                    matching_overrides.extend(source_overrides)

            result = self.apply_show_folder(folder_path, overrides=matching_overrides)
            total_moves += int(result.get("movesApplied") or 0)
            results.append(result)

        return {
            "success": True,
            "showsRoot": root,
            "folderCount": len(results),
            "totalMovesApplied": total_moves,
            "folders": results,
        }

    def _build_show_plan(
        self,
        folder_path: str,
        overrides: Optional[List[Dict[str, object]]] = None,
    ) -> Dict[str, object]:
        folder_path = os.path.realpath(folder_path)
        if not os.path.isdir(folder_path):
            return {
                "success": False,
                "error": f"Show folder does not exist: {folder_path}",
                "folderPath": folder_path,
                "moves": [],
            }

        folder_name = os.path.basename(folder_path)
        override_map = {
            str(item.get("sourcePath") or ""): item
            for item in (overrides or [])
            if item.get("sourcePath")
        }

        media_files = self._collect_media_files(folder_path)
        moves: List[Dict[str, object]] = []

        for item in media_files:
            source_path = str(item["sourcePath"])
            source_name = str(item["sourceName"])
            ext = str(item["ext"])
            stem = str(item["stem"])
            relative_dir = str(item["relativeDir"])

            parsed = self._detect_show_file(folder_name, stem, relative_dir, ext)
            override = override_map.get(source_path, {})

            category = self._normalize_category(str(override.get("category") or parsed["category"]))
            season_number = self._coerce_optional_int(override.get("seasonNumber"), parsed.get("seasonNumber"))
            episode_start = self._coerce_optional_int(override.get("episodeStart"), parsed.get("episodeStart"))
            episode_end = self._coerce_optional_int(override.get("episodeEnd"), parsed.get("episodeEnd"))
            part_number = self._coerce_optional_int(override.get("partNumber"), parsed.get("partNumber"))

            suggested_name = str(parsed.get("targetFileName") or source_name)
            target_file_name = self._sanitize_filename(
                str(override.get("targetFileName") or suggested_name),
                ext,
            )

            if category in ("episode", "special"):
                built_name = self._build_episode_target_name(
                    folder_name=folder_name,
                    ext=ext,
                    season_number=0 if category == "special" else season_number,
                    episode_start=episode_start,
                    episode_end=episode_end,
                    part_number=part_number,
                )
                if built_name:
                    target_file_name = built_name

            target_subfolder = self._target_subfolder(
                category=category,
                season_number=season_number,
                is_season_scoped_extra=bool(parsed.get("seasonScopedExtra")),
            )
            target_dir = os.path.join(folder_path, target_subfolder) if target_subfolder else folder_path
            target_path = os.path.join(target_dir, target_file_name)
            move_needed = os.path.realpath(source_path) != os.path.realpath(target_path)

            moves.append({
                "sourcePath": source_path,
                "sourceName": source_name,
                "category": category,
                "detectedCategory": parsed["category"],
                "seasonNumber": season_number,
                "episodeStart": episode_start,
                "episodeEnd": episode_end,
                "partNumber": part_number,
                "targetFileName": target_file_name,
                "targetSubfolder": target_subfolder,
                "targetPath": target_path,
                "moveNeeded": move_needed,
                "size": int(item["size"]),
            })

        planned_moves = [m for m in moves if m["moveNeeded"]]
        return {
            "success": True,
            "folderPath": folder_path,
            "folderName": folder_name,
            "moveCount": len(planned_moves),
            "moves": moves,
            "supportedCategories": self.list_supported_categories(),
        }

    def _collect_media_files(self, folder_path: str) -> List[Dict[str, object]]:
        entries: List[Dict[str, object]] = []
        for root, _, files in os.walk(folder_path):
            for name in sorted(files):
                ext = os.path.splitext(name)[1].lower()
                if ext not in self.VIDEO_EXTENSIONS and ext not in self.AUDIO_EXTENSIONS:
                    continue
                path = os.path.join(root, name)
                entries.append({
                    "sourcePath": path,
                    "sourceName": name,
                    "ext": ext,
                    "size": self._safe_size(path),
                    "relativeDir": os.path.relpath(root, folder_path).replace("\\", "/"),
                    "stem": os.path.splitext(name)[0],
                })
        return entries

    def _detect_show_file(
        self,
        folder_name: str,
        stem: str,
        relative_dir: str,
        ext: str,
    ) -> Dict[str, object]:
        season_number = self._season_from_relative_dir(relative_dir)
        season_scoped_extra = season_number is not None

        category_from_folder = self._category_from_relative_dir(relative_dir)
        if category_from_folder:
            return {
                "category": category_from_folder,
                "seasonNumber": season_number,
                "targetFileName": f"{stem}{ext}",
                "seasonScopedExtra": season_scoped_extra,
            }

        episode_match = self._extract_episode_match(stem)
        if episode_match:
            parsed_season = episode_match["season"]
            parsed_ep_start = episode_match["episodeStart"]
            parsed_ep_end = episode_match.get("episodeEnd")
            parsed_part = episode_match.get("partNumber")
            category = "special" if parsed_season == 0 else "episode"
            return {
                "category": category,
                "seasonNumber": parsed_season,
                "episodeStart": parsed_ep_start,
                "episodeEnd": parsed_ep_end,
                "partNumber": parsed_part,
                "targetFileName": self._build_episode_target_name(
                    folder_name=folder_name,
                    ext=ext,
                    season_number=parsed_season,
                    episode_start=parsed_ep_start,
                    episode_end=parsed_ep_end,
                    part_number=parsed_part,
                ) or f"{stem}{ext}",
                "seasonScopedExtra": False,
            }

        suffix_category = self._classify_extra_from_stem(stem)
        if suffix_category:
            return {
                "category": suffix_category,
                "seasonNumber": season_number,
                "targetFileName": f"{stem}{ext}",
                "seasonScopedExtra": season_scoped_extra,
            }

        if ext in self.AUDIO_EXTENSIONS and stem.strip().lower() == "theme":
            return {
                "category": "theme-music",
                "seasonNumber": None,
                "targetFileName": f"{stem}{ext}",
                "seasonScopedExtra": False,
            }

        if season_number == 0:
            return {
                "category": "special",
                "seasonNumber": 0,
                "targetFileName": f"{stem}{ext}",
                "seasonScopedExtra": False,
            }

        if season_number is not None:
            return {
                "category": "episode",
                "seasonNumber": season_number,
                "targetFileName": f"{stem}{ext}",
                "seasonScopedExtra": False,
            }

        return {
            "category": "extras",
            "seasonNumber": None,
            "targetFileName": f"{stem}{ext}",
            "seasonScopedExtra": False,
        }

    def _extract_episode_match(self, stem: str) -> Optional[Dict[str, int]]:
        match = self.EPISODE_PATTERN.search(stem)
        if not match:
            match = self.ALT_EPISODE_PATTERN.search(stem)
        if not match:
            return None

        season_number = int(match.group(1))
        episode_start = int(match.group(2))
        episode_end = int(match.group(3)) if match.group(3) else None

        part_number = None
        part_match = self.PART_PATTERN.search(stem)
        if part_match:
            token = (part_match.group(2) or "").lower()
            if token.isdigit():
                part_number = int(token)
            elif token in {"a", "b", "c", "d"}:
                part_number = ord(token) - ord("a") + 1

        result: Dict[str, int] = {
            "season": season_number,
            "episodeStart": episode_start,
        }
        if episode_end is not None and episode_end >= episode_start:
            result["episodeEnd"] = episode_end
        if part_number is not None:
            result["partNumber"] = part_number
        return result

    def _season_from_relative_dir(self, relative_dir: str) -> Optional[int]:
        if relative_dir in ("", "."):
            return None
        for part in relative_dir.split("/"):
            match = self.SEASON_DIR_PATTERN.match(part.strip())
            if match:
                return int(match.group(1))
        return None

    def _category_from_relative_dir(self, relative_dir: str) -> Optional[str]:
        if relative_dir in ("", "."):
            return None
        parts = [p for p in relative_dir.split("/") if p]
        for part in parts:
            canonical = self._canonical_extra_folder(part)
            if canonical:
                return canonical
        return None

    def _normalize_category(self, category: str) -> str:
        c = category.strip().lower()
        aliases = {
            "episodes": "episode",
            "main_episode": "episode",
            "multi_episode": "episode",
            "specials": "special",
            "behindthescenes": "behind the scenes",
            "deletedscenes": "deleted scenes",
        }
        if c in aliases:
            return aliases[c]
        supported = set(self.list_supported_categories())
        return c if c in supported else "extras"

    def _target_subfolder(
        self,
        *,
        category: str,
        season_number: Optional[int],
        is_season_scoped_extra: bool,
    ) -> Optional[str]:
        if category == "special":
            return "Season 00"
        if category == "episode":
            if season_number is None:
                return None
            return f"Season {int(season_number):02d}"

        if is_season_scoped_extra and season_number is not None:
            return os.path.join(f"Season {int(season_number):02d}", category).replace("\\", "/")
        return category

    def _build_episode_target_name(
        self,
        *,
        folder_name: str,
        ext: str,
        season_number: Optional[int],
        episode_start: Optional[int],
        episode_end: Optional[int],
        part_number: Optional[int],
    ) -> Optional[str]:
        if season_number is None or episode_start is None:
            return None

        base = f"{folder_name} S{int(season_number):02d}E{int(episode_start):02d}"
        if episode_end is not None and int(episode_end) > int(episode_start):
            base = f"{base}-E{int(episode_end):02d}"
        if part_number is not None:
            base = f"{base} Part {int(part_number)}"
        return f"{base}{ext}"

    def _classify_extra_from_stem(self, stem: str) -> Optional[str]:
        lowered = stem.strip().lower()
        if lowered in self.EXTRA_FOLDERS:
            return self.EXTRA_FOLDERS[lowered]

        tokenized = re.sub(r"[\s._-]+", " ", lowered).strip()
        if tokenized in self.EXTRA_FOLDERS:
            return self.EXTRA_FOLDERS[tokenized]

        if lowered.endswith(" trailer"):
            return "trailers"
        if lowered.endswith(" sample"):
            return "samples"

        match = re.search(
            r"(?:[ ._-]|^)(trailer|sample|scene|clip|interview|behindthescenes|deletedscene|deleted|featurette|short|other|extra)$",
            lowered,
        )
        if match:
            return self.EXTRA_SUFFIX_TO_FOLDER.get(match.group(1))
        return None

    def _canonical_extra_folder(self, name: str) -> Optional[str]:
        normalized = re.sub(r"[^a-z0-9]+", "", name.lower())
        return self.EXTRA_FOLDERS.get(normalized)

    def _coerce_optional_int(self, value: object, fallback: object = None) -> Optional[int]:
        raw = value if value is not None else fallback
        if raw is None:
            return None
        try:
            return int(raw)
        except Exception:
            return None

    def _sanitize_filename(self, file_name: str, ext: str) -> str:
        invalid = '<>:"/\\|?*'
        cleaned = file_name.strip()
        for ch in invalid:
            cleaned = cleaned.replace(ch, "")
        if not cleaned:
            cleaned = f"file{ext}"
        if not cleaned.lower().endswith(ext.lower()):
            cleaned = f"{os.path.splitext(cleaned)[0]}{ext}"
        return cleaned

    def _safe_size(self, path: str) -> int:
        try:
            return int(os.path.getsize(path))
        except Exception:
            return 0

    def _unique_destination(self, path: str) -> str:
        if not os.path.exists(path):
            return path
        base, ext = os.path.splitext(path)
        suffix = 2
        while True:
            candidate = f"{base} ({suffix}){ext}"
            if not os.path.exists(candidate):
                return candidate
            suffix += 1

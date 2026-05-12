import os
import re
import shutil
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


def _load_settings_values() -> Dict[str, object]:
    """Load settings lazily so this module can run without full app deps in tests."""
    try:
        from config.settings import settings  # pylint: disable=import-outside-toplevel

        return {
            "jellyfin_dest_base": settings.jellyfin_dest_base,
            "folder_movies": settings.folder_movies,
            "movie_version_duration_threshold": float(settings.movie_version_duration_threshold),
        }
    except Exception:
        return {
            "jellyfin_dest_base": "/ark/media/jellyfin",
            "folder_movies": "Movies",
            "movie_version_duration_threshold": 0.85,
        }


@dataclass
class FileAction:
    action: str
    source: str
    destination: Optional[str] = None
    reason: Optional[str] = None


class JellyfinMovieOrganizer:
    """Reorganize processed movie folders into Jellyfin-compliant layouts."""

    VIDEO_EXTENSIONS = {
        ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".flv",
        ".webm", ".m2ts", ".mts", ".ts", ".mpg", ".mpeg", ".iso", ".strm",
    }
    AUDIO_EXTENSIONS = {
        ".mp3", ".flac", ".wav", ".aac", ".ogg", ".m4a", ".opus", ".wma",
    }
    SUBTITLE_EXTENSIONS = {
        ".srt", ".vtt", ".ass", ".ssa", ".sub", ".idx",
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

    def __init__(self, dry_run: bool = True):
        self.dry_run = dry_run
        settings_values = _load_settings_values()
        self.jellyfin_dest_base = str(settings_values["jellyfin_dest_base"])
        self.folder_movies = str(settings_values["folder_movies"])
        self.movie_version_duration_threshold = float(settings_values["movie_version_duration_threshold"])

    def list_supported_categories(self) -> List[str]:
        return [
            "main_feature",
            "version",
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

    def preview_movie_folder(
        self,
        folder_path: str,
        overrides: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, object]:
        return self._build_movie_plan(folder_path, overrides=overrides)

    def apply_movie_folder(
        self,
        folder_path: str,
        overrides: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, object]:
        plan = self._build_movie_plan(folder_path, overrides=overrides)
        if not plan.get("success"):
            return plan

        moves = plan.get("moves", [])
        performed: List[Dict[str, object]] = []

        for move in moves:
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
            })

        return {
            "success": True,
            "folderPath": plan.get("folderPath"),
            "folderName": plan.get("folderName"),
            "movesPlanned": len(moves),
            "movesApplied": len(performed),
            "moves": performed,
        }

    def preview_all_movies(self, movies_root: Optional[str] = None) -> Dict[str, object]:
        root = os.path.realpath(
            movies_root or os.path.join(self.jellyfin_dest_base, self.folder_movies)
        )

        if not os.path.isdir(root):
            return {
                "success": False,
                "error": f"Movies root does not exist: {root}",
                "moviesRoot": root,
                "folders": [],
            }

        folders: List[Dict[str, object]] = []
        total_moves = 0

        for entry in sorted(os.listdir(root), key=str.lower):
            folder_path = os.path.join(root, entry)
            if not os.path.isdir(folder_path):
                continue
            preview = self.preview_movie_folder(folder_path)
            moves = int(preview.get("moveCount") or 0)
            total_moves += moves
            folders.append(preview)

        return {
            "success": True,
            "moviesRoot": root,
            "folderCount": len(folders),
            "totalMoveCount": total_moves,
            "folders": folders,
            "supportedCategories": self.list_supported_categories(),
        }

    def apply_all_movies(
        self,
        movies_root: Optional[str] = None,
        overrides: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, object]:
        root = os.path.realpath(
            movies_root or os.path.join(self.jellyfin_dest_base, self.folder_movies)
        )

        if not os.path.isdir(root):
            return {
                "success": False,
                "error": f"Movies root does not exist: {root}",
                "moviesRoot": root,
                "folders": [],
            }

        by_folder: Dict[str, List[Dict[str, str]]] = {}
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

            matching_overrides: List[Dict[str, str]] = []
            for source_dir, source_overrides in by_folder.items():
                if source_dir.startswith(folder_path + os.sep) or source_dir == folder_path:
                    matching_overrides.extend(source_overrides)

            result = self.apply_movie_folder(folder_path, overrides=matching_overrides)
            total_moves += int(result.get("movesApplied") or 0)
            results.append(result)

        return {
            "success": True,
            "moviesRoot": root,
            "folderCount": len(results),
            "totalMovesApplied": total_moves,
            "folders": results,
        }

    def _build_movie_plan(
        self,
        folder_path: str,
        overrides: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, object]:
        folder_path = os.path.realpath(folder_path)
        if not os.path.isdir(folder_path):
            return {
                "success": False,
                "error": f"Movie folder does not exist: {folder_path}",
                "folderPath": folder_path,
                "moves": [],
            }

        folder_name = os.path.basename(folder_path)
        override_map = {
            str(item.get("sourcePath") or ""): item for item in (overrides or []) if item.get("sourcePath")
        }

        media_files = self._collect_media_files(folder_path)
        candidates = self._classify_candidates(folder_path, folder_name, media_files)
        moves: List[Dict[str, object]] = []

        for item in candidates:
            source_path = item["sourcePath"]
            source_name = item["sourceName"]
            ext = item["ext"]
            category = str(item["category"])
            suggested_name = str(item["targetFileName"])

            override = override_map.get(source_path, {})
            override_category = self._normalize_category(str(override.get("category") or category))
            override_name = self._sanitize_filename(str(override.get("targetFileName") or suggested_name), ext)

            target_subfolder = self._category_to_subfolder(override_category)
            if target_subfolder:
                target_dir = os.path.join(folder_path, target_subfolder)
            else:
                target_dir = folder_path

            target_path = os.path.join(target_dir, override_name)

            move_needed = os.path.realpath(source_path) != os.path.realpath(target_path)
            moves.append({
                "sourcePath": source_path,
                "sourceName": source_name,
                "category": override_category,
                "detectedCategory": category,
                "targetFileName": override_name,
                "targetSubfolder": target_subfolder,
                "targetPath": target_path,
                "moveNeeded": move_needed,
                "size": item["size"],
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

    def _classify_candidates(
        self,
        folder_path: str,
        folder_name: str,
        media_files: List[Dict[str, object]],
    ) -> List[Dict[str, object]]:
        candidates: List[Dict[str, object]] = []
        main_feature: Optional[Dict[str, object]] = None
        versions: List[Dict[str, object]] = []
        extras: List[Dict[str, object]] = []
        unknown_videos: List[Dict[str, object]] = []

        for item in media_files:
            ext = str(item["ext"])
            stem = str(item["stem"])
            source_name = str(item["sourceName"])
            relative_dir = str(item["relativeDir"])
            size = int(item["size"])

            category_from_folder = self._category_from_relative_dir(relative_dir)
            if category_from_folder:
                extras.append({
                    **item,
                    "category": category_from_folder,
                    "targetFileName": source_name,
                })
                continue

            if ext in self.AUDIO_EXTENSIONS:
                if stem.lower() == "theme":
                    candidates.append({
                        **item,
                        "category": "main_feature",
                        "targetFileName": source_name,
                    })
                    continue
                category = self._classify_extra_from_stem(stem) or "extras"
                extras.append({
                    **item,
                    "category": category,
                    "targetFileName": source_name,
                })
                continue

            if self._is_main_movie_name(stem, folder_name):
                if stem.lower().startswith(folder_name.lower() + " - "):
                    versions.append({
                        **item,
                        "category": "version",
                        "targetFileName": source_name,
                    })
                else:
                    target_name = f"{folder_name}{ext}"
                    if main_feature is None or size > int(main_feature["size"]):
                        if main_feature is not None:
                            versions.append({
                                **main_feature,
                                "category": "version",
                                "targetFileName": str(main_feature["sourceName"]),
                            })
                        main_feature = {
                            **item,
                            "category": "main_feature",
                            "targetFileName": target_name,
                        }
                    else:
                        versions.append({
                            **item,
                            "category": "version",
                            "targetFileName": source_name,
                        })
                continue

            suffix_category = self._classify_extra_from_stem(stem)
            if suffix_category:
                extras.append({
                    **item,
                    "category": suffix_category,
                    "targetFileName": source_name,
                })
                continue

            unknown_videos.append(item)

        unknown_videos.sort(key=lambda x: int(x["size"]), reverse=True)

        if main_feature is None and unknown_videos:
            promoted = unknown_videos.pop(0)
            main_feature = {
                **promoted,
                "category": "main_feature",
                "targetFileName": f"{folder_name}{promoted['ext']}",
            }

        main_size = int(main_feature["size"]) if main_feature is not None else 0
        for item in unknown_videos:
            if main_size and int(item["size"]) >= int(main_size * self.movie_version_duration_threshold):
                label = self._sanitize_label(str(item["stem"]))
                if not label or label.lower() == folder_name.lower():
                    label = "Version"
                target_name = f"{folder_name} - {label}{item['ext']}"
                versions.append({
                    **item,
                    "category": "version",
                    "targetFileName": target_name,
                })
            else:
                extras.append({
                    **item,
                    "category": "extras",
                    "targetFileName": str(item["sourceName"]),
                })

        if main_feature is not None:
            candidates.append(main_feature)
        candidates.extend(versions)
        candidates.extend(extras)

        return candidates

    def _category_from_relative_dir(self, relative_dir: str) -> Optional[str]:
        if relative_dir in (".", ""):
            return None
        head = relative_dir.split("/", 1)[0]
        canonical = self._canonical_extra_folder(head)
        if not canonical:
            return None
        if canonical == "trailers":
            return "trailers"
        if canonical == "samples":
            return "samples"
        return canonical

    def _normalize_category(self, category: str) -> str:
        c = category.strip().lower()
        aliases = {
            "main": "main_feature",
            "mainfeature": "main_feature",
            "feature": "main_feature",
            "alt": "version",
            "alternate": "version",
            "alternate_version": "version",
            "behindthescenes": "behind the scenes",
            "deletedscenes": "deleted scenes",
        }
        if c in aliases:
            return aliases[c]
        supported = set(self.list_supported_categories())
        return c if c in supported else "extras"

    def _category_to_subfolder(self, category: str) -> Optional[str]:
        if category in ("main_feature", "version"):
            return None
        return category

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

    def reorganize_all_movies(
        self,
        movies_root: Optional[str] = None,
    ) -> Dict[str, object]:
        root = os.path.realpath(
            movies_root
            or os.path.join(self.jellyfin_dest_base, self.folder_movies)
        )

        if not os.path.isdir(root):
            return {
                "success": False,
                "error": f"Movies root does not exist: {root}",
                "moviesScanned": 0,
                "moviesChanged": 0,
                "actions": [],
            }

        aggregate_actions: List[FileAction] = []
        changed = 0
        scanned = 0

        for entry in sorted(os.listdir(root), key=str.lower):
            folder_path = os.path.join(root, entry)
            if not os.path.isdir(folder_path):
                continue

            scanned += 1
            result = self.reorganize_movie_folder(folder_path)
            actions = result.get("actions", [])
            if actions:
                changed += 1
                aggregate_actions.extend(actions)

        return {
            "success": True,
            "dryRun": self.dry_run,
            "moviesRoot": root,
            "moviesScanned": scanned,
            "moviesChanged": changed,
            "actions": [self._action_to_dict(a) for a in aggregate_actions],
        }

    def reorganize_movie_folder(self, folder_path: str) -> Dict[str, object]:
        folder_path = os.path.realpath(folder_path)
        folder_name = os.path.basename(folder_path)

        if not os.path.isdir(folder_path):
            return {
                "success": False,
                "error": f"Movie folder does not exist: {folder_path}",
                "actions": [],
            }

        actions: List[FileAction] = []
        self._normalize_existing_extra_folders(folder_path, actions)

        main_videos: List[Tuple[str, int]] = []
        unknown_videos: List[Tuple[str, int]] = []

        for entry in sorted(os.listdir(folder_path), key=str.lower):
            path = os.path.join(folder_path, entry)
            if os.path.isdir(path):
                if entry.upper() in {"VIDEO_TS", "BDMV"}:
                    continue
                if self._is_known_extra_folder(entry):
                    continue
                # Unknown subfolders are treated as generic extras buckets.
                target_dir = self._ensure_extra_dir(folder_path, "extras", actions)
                destination = self._unique_destination(os.path.join(target_dir, entry))
                self._move(path, destination, actions, reason="Unknown extra subfolder")
                continue

            ext = os.path.splitext(entry)[1].lower()
            stem = os.path.splitext(entry)[0]

            if ext in self.VIDEO_EXTENSIONS:
                if self._is_main_movie_name(stem, folder_name):
                    main_videos.append((path, self._safe_size(path)))
                    continue

                extra_folder = self._classify_extra_from_stem(stem)
                if extra_folder:
                    target_dir = self._ensure_extra_dir(folder_path, extra_folder, actions)
                    destination = self._unique_destination(os.path.join(target_dir, entry))
                    self._move(path, destination, actions, reason=f"Classified as {extra_folder}")
                    continue

                unknown_videos.append((path, self._safe_size(path)))
                continue

            if ext in self.AUDIO_EXTENSIONS:
                if stem.lower() == "theme":
                    continue

                extra_folder = self._classify_extra_from_stem(stem)
                if extra_folder:
                    target_dir = self._ensure_extra_dir(folder_path, extra_folder, actions)
                    destination = self._unique_destination(os.path.join(target_dir, entry))
                    self._move(path, destination, actions, reason=f"Classified as {extra_folder}")
                continue

            if ext in self.SUBTITLE_EXTENSIONS:
                continue

        self._promote_or_place_unknown_videos(
            folder_path=folder_path,
            folder_name=folder_name,
            main_videos=main_videos,
            unknown_videos=unknown_videos,
            actions=actions,
        )

        return {
            "success": True,
            "folder": folder_path,
            "actions": [self._action_to_dict(a) for a in actions],
        }

    def _promote_or_place_unknown_videos(
        self,
        *,
        folder_path: str,
        folder_name: str,
        main_videos: List[Tuple[str, int]],
        unknown_videos: List[Tuple[str, int]],
        actions: List[FileAction],
    ) -> None:
        if not unknown_videos:
            return

        unknown_videos.sort(key=lambda item: item[1], reverse=True)

        if not main_videos:
            promoted_path, _ = unknown_videos[0]
            promoted_ext = os.path.splitext(promoted_path)[1]
            promoted_target = self._unique_destination(
                os.path.join(folder_path, f"{folder_name}{promoted_ext}")
            )
            if os.path.realpath(promoted_path) != os.path.realpath(promoted_target):
                self._move(
                    promoted_path,
                    promoted_target,
                    actions,
                    reason="Promoted largest unknown video as main feature",
                )

            for index, (video_path, _) in enumerate(unknown_videos[1:], start=2):
                self._rename_as_version(folder_name, video_path, index, actions)
            return

        largest_main_size = max(size for _, size in main_videos) if main_videos else 0

        for video_path, size in unknown_videos:
            if largest_main_size > 0 and size >= int(largest_main_size * self.movie_version_duration_threshold):
                self._rename_as_version(folder_name, video_path, None, actions)
            else:
                target_dir = self._ensure_extra_dir(folder_path, "extras", actions)
                destination = self._unique_destination(os.path.join(target_dir, os.path.basename(video_path)))
                self._move(video_path, destination, actions, reason="Classified as generic extra")

    def _rename_as_version(
        self,
        folder_name: str,
        video_path: str,
        fallback_number: Optional[int],
        actions: List[FileAction],
    ) -> None:
        ext = os.path.splitext(video_path)[1]
        stem = os.path.splitext(os.path.basename(video_path))[0]
        label = self._sanitize_label(stem)

        if not label or label.lower() == folder_name.lower():
            label = f"Version {fallback_number or 2}"

        destination = self._unique_destination(
            os.path.join(os.path.dirname(video_path), f"{folder_name} - {label}{ext}")
        )
        if os.path.realpath(video_path) != os.path.realpath(destination):
            self._move(video_path, destination, actions, reason="Renamed as alternate version")

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

        m = re.search(r"(?:[ ._-]|^)(trailer|sample|scene|clip|interview|behindthescenes|deletedscene|deleted|featurette|short|other|extra)$", lowered)
        if m:
            token = m.group(1)
            return self.EXTRA_SUFFIX_TO_FOLDER.get(token)

        return None

    def _normalize_existing_extra_folders(self, folder_path: str, actions: List[FileAction]) -> None:
        for entry in sorted(os.listdir(folder_path), key=str.lower):
            src = os.path.join(folder_path, entry)
            if not os.path.isdir(src):
                continue

            canonical = self._canonical_extra_folder(entry)
            if not canonical:
                continue

            dst = os.path.join(folder_path, canonical)
            if os.path.realpath(src) == os.path.realpath(dst):
                continue

            if os.path.exists(dst):
                for child in sorted(os.listdir(src), key=str.lower):
                    child_src = os.path.join(src, child)
                    child_dst = self._unique_destination(os.path.join(dst, child))
                    self._move(child_src, child_dst, actions, reason="Merged canonical extra folder")
                if not self.dry_run:
                    os.rmdir(src)
                actions.append(FileAction(action="rmdir", source=src, reason="Removed merged extra folder"))
                continue

            self._move(src, dst, actions, reason="Normalized extra folder name")

    def _canonical_extra_folder(self, name: str) -> Optional[str]:
        normalized = re.sub(r"[^a-z0-9]+", "", name.lower())
        return self.EXTRA_FOLDERS.get(normalized)

    def _is_known_extra_folder(self, name: str) -> bool:
        return self._canonical_extra_folder(name) is not None

    def _is_main_movie_name(self, stem: str, folder_name: str) -> bool:
        stem_l = stem.lower()
        folder_l = folder_name.lower()

        if stem_l == folder_l:
            return True

        if stem_l.startswith(folder_l + " - "):
            return True

        if self.PART_PATTERN.search(stem_l):
            prefix = self.PART_PATTERN.sub("", stem_l).strip(" ._-")
            return prefix == folder_l

        return False

    def _ensure_extra_dir(self, folder_path: str, extra_folder: str, actions: List[FileAction]) -> str:
        target_dir = os.path.join(folder_path, extra_folder)
        if not os.path.exists(target_dir):
            if not self.dry_run:
                os.makedirs(target_dir, exist_ok=True)
            actions.append(FileAction(action="mkdir", source=target_dir, reason="Create extras type folder"))
        return target_dir

    def _move(self, source: str, destination: str, actions: List[FileAction], reason: str) -> None:
        if not self.dry_run:
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            shutil.move(source, destination)
        actions.append(FileAction(action="move", source=source, destination=destination, reason=reason))

    def _unique_destination(self, destination: str) -> str:
        if not os.path.exists(destination):
            return destination

        base, ext = os.path.splitext(destination)
        suffix = 2
        while True:
            candidate = f"{base} ({suffix}){ext}"
            if not os.path.exists(candidate):
                return candidate
            suffix += 1

    def _sanitize_label(self, label: str) -> str:
        cleaned = re.sub(r"[<>:\"/\\|?*]", "", label).strip()
        cleaned = re.sub(r"\s+", " ", cleaned)
        return cleaned

    def _safe_size(self, file_path: str) -> int:
        try:
            return os.path.getsize(file_path)
        except OSError:
            return 0

    def _action_to_dict(self, action: FileAction) -> Dict[str, Optional[str]]:
        return {
            "action": action.action,
            "source": action.source,
            "destination": action.destination,
            "reason": action.reason,
        }

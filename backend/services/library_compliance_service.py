import asyncio
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

from config.settings import settings
from db.models import (
    ComplianceAction,
    ComplianceFinding,
    ComplianceReviewEvent,
    ComplianceScan,
)
from services.extras_taxonomy import EXTRA_FOLDERS as _EXTRA_FOLDER_VARIANTS
from services.filesystem_manager import FileSystemManager
from utils.logging import logger


@dataclass
class ComplianceScanProgress:
    scan_id: str
    library_path: str
    status: str = "running"
    total_folders: int = 0
    processed_folders: int = 0
    findings_count: int = 0
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None


class LibraryComplianceService:
    """Runs non-destructive Jellyfin compliance audits and stores findings."""

    # Delegates to services.extras_taxonomy, the shared source of truth — all
    # recognized spelling variants (plural/singular/no-space) of extras folder
    # names, so a not-yet-normalized folder on disk still gets recognized.
    EXTRA_FOLDERS = set(_EXTRA_FOLDER_VARIANTS.keys())

    COMPANION_LABELS = {
        "extra", "extras", "special feature", "special features", "bonus", "bonus feature", "bonus features",
        "deleted scene", "deleted scenes", "featurette", "featurettes", "interview", "interviews",
        "trailer", "trailers", "sample", "samples", "behind the scenes", "making of", "bloopers", "gag reel"
    }

    def __init__(
        self,
        db_session_factory: async_sessionmaker,
        file_manager: FileSystemManager,
    ):
        self.db_session_factory = db_session_factory
        self.file_manager = file_manager
        self.running_scans: Dict[str, ComplianceScanProgress] = {}
        self.scan_tasks: Dict[str, asyncio.Task] = {}

    async def start_scan(
        self,
        library_path: str,
        triggered_by: Optional[str] = None,
        media_type: str = "movie",
    ) -> str:
        scan_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        progress = ComplianceScanProgress(
            scan_id=scan_id,
            library_path=library_path,
            status="running",
            started_at=now,
        )
        self.running_scans[scan_id] = progress

        async with self.db_session_factory() as db:
            db.add(
                ComplianceScan(
                    id=scan_id,
                    library_path=library_path,
                    status="running",
                    triggered_by=triggered_by,
                    summary={
                        "mediaType": media_type,
                        "totalFolders": 0,
                        "processedFolders": 0,
                        "findings": 0,
                    },
                )
            )
            await db.commit()

        task = asyncio.create_task(self._run_scan(scan_id, library_path, media_type))
        self.scan_tasks[scan_id] = task
        return scan_id

    async def _run_scan(self, scan_id: str, library_path: str, media_type: str) -> None:
        progress = self.running_scans[scan_id]
        claimed_targets_global: set = set()

        try:
            media_type_normalized = (media_type or "movie").lower()
            if media_type_normalized == "series":
                target_folders = self._discover_show_folders(library_path)
            else:
                target_folders = self._discover_movie_folders(library_path)

            progress.total_folders = len(target_folders)
            await self._update_scan_summary(scan_id, progress)

            for folder_path in target_folders:
                if progress.status == "cancelled":
                    break

                if media_type_normalized == "series":
                    findings = self._analyze_show_folder(folder_path, media_type="series")
                else:
                    findings = self._analyze_movie_folder(
                        folder_path,
                        media_type=media_type,
                        claimed_targets_global=claimed_targets_global,
                    )

                if findings:
                    await self._persist_findings(scan_id, findings)
                    progress.findings_count += len(findings)

                progress.processed_folders += 1
                await self._update_scan_summary(scan_id, progress)

            if progress.status != "cancelled":
                progress.status = "completed"
            progress.completed_at = datetime.now(timezone.utc).isoformat()
            await self._update_scan_summary(scan_id, progress, final=True)

        except Exception as exc:
            progress.status = "failed"
            progress.error = str(exc)
            progress.completed_at = datetime.now(timezone.utc).isoformat()
            logger.error("Compliance scan failed", scan_id=scan_id, error=str(exc))
            await self._update_scan_summary(scan_id, progress, final=True)

    async def cancel_scan(self, scan_id: str) -> bool:
        progress = self.running_scans.get(scan_id)
        if not progress or progress.status != "running":
            return False

        progress.status = "cancelled"
        task = self.scan_tasks.get(scan_id)
        if task and not task.done():
            task.cancel()

        progress.completed_at = datetime.now(timezone.utc).isoformat()
        await self._update_scan_summary(scan_id, progress, final=True)
        return True

    def get_scan_status(self, scan_id: str) -> Optional[Dict[str, Any]]:
        progress = self.running_scans.get(scan_id)
        if not progress:
            return None

        return {
            "scanId": progress.scan_id,
            "libraryPath": progress.library_path,
            "status": progress.status,
            "totalFolders": progress.total_folders,
            "processedFolders": progress.processed_folders,
            "findingsCount": progress.findings_count,
            "startedAt": progress.started_at,
            "completedAt": progress.completed_at,
            "error": progress.error,
            "percentage": round(
                (progress.processed_folders / progress.total_folders) * 100, 2
            )
            if progress.total_folders
            else 0,
        }

    async def list_findings(
        self,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        issue_type: Optional[str] = None,
        scan_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        async with self.db_session_factory() as db:
            stmt = select(ComplianceFinding).order_by(ComplianceFinding.created_at.desc())
            filters = []
            if status:
                filters.append(ComplianceFinding.status == status)
            if severity:
                filters.append(ComplianceFinding.severity == severity)
            if issue_type:
                filters.append(ComplianceFinding.issue_type == issue_type)
            if scan_id:
                filters.append(ComplianceFinding.scan_id == scan_id)
            if filters:
                stmt = stmt.where(and_(*filters))

            stmt = stmt.offset(max(0, offset)).limit(max(1, min(limit, 500)))
            result = await db.execute(stmt)
            findings = result.scalars().all()

            output: List[Dict[str, Any]] = []
            for finding in findings:
                output.append(await self._finding_to_dict(db, finding))
            return output

    async def get_finding(self, finding_id: str) -> Optional[Dict[str, Any]]:
        async with self.db_session_factory() as db:
            finding = await db.get(ComplianceFinding, finding_id)
            if not finding:
                return None
            return await self._finding_to_dict(db, finding)

    async def update_finding_status(
        self,
        finding_id: str,
        status: str,
        actor: Optional[str] = None,
        note: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        async with self.db_session_factory() as db:
            finding = await db.get(ComplianceFinding, finding_id)
            if not finding:
                return None

            finding.status = status
            db.add(
                ComplianceReviewEvent(
                    id=str(uuid.uuid4()),
                    finding_id=finding_id,
                    event_type="status_updated",
                    actor=actor,
                    note=note,
                    event_payload={"status": status},
                )
            )
            await db.commit()
            await db.refresh(finding)
            return await self._finding_to_dict(db, finding)

    async def update_action(
        self,
        finding_id: str,
        action_id: str,
        selected: Optional[bool] = None,
        target_path: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        async with self.db_session_factory() as db:
            action = await db.get(ComplianceAction, action_id)
            if not action or action.finding_id != finding_id:
                return None

            if selected is not None:
                action.selected = bool(selected)

            if target_path is not None:
                trimmed = target_path.strip()
                action.target_path = trimmed or None

            await db.commit()
            await db.refresh(action)

            return {
                "id": action.id,
                "findingId": action.finding_id,
                "actionType": action.action_type,
                "sourcePath": action.source_path,
                "targetPath": action.target_path,
                "payload": action.payload or {},
                "selected": bool(action.selected),
            }

    async def preview_actions(
        self,
        finding_id: str,
        action_ids: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        async with self.db_session_factory() as db:
            finding = await db.get(ComplianceFinding, finding_id)
            if not finding:
                return None

            actions = await self._get_finding_actions(db, finding_id, action_ids)
            previews = []
            for action in actions:
                src_exists = bool(action.source_path and os.path.exists(action.source_path))
                target_exists = bool(action.target_path and os.path.exists(action.target_path))
                parent_ok = True
                if action.target_path:
                    parent_ok = os.path.isdir(os.path.dirname(action.target_path))

                previews.append(
                    {
                        "actionId": action.id,
                        "actionType": action.action_type,
                        "sourcePath": action.source_path,
                        "targetPath": action.target_path,
                        "sourceExists": src_exists,
                        "targetExists": target_exists,
                        "parentFolderExists": parent_ok,
                        "canApply": src_exists and (not target_exists or action.action_type == "noop"),
                    }
                )

            return {
                "findingId": finding_id,
                "actions": previews,
                "safeToApply": all(item["canApply"] for item in previews) if previews else False,
            }

    async def apply_actions(
        self,
        finding_id: str,
        action_ids: Optional[List[str]] = None,
        actor: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        async with self.db_session_factory() as db:
            finding = await db.get(ComplianceFinding, finding_id)
            if not finding:
                return None

            actions = await self._get_finding_actions(db, finding_id, action_ids)

            # Backward compatibility: older duplicate-main findings selected only noop,
            # which made apply appear successful without persisting rename proposals.
            if finding.issue_type == "duplicate_main_feature":
                has_selected_mutation = any(
                    action.action_type in {"rename", "move", "create_folder"}
                    for action in actions
                )
                if not has_selected_mutation:
                    fallback_result = await db.execute(
                        select(ComplianceAction)
                        .where(ComplianceAction.finding_id == finding_id)
                        .where(ComplianceAction.action_type != "noop")
                        .order_by(ComplianceAction.created_at.asc())
                    )
                    fallback_actions = list(fallback_result.scalars().all())
                    if fallback_actions:
                        actions = fallback_actions

            results = []
            had_failure = False

            for action in actions:
                result = {
                    "actionId": action.id,
                    "actionType": action.action_type,
                    "success": False,
                    "sourcePath": action.source_path,
                    "targetPath": action.target_path,
                }

                try:
                    if action.action_type == "rename":
                        if not action.source_path or not action.target_path:
                            raise ValueError("Missing source or target path")
                        new_name = os.path.basename(action.target_path)
                        op = self.file_manager.rename_file(action.source_path, new_name)
                        result["operationResult"] = op
                        result["success"] = True
                    elif action.action_type == "move":
                        if not action.source_path or not action.target_path:
                            raise ValueError("Missing source or target path")
                        op = self.file_manager.move_file(action.source_path, action.target_path)
                        result["operationResult"] = op
                        result["success"] = True
                    elif action.action_type == "create_folder":
                        if not action.target_path:
                            raise ValueError("Missing target path")
                        os.makedirs(action.target_path, exist_ok=True)
                        result["operationResult"] = {"created": action.target_path}
                        result["success"] = True
                    elif action.action_type == "noop":
                        result["operationResult"] = {"noop": True}
                        result["success"] = True
                    else:
                        raise ValueError(f"Unsupported action type: {action.action_type}")
                except Exception as exc:
                    had_failure = True
                    result["error"] = str(exc)

                results.append(result)

            finding.status = "needs_manual_review" if had_failure else "resolved"
            db.add(
                ComplianceReviewEvent(
                    id=str(uuid.uuid4()),
                    finding_id=finding_id,
                    event_type="actions_applied",
                    actor=actor,
                    event_payload={"results": results},
                )
            )
            await db.commit()
            await db.refresh(finding)

            return {
                "finding": await self._finding_to_dict(db, finding),
                "results": results,
                "success": not had_failure,
            }

    async def bulk_apply(
        self,
        finding_ids: List[str],
        actor: Optional[str] = None,
    ) -> Dict[str, Any]:
        outcomes = []
        for finding_id in finding_ids:
            outcome = await self.apply_actions(finding_id=finding_id, action_ids=None, actor=actor)
            outcomes.append({"findingId": finding_id, "result": outcome})

        return {
            "total": len(finding_ids),
            "successful": sum(1 for x in outcomes if x.get("result", {}).get("success") is True),
            "failed": sum(1 for x in outcomes if not x.get("result") or x.get("result", {}).get("success") is False),
            "items": outcomes,
        }

    async def bulk_status(
        self,
        finding_ids: List[str],
        status: str,
        actor: Optional[str] = None,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        updated = []
        for finding_id in finding_ids:
            item = await self.update_finding_status(
                finding_id=finding_id,
                status=status,
                actor=actor,
                note=note,
            )
            if item:
                updated.append(item)

        return {
            "requested": len(finding_ids),
            "updated": len(updated),
            "status": status,
        }

    async def summary(self) -> Dict[str, Any]:
        async with self.db_session_factory() as db:
            open_count = await self._count_findings(db, status="open")
            critical_count = await self._count_findings(db, status="open", severity="critical")
            high_count = await self._count_findings(db, status="open", severity="high")
            duplicate_count = await self._count_findings(db, status="open", issue_type="duplicate_main_feature")
            misplaced_count = await self._count_findings(db, status="open", issue_type="misplaced_special_feature")
            naming_count = await self._count_findings(db, status="open", issue_type="naming_mismatch")
            season_naming_count = await self._count_findings(db, status="open", issue_type="season_folder_naming_mismatch")
            episode_naming_count = await self._count_findings(db, status="open", issue_type="episode_naming_mismatch")
            specials_misplaced_count = await self._count_findings(db, status="open", issue_type="specials_misplaced")
            unknown_episode_count = await self._count_findings(db, status="open", issue_type="unknown_episode_pattern")

            return {
                "open": open_count,
                "critical": critical_count,
                "high": high_count,
                "duplicateMain": duplicate_count,
                "misplacedSpecial": misplaced_count,
                "namingMismatch": naming_count,
                "seasonNamingMismatch": season_naming_count,
                "episodeNamingMismatch": episode_naming_count,
                "specialsMisplaced": specials_misplaced_count,
                "unknownEpisodePattern": unknown_episode_count,
            }

    async def _count_findings(
        self,
        db: Any,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        issue_type: Optional[str] = None,
    ) -> int:
        stmt = select(func.count(ComplianceFinding.id))
        filters = []
        if status:
            filters.append(ComplianceFinding.status == status)
        if severity:
            filters.append(ComplianceFinding.severity == severity)
        if issue_type:
            filters.append(ComplianceFinding.issue_type == issue_type)
        if filters:
            stmt = stmt.where(and_(*filters))

        result = await db.execute(stmt)
        return int(result.scalar_one() or 0)

    async def _finding_to_dict(self, db: Any, finding: ComplianceFinding) -> Dict[str, Any]:
        actions_result = await db.execute(
            select(ComplianceAction)
            .where(ComplianceAction.finding_id == finding.id)
            .order_by(ComplianceAction.created_at.asc())
        )
        actions = actions_result.scalars().all()

        return {
            "id": finding.id,
            "scanId": finding.scan_id,
            "mediaType": finding.media_type,
            "mediaId": finding.media_id,
            "folderPath": finding.folder_path,
            "filePath": finding.file_path,
            "issueType": finding.issue_type,
            "severity": finding.severity,
            "confidence": finding.confidence,
            "currentState": finding.current_state or {},
            "expectedState": finding.expected_state or {},
            "rationale": finding.rationale,
            "status": finding.status,
            "createdAt": finding.created_at.isoformat() if finding.created_at else None,
            "updatedAt": finding.updated_at.isoformat() if finding.updated_at else None,
            "actions": [
                {
                    "id": action.id,
                    "actionType": action.action_type,
                    "sourcePath": action.source_path,
                    "targetPath": action.target_path,
                    "payload": action.payload or {},
                    "selected": bool(action.selected),
                }
                for action in actions
            ],
        }

    async def _get_finding_actions(
        self,
        db: Any,
        finding_id: str,
        action_ids: Optional[List[str]] = None,
    ) -> List[ComplianceAction]:
        stmt = select(ComplianceAction).where(ComplianceAction.finding_id == finding_id)
        if action_ids:
            stmt = stmt.where(ComplianceAction.id.in_(action_ids))
        else:
            stmt = stmt.where(ComplianceAction.selected.is_(True))

        result = await db.execute(stmt.order_by(ComplianceAction.created_at.asc()))
        return list(result.scalars().all())

    async def _update_scan_summary(
        self,
        scan_id: str,
        progress: ComplianceScanProgress,
        final: bool = False,
    ) -> None:
        async with self.db_session_factory() as db:
            scan = await db.get(ComplianceScan, scan_id)
            if not scan:
                return

            scan.status = progress.status
            scan.summary = {
                "totalFolders": progress.total_folders,
                "processedFolders": progress.processed_folders,
                "findings": progress.findings_count,
                "error": progress.error,
            }
            if final:
                scan.completed_at = datetime.now(timezone.utc)

            await db.commit()

    async def _persist_findings(self, scan_id: str, findings: List[Dict[str, Any]]) -> None:
        async with self.db_session_factory() as db:
            try:
                for finding in findings:
                    finding_id = str(uuid.uuid4())
                    db.add(
                        ComplianceFinding(
                            id=finding_id,
                            scan_id=scan_id,
                            media_type=finding.get("mediaType", "movie"),
                            media_id=finding.get("mediaId"),
                            folder_path=finding.get("folderPath"),
                            file_path=finding.get("filePath"),
                            issue_type=finding.get("issueType", "unknown"),
                            severity=finding.get("severity", "medium"),
                            confidence=int(finding.get("confidence", 0)),
                            current_state=finding.get("currentState", {}),
                            expected_state=finding.get("expectedState", {}),
                            rationale=finding.get("rationale"),
                            status=finding.get("status", "open"),
                        )
                    )

                    # Persist parent row before child actions to avoid FK races in batched inserts.
                    await db.flush()

                    for action in finding.get("actions", []):
                        db.add(
                            ComplianceAction(
                                id=str(uuid.uuid4()),
                                finding_id=finding_id,
                                action_type=action.get("actionType", "noop"),
                                source_path=action.get("sourcePath"),
                                target_path=action.get("targetPath"),
                                payload=action.get("payload", {}),
                                selected=bool(action.get("selected", True)),
                            )
                        )

                await db.commit()
            except IntegrityError as exc:
                await db.rollback()
                logger.error(
                    "Failed to persist compliance findings",
                    scan_id=scan_id,
                    findings_count=len(findings),
                    error=str(exc),
                )
                raise

    def _discover_movie_folders(self, library_path: str) -> List[str]:
        if not os.path.isdir(library_path):
            return []

        discovered = []
        for root, dirs, files in os.walk(library_path):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d != "@eaDir"]
            has_video = any(self._is_video_file(name) for name in files)
            if has_video:
                discovered.append(root)
        return discovered

    def _discover_show_folders(self, library_path: str) -> List[str]:
        if not os.path.isdir(library_path):
            return []

        discovered = []
        for entry in sorted(os.listdir(library_path), key=str.lower):
            show_path = os.path.join(library_path, entry)
            if not os.path.isdir(show_path):
                continue

            try:
                subdirs = [
                    d
                    for d in os.listdir(show_path)
                    if os.path.isdir(os.path.join(show_path, d)) and not d.startswith(".")
                ]
            except OSError:
                continue

            has_season_like_folder = any(
                re.match(r"^(season\s+\d{1,2}|s\d{1,2}|specials)$", d, re.IGNORECASE)
                for d in subdirs
            )
            if has_season_like_folder:
                discovered.append(show_path)

        return discovered

    @classmethod
    def _is_extras_folder_name(cls, folder_name: str) -> bool:
        return folder_name.strip().lower() in cls.EXTRA_FOLDERS

    @classmethod
    def _movie_title_folder_for_path(cls, folder_path: str) -> str:
        """Return the nearest ancestor that is not an extras/special folder."""
        current = folder_path
        while True:
            base = os.path.basename(current)
            parent = os.path.dirname(current)
            if parent == current:
                return current
            if not cls._is_extras_folder_name(base):
                return current
            current = parent

    @classmethod
    def _preferred_extras_subfolder(cls, movie_title_folder: str, source_dir: str) -> str:
        """Select a single extras subfolder directly under the movie title folder."""
        try:
            rel = os.path.relpath(source_dir, movie_title_folder)
        except ValueError:
            rel = os.path.basename(source_dir)

        if rel in (".", ""):
            return "Extras"

        parts = [part for part in rel.split(os.sep) if part and part != "."]
        for part in parts:
            if cls._is_extras_folder_name(part):
                return part
        return "Extras"

    @classmethod
    def _is_probable_special_feature_file(cls, stem: str) -> bool:
        stem_lower = stem.strip().lower()
        stem_normalized = re.sub(r"[._-]+", " ", stem_lower)
        stem_normalized = re.sub(r"\s+", " ", stem_normalized).strip()

        if stem_normalized in cls.COMPANION_LABELS:
            return True

        if re.search(
            r"(making[ ._-]?of|behind[ ._-]?the[ ._-]?scenes|featurette|deleted[ ._-]?scenes?|extras?|bonus|trailer|bloopers|gag[ ._-]?reel)",
            stem,
            re.IGNORECASE,
        ):
            return True

        # MakeMKV-style tracks: B1_t00, C2-t01, or title suffixes like "Movie-C2 t01"
        if re.fullmatch(r"[A-Za-z]+\d+[_-]t\d+", stem):
            return True
        if re.search(r"[\s._-]+[A-Za-z]+\d+[\s._-]*t\d+$", stem, re.IGNORECASE):
            return True

        # Numbered companion style like "01. Behind the Scenes"
        if re.match(r"^\d{1,2}[.\s]\s*", stem):
            return True

        return False


    def _analyze_movie_folder(
        self,
        folder_path: str,
        media_type: str,
        claimed_targets_global: Optional[set] = None,
    ) -> List[Dict[str, Any]]:
        findings: List[Dict[str, Any]] = []

        try:
            entries = os.listdir(folder_path)
        except OSError:
            return findings

        files = [f for f in entries if os.path.isfile(os.path.join(folder_path, f))]
        video_files = [f for f in files if self._is_video_file(f)]

        if not video_files:
            return findings

        folder_name = os.path.basename(folder_path)
        movie_title_folder = self._movie_title_folder_for_path(folder_path)
        is_title_folder = os.path.normpath(folder_path) == os.path.normpath(movie_title_folder)

        # Only check for year token if this is the main movie folder, not a known extras/special subfolder
        parent_folder = os.path.dirname(folder_path)
        parent_name = os.path.basename(parent_folder)
        # If the folder name is a known extra, skip year check
        if is_title_folder and not self._is_extras_folder_name(folder_name):
            # But if the parent is a movie folder (contains a year), check only the parent
            if not re.search(r"\(\d{4}\)", folder_name):
                findings.append(
                    {
                        "mediaType": media_type,
                        "folderPath": folder_path,
                        "issueType": "naming_mismatch",
                        "severity": "medium",
                        "confidence": 70,
                        "currentState": {"folderName": folder_name},
                        "expectedState": {"pattern": "Title (Year)"},
                        "rationale": "Movie folder name is missing a year token, which can reduce Jellyfin matching quality.",
                        "actions": [
                            {
                                "actionType": "noop",
                                "sourcePath": None,
                                "targetPath": None,
                                "payload": {"suggestedFolderName": f"{folder_name} (YYYY)"},
                                "selected": True,
                            }
                        ],
                    }
                )

        file_infos = []
        for file_name in video_files:
            full_path = os.path.join(folder_path, file_name)
            try:
                size = os.path.getsize(full_path)
            except OSError:
                size = 0
            file_infos.append({"name": file_name, "path": full_path, "size": size})

        file_infos.sort(key=lambda item: item["size"], reverse=True)
        claimed_targets: set = claimed_targets_global if claimed_targets_global is not None else set()
        main_feature_infos = [
            item for item in file_infos
            if not self._is_probable_special_feature_file(os.path.splitext(str(item["name"]))[0])
        ]

        if is_title_folder and len(main_feature_infos) >= 2:
            largest = main_feature_infos[0]
            second = main_feature_infos[1]
            if largest["size"] > 0 and second["size"] >= largest["size"] * 0.80:
                largest_quality = self._quality_label_for_file(str(largest["path"]))
                second_quality = self._quality_label_for_file(str(second["path"]))
                largest_ext = os.path.splitext(str(largest["name"]))[1]
                second_ext = os.path.splitext(str(second["name"]))[1]

                primary_target = self._unique_target_path(
                    os.path.join(folder_path, f"{folder_name} [{largest_quality}]{largest_ext}"),
                    claimed_targets,
                )
                secondary_target = self._unique_target_path(
                    os.path.join(folder_path, f"{folder_name} [{second_quality}]{second_ext}"),
                    claimed_targets,
                )

                findings.append(
                    {
                        "mediaType": media_type,
                        "folderPath": folder_path,
                        "filePath": second["path"],
                        "issueType": "duplicate_main_feature",
                        "severity": "high",
                        "confidence": 82,
                        "currentState": {
                            "primaryCandidate": largest["name"],
                            "secondaryCandidate": second["name"],
                            "primaryQuality": largest_quality,
                            "secondaryQuality": second_quality,
                        },
                        "expectedState": {
                            "rule": "Main-feature variants should be explicitly differentiated by quality",
                        },
                        "rationale": "Multiple similarly-sized main-feature candidates were detected in this movie folder.",
                        "actions": [
                            {
                                "actionType": "rename",
                                "sourcePath": largest["path"],
                                "targetPath": primary_target,
                                "payload": {
                                    "reason": "label_primary_candidate_with_quality",
                                    "quality": largest_quality,
                                },
                                "selected": True,
                            },
                            {
                                "actionType": "rename",
                                "sourcePath": second["path"],
                                "targetPath": secondary_target,
                                "payload": {
                                    "reason": "label_secondary_candidate_with_quality",
                                    "quality": second_quality,
                                },
                                "selected": True,
                            },
                            {
                                "actionType": "noop",
                                "sourcePath": None,
                                "targetPath": None,
                                "payload": {"reason": "manual_review_required"},
                                "selected": False,
                            },
                        ],
                    }
                )

        folder_has_extras = os.path.isdir(os.path.join(folder_path, "Extras"))

        for info in file_infos:
            name = str(info["name"])
            full_path = str(info["path"])
            stem = os.path.splitext(name)[0]

            is_special_feature_hint = self._is_probable_special_feature_file(stem)

            if is_special_feature_hint and os.path.dirname(full_path) == folder_path:
                source_dir = os.path.dirname(full_path)
                movie_title_folder = self._movie_title_folder_for_path(source_dir)
                preferred_subfolder = self._preferred_extras_subfolder(movie_title_folder, source_dir)
                target_parent = os.path.join(movie_title_folder, preferred_subfolder)

                # Already compliant: special feature file is exactly one folder below the title folder.
                if os.path.normpath(source_dir) == os.path.normpath(target_parent):
                    continue

                target = self._unique_target_path(
                    os.path.join(target_parent, name), claimed_targets
                )
                findings.append(
                    {
                        "mediaType": media_type,
                        "folderPath": movie_title_folder,
                        "filePath": full_path,
                        "issueType": "misplaced_special_feature",
                        "severity": "medium",
                        "confidence": 88,
                        "currentState": {
                            "location": source_dir,
                            "fileName": name,
                            "extrasFolderPresent": folder_has_extras,
                        },
                        "expectedState": {
                            "location": target_parent,
                        },
                        "rationale": "File appears to be a special feature but is not located one folder below the movie title folder.",
                        "actions": [
                            {
                                "actionType": "move",
                                "sourcePath": full_path,
                                "targetPath": target,
                                "payload": {"createParent": True},
                                "selected": True,
                            }
                        ],
                    }
                )

            if is_title_folder and not is_special_feature_hint:
                folder_clean = self._clean_compare(folder_name)
                file_clean = self._clean_compare(stem)
                if folder_clean and folder_clean not in file_clean:
                    base_target = os.path.join(
                        folder_path,
                        f"{folder_name}{os.path.splitext(name)[1]}",
                    )
                    unique_target = self._unique_target_path(base_target, claimed_targets)
                    target_file_name = os.path.basename(unique_target)
                    findings.append(
                        {
                            "mediaType": media_type,
                            "folderPath": folder_path,
                            "filePath": full_path,
                            "issueType": "naming_mismatch",
                            "severity": "low",
                            "confidence": 60,
                            "currentState": {"fileName": name},
                            "expectedState": {"suggestedFileName": target_file_name},
                            "rationale": "Main feature filename does not resemble the movie folder identity.",
                            "actions": [
                                {
                                    "actionType": "rename",
                                    "sourcePath": full_path,
                                    "targetPath": unique_target,
                                    "payload": {},
                                    "selected": True,
                                }
                            ],
                        }
                    )

        return findings

    def _analyze_show_folder(self, folder_path: str, media_type: str) -> List[Dict[str, Any]]:
        findings: List[Dict[str, Any]] = []
        show_name = os.path.basename(folder_path)

        try:
            entries = sorted(os.listdir(folder_path), key=str.lower)
        except OSError:
            return findings

        season_dirs = [
            name for name in entries
            if os.path.isdir(os.path.join(folder_path, name)) and not name.startswith(".")
        ]

        season_name_re = re.compile(r"^Season\s+(\d{2})$", re.IGNORECASE)
        season_token_re = re.compile(r"^S(\d{1,2})$", re.IGNORECASE)
        specials_dir_re = re.compile(r"^Specials$", re.IGNORECASE)
        episode_token_re = re.compile(r"S\d{2}E\d{2}(?:E\d{2})?", re.IGNORECASE)
        unknown_episode_re = re.compile(r"unknown\s*episode", re.IGNORECASE)

        for season_dir in season_dirs:
            season_path = os.path.join(folder_path, season_dir)
            season_match = season_name_re.match(season_dir)
            season_token_match = season_token_re.match(season_dir)
            is_specials_dir = bool(specials_dir_re.match(season_dir))

            expected_season_dir = season_dir
            if season_token_match:
                season_number = int(season_token_match.group(1))
                expected_season_dir = f"Season {season_number:02d}"
            elif season_match:
                season_number = int(season_match.group(1))
                expected_season_dir = f"Season {season_number:02d}"
            else:
                season_number = None

            if not is_specials_dir and not season_match:
                findings.append(
                    {
                        "mediaType": media_type,
                        "folderPath": season_path,
                        "issueType": "season_folder_naming_mismatch",
                        "severity": "medium",
                        "confidence": 90,
                        "currentState": {"seasonFolder": season_dir},
                        "expectedState": {"pattern": "Season 01", "suggestedFolder": expected_season_dir},
                        "rationale": "Season folder does not follow Jellyfin season folder naming convention.",
                        "actions": [
                            {
                                "actionType": "rename",
                                "sourcePath": season_path,
                                "targetPath": os.path.join(folder_path, expected_season_dir),
                                "payload": {},
                                "selected": True,
                            }
                        ],
                    }
                )

            try:
                season_files = [
                    f
                    for f in os.listdir(season_path)
                    if os.path.isfile(os.path.join(season_path, f)) and self._is_video_file(f)
                ]
            except OSError:
                season_files = []

            for file_name in season_files:
                file_path = os.path.join(season_path, file_name)
                stem, ext = os.path.splitext(file_name)

                if is_specials_dir:
                    if not re.search(r"S00E\d{2}", stem, re.IGNORECASE):
                        safe_show = show_name.strip() or "Show"
                        findings.append(
                            {
                                "mediaType": media_type,
                                "folderPath": season_path,
                                "filePath": file_path,
                                "issueType": "specials_misplaced",
                                "severity": "medium",
                                "confidence": 78,
                                "currentState": {"fileName": file_name, "seasonFolder": season_dir},
                                "expectedState": {"pattern": f"{safe_show} S00E01{ext}"},
                                "rationale": "Specials folder episodes should use S00E## numbering for Jellyfin.",
                                "actions": [
                                    {
                                        "actionType": "noop",
                                        "sourcePath": None,
                                        "targetPath": None,
                                        "payload": {"suggestedPattern": f"{safe_show} S00E##{ext}"},
                                        "selected": True,
                                    }
                                ],
                            }
                        )
                    continue

                # For normal seasons, detect files that look like specials but are not in Specials.
                if re.search(r"S00E\d{2}", stem, re.IGNORECASE):
                    target_specials_dir = os.path.join(folder_path, "Specials")
                    findings.append(
                        {
                            "mediaType": media_type,
                            "folderPath": season_path,
                            "filePath": file_path,
                            "issueType": "specials_misplaced",
                            "severity": "high",
                            "confidence": 92,
                            "currentState": {"fileName": file_name, "seasonFolder": season_dir},
                            "expectedState": {"location": target_specials_dir},
                            "rationale": "S00 episodes should be located in a Specials folder.",
                            "actions": [
                                {
                                    "actionType": "move",
                                    "sourcePath": file_path,
                                    "targetPath": os.path.join(target_specials_dir, file_name),
                                    "payload": {"createParent": True},
                                    "selected": True,
                                }
                            ],
                        }
                    )
                    continue

                if season_number is not None and not episode_token_re.search(stem):
                    safe_show = show_name.strip() or "Show"
                    suggested_name = f"{safe_show} S{season_number:02d}E01{ext}"
                    issue_type = "unknown_episode_pattern" if unknown_episode_re.search(stem) else "episode_naming_mismatch"
                    findings.append(
                        {
                            "mediaType": media_type,
                            "folderPath": season_path,
                            "filePath": file_path,
                            "issueType": issue_type,
                            "severity": "medium",
                            "confidence": 72,
                            "currentState": {"fileName": file_name, "seasonFolder": season_dir},
                            "expectedState": {"pattern": f"{safe_show} S{season_number:02d}E##{ext}", "suggestedFileName": suggested_name},
                            "rationale": "Episode filename does not include expected SxxExx numbering for this season.",
                            "actions": [
                                {
                                    "actionType": "noop",
                                    "sourcePath": None,
                                    "targetPath": None,
                                    "payload": {"suggestedFileName": suggested_name},
                                    "selected": True,
                                }
                            ],
                        }
                    )

        return findings

    @staticmethod
    def _unique_target_path(target_path: str, claimed: set) -> str:
        """Return a path guaranteed to be absent on disk and not already claimed in this scan pass."""
        if target_path not in claimed and not os.path.exists(target_path):
            claimed.add(target_path)
            return target_path
        base, ext = os.path.splitext(target_path)
        counter = 1
        while True:
            candidate = f"{base} ({counter}){ext}"
            if candidate not in claimed and not os.path.exists(candidate):
                claimed.add(candidate)
                return candidate
            counter += 1

    def _quality_label_for_file(self, file_path: str) -> str:
        """Extract a compact quality label from media metadata, with filename fallback."""
        try:
            metadata_extractor = getattr(self.file_manager, "metadata_extractor", None)
            if metadata_extractor:
                metadata = metadata_extractor.extract_full_metadata(file_path)
                video_metadata = metadata.get("videoMetadata") if metadata else None
                if isinstance(video_metadata, dict):
                    category = video_metadata.get("resolutionCategory")
                    if category:
                        return str(category)

                    height = video_metadata.get("height")
                    if isinstance(height, int) and height > 0:
                        return f"{height}p"
        except Exception:
            pass

        stem = os.path.splitext(os.path.basename(file_path))[0]
        quality_hint = re.search(r"(2160p|1080p|720p|576p|480p|4k|8k|uhd|fhd|hd|sd)", stem, re.IGNORECASE)
        if quality_hint:
            token = quality_hint.group(1).upper()
            if token == "UHD":
                return "4K"
            if token == "FHD":
                return "1080p"
            return token

        return "Unknown"

    @staticmethod
    def _clean_compare(value: str) -> str:
        lowered = value.lower()
        lowered = re.sub(r"\[.*?\]", "", lowered)
        lowered = re.sub(r"\(\d{4}\)", "", lowered)
        lowered = re.sub(r"[^a-z0-9]+", " ", lowered)
        return " ".join(lowered.split()).strip()

    @staticmethod
    def _is_video_file(file_name: str) -> bool:
        ext = os.path.splitext(file_name)[1].lower()
        return ext in settings.supported_video_extensions

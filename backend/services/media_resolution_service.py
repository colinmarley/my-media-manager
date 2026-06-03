"""
Media Resolution Service — Postgres stub
=========================================
This service previously resolved media records from Firestore.
Firestore has been removed; all methods return None until a
Postgres implementation is added in a future phase.
"""

from typing import Any, Dict, Optional
from utils.logging import logger


class MediaResolutionService:
    def __init__(self):
        pass

    async def resolve_assignment_media(self, assignment_doc: Dict, media_payload: Dict) -> Optional[Dict]:
        return None

    async def resolve_episode_assignment(self, assignment_doc: Dict, media_payload: Dict) -> Optional[Dict]:
        return None

    async def _media_exists(self, media_id: str, media_type: str) -> bool:
        return False

    async def _find_media_by_imdb_id(self, imdb_id: str, media_type: str) -> Optional[Dict]:
        return None

    async def _create_placeholder_media(self, media_payload: Dict, media_type: str) -> Optional[Dict]:
        return None

    async def _resolve_season(self, series_id: str, season_number: int) -> Optional[str]:
        return None

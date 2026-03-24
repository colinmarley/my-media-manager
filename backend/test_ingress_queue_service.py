#!/usr/bin/env python3

import unittest
import asyncio
from dataclasses import dataclass

from services.ingress_queue_service import (
    IngressQueueService,
    QUEUE_AUTO_ASSIGNED,
    QUEUE_COMPLETED,
    QUEUE_FAILED,
    QUEUE_NEEDS_REVIEW,
    QUEUE_PENDING,
)


@dataclass
class MockQueuedIngressFile:
    file_path: str
    file_name: str
    ingress_path: str
    detected_at: float
    queued_at: float
    file_size: int
    last_event_type: str


class MockAutoMatcher:
    def search_and_match(self, parsed_info):
        return {
            "status": "success",
            "found": True,
            "candidates": [
                {
                    "title": "The Matrix",
                    "media_type": "movie",
                    "imdb_id": "tt0133093",
                    "confidence_score": 92,
                }
            ],
            "best_match": {
                "title": "The Matrix",
                "media_type": "movie",
                "imdb_id": "tt0133093",
                "confidence_score": 92,
            },
        }


class MockAssignmentOrchestrator:
    async def auto_assign(self, queue_item):
        return "assignment-123"


class IngressQueueServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = IngressQueueService()

    def test_process_next_item_uses_matcher_and_assignment(self):
        service = IngressQueueService(
            auto_matcher_service=MockAutoMatcher(),
            assignment_orchestrator=MockAssignmentOrchestrator(),
        )
        service.add_from_watcher(self._build_item("The.Matrix.1999.1080p.mkv"))

        processed = asyncio.run(service.process_next_item())

        self.assertEqual(processed.confidence_score, 92)
        self.assertEqual(processed.status, QUEUE_AUTO_ASSIGNED)
        self.assertEqual(processed.assignment_id, "assignment-123")

    def _build_item(self, file_name: str) -> MockQueuedIngressFile:
        return MockQueuedIngressFile(
            file_path=f"/data/media/encoded/{file_name}",
            file_name=file_name,
            ingress_path="/data/media/encoded",
            detected_at=1.0,
            queued_at=2.0,
            file_size=100,
            last_event_type="created",
        )

    def test_add_from_watcher_deduplicates_by_file_path(self):
        first = self.service.add_from_watcher(self._build_item("movie.mkv"))
        second = self.service.add_from_watcher(self._build_item("movie.mkv"))

        self.assertEqual(first.id, second.id)
        self.assertEqual(len(self.service.get_queue_items()), 1)

    def test_process_next_item_movie_auto_assigned(self):
        self.service.add_from_watcher(self._build_item("The.Matrix.1999.1080p.mkv"))
        processed = asyncio.run(self.service.process_next_item())

        self.assertIsNotNone(processed)
        self.assertIn(processed.status, [QUEUE_AUTO_ASSIGNED, QUEUE_NEEDS_REVIEW])
        self.assertEqual(processed.parsed_info["media_type"], "movie")

    def test_retry_and_marking_states(self):
        queue_item = self.service.add_from_watcher(self._build_item("clip.mkv"))

        failed = asyncio.run(self.service.mark_failed(queue_item.id, "test failure"))
        self.assertEqual(failed.status, QUEUE_FAILED)

        retried = asyncio.run(self.service.retry_item(queue_item.id))
        self.assertEqual(retried.status, QUEUE_PENDING)

        completed = asyncio.run(self.service.mark_complete(queue_item.id))
        self.assertEqual(completed.status, QUEUE_COMPLETED)


if __name__ == "__main__":
    unittest.main()
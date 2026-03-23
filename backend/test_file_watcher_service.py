#!/usr/bin/env python3

import os
import tempfile
import time
import unittest

from services.file_watcher_service import FileWatcherService


class FileWatcherServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.ingress_dir = self.temp_dir.name
        self.queued_items = []

        self.service = FileWatcherService(queue_callback=self.queued_items.append)
        self.service.file_stability_wait_seconds = 0
        self.service.event_debounce_seconds = 0
        self.service.stability_poll_interval_seconds = 0.01
        self.service.watched_paths = [os.path.abspath(self.ingress_dir)]

    def tearDown(self):
        self.service.stop_event.set()
        self.temp_dir.cleanup()

    def test_registers_supported_file_event(self):
        file_path = os.path.join(self.ingress_dir, "movie.mkv")
        with open(file_path, "wb") as handle:
            handle.write(b"test")

        tracked = self.service.on_file_created(file_path)

        self.assertTrue(tracked)
        self.assertIn(os.path.abspath(file_path), self.service.pending_files)

    def test_ignores_unsupported_file_event(self):
        file_path = os.path.join(self.ingress_dir, "notes.txt")
        with open(file_path, "w", encoding="utf-8") as handle:
            handle.write("ignore me")

        tracked = self.service.on_file_created(file_path)

        self.assertFalse(tracked)
        self.assertEqual(len(self.service.pending_files), 0)

    def test_queues_stable_file_once(self):
        file_path = os.path.join(self.ingress_dir, "episode.mkv")
        with open(file_path, "wb") as handle:
            handle.write(b"content")

        self.service.on_file_created(file_path)
        self.assertFalse(self.service.is_file_stable(file_path))
        self.assertTrue(self.service.is_file_stable(file_path))

        queue_item = self.service.queue_for_processing(file_path)
        duplicate_queue_item = self.service.queue_for_processing(file_path)

        self.assertIsNotNone(queue_item)
        self.assertIsNone(duplicate_queue_item)
        self.assertEqual(queue_item.file_name, "episode.mkv")
        self.assertEqual(len(self.queued_items), 1)
        self.assertEqual(self.service.get_status()["queue_count"], 1)

    def test_start_and_stop_watching(self):
        watcher_service = FileWatcherService()
        watcher_service.file_stability_wait_seconds = 0
        watcher_service.event_debounce_seconds = 0
        watcher_service.stability_poll_interval_seconds = 0.05

        try:
            status = watcher_service.start_watching([self.ingress_dir], use_polling=True)
            self.assertTrue(status["is_running"])

            file_path = os.path.join(self.ingress_dir, "watch_test.mkv")
            with open(file_path, "wb") as handle:
                handle.write(b"watch")

            deadline = time.time() + 3
            while time.time() < deadline:
                if watcher_service.get_status()["queue_count"] > 0:
                    break
                time.sleep(0.05)

            self.assertGreater(watcher_service.get_status()["queue_count"], 0)
        finally:
            stop_status = watcher_service.stop_watching()
            self.assertFalse(stop_status["is_running"])


if __name__ == "__main__":
    unittest.main()
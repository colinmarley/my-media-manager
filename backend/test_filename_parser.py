#!/usr/bin/env python3

import unittest

from services.filename_parser import FilenameParser


class FilenameParserTests(unittest.TestCase):
    def setUp(self):
        self.parser = FilenameParser()

    def test_parses_episode_sxxexx_pattern(self):
        parsed = self.parser.parse_filename("Firefly.S01E02.1080p.BluRay.mkv")

        self.assertEqual(parsed.media_type, "episode")
        self.assertEqual(parsed.title, "Firefly")
        self.assertEqual(parsed.season, 1)
        self.assertEqual(parsed.episode, 2)
        self.assertEqual(parsed.quality, "1080p")

    def test_parses_episode_x_pattern(self):
        parsed = self.parser.parse_filename("The Office 2x04 WEB-DL.mkv")

        self.assertEqual(parsed.media_type, "episode")
        self.assertEqual(parsed.title, "The Office")
        self.assertEqual(parsed.season, 2)
        self.assertEqual(parsed.episode, 4)

    def test_parses_movie_with_year(self):
        parsed = self.parser.parse_filename("The.Matrix.1999.4K.HEVC.mkv")

        self.assertEqual(parsed.media_type, "movie")
        self.assertEqual(parsed.title, "The Matrix")
        self.assertEqual(parsed.year, 1999)
        self.assertEqual(parsed.quality, "4k")

    def test_returns_unknown_when_insufficient_hints(self):
        parsed = self.parser.parse_filename("Some Random Clip.mkv")

        self.assertEqual(parsed.media_type, "unknown")
        self.assertEqual(parsed.title, "Some Random Clip")
        self.assertIsNone(parsed.year)


if __name__ == "__main__":
    unittest.main()
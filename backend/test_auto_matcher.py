#!/usr/bin/env python3

import unittest
from services.auto_matcher_service import AutoMatcherService, MatchCandidate


class AutoMatcherServiceTests(unittest.TestCase):
    def setUp(self):
        # Use mock/dummy OMDB key for testing (won't make actual API calls in unit tests)
        self.matcher = AutoMatcherService(omdb_api_key="test_key")

    def test_fuzzy_match_titles_exact(self):
        """Test exact title matching."""
        ratio = self.matcher._fuzzy_match_titles("The Matrix", "The Matrix")
        self.assertEqual(ratio, 1.0)

    def test_fuzzy_match_titles_similar(self):
        """Test similar title matching."""
        ratio = self.matcher._fuzzy_match_titles("The Matrix", "Matrix")
        self.assertGreater(ratio, 0.7)
        self.assertLess(ratio, 1.0)

    def test_normalize_title(self):
        """Test title normalization."""
        normalized = self.matcher._normalize_title("The Matrix (1999)")
        self.assertEqual(normalized, "the matrix 1999")

    def test_parse_year_formats(self):
        """Test year extraction from various formats."""
        self.assertEqual(self.matcher._parse_year("1999"), 1999)
        self.assertEqual(self.matcher._parse_year("1999–2003"), 1999)
        self.assertEqual(self.matcher._parse_year("(1999)"), 1999)
        self.assertIsNone(self.matcher._parse_year(""))
        self.assertIsNone(self.matcher._parse_year("Unknown"))

    def test_calculate_confidence_movie_with_year(self):
        """Test confidence scoring for movies with year match."""
        candidate = MatchCandidate(
            source="omdb",
            media_id="tt0133093",
            title="The Matrix",
            media_type="movie",
            year=1999,
        )
        parsed_info = {
            "media_type": "movie",
            "title": "The Matrix",
            "year": 1999,
        }
        score = self.matcher._calculate_confidence(candidate, parsed_info)
        self.assertGreater(score, 75)  # Should be high confidence for exact match

    def test_calculate_confidence_episode(self):
        """Test confidence scoring for episodes."""
        candidate = MatchCandidate(
            source="omdb",
            media_id="tt0944947",
            title="Game of Thrones",
            media_type="series",
            year=2011,
        )
        parsed_info = {
            "media_type": "episode",
            "title": "Game of Thrones",
            "season": 1,
            "episode": 1,
        }
        score = self.matcher._calculate_confidence(candidate, parsed_info)
        self.assertGreater(score, 60)


if __name__ == "__main__":
    unittest.main()

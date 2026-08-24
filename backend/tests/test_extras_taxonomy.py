"""Tests for backend/services/extras_taxonomy.py"""

from services.extras_taxonomy import (
    CATEGORIES,
    CATEGORY_TO_FOLDER,
    FOLDER_TO_CATEGORY,
    EXTRA_FOLDER_NAMES,
    classify_extra_from_stem,
    classify_extra_category_from_stem,
    folder_for_category,
)


def test_every_category_has_a_folder_mapping():
    for category in CATEGORIES:
        assert category in CATEGORY_TO_FOLDER
        assert CATEGORY_TO_FOLDER[category]


def test_folder_to_category_is_a_true_inverse():
    for category, folder in CATEGORY_TO_FOLDER.items():
        assert FOLDER_TO_CATEGORY[folder] == category


def test_all_canonical_folders_are_in_extra_folder_names():
    for folder in CATEGORY_TO_FOLDER.values():
        assert folder in EXTRA_FOLDER_NAMES
    # Uncategorized-but-recognized folders should also be present
    assert "extras" in EXTRA_FOLDER_NAMES
    assert "theme-music" in EXTRA_FOLDER_NAMES
    assert "backdrops" in EXTRA_FOLDER_NAMES


def test_folder_for_category_matches_the_table():
    assert folder_for_category("trailer") == "trailers"
    assert folder_for_category("deleted_scene") == "deleted scenes"
    assert folder_for_category("blooper") == "bloopers"


def test_folder_for_category_unknown_returns_none():
    assert folder_for_category("not_a_real_category") is None


# ── classify_extra_from_stem ────────────────────────────────────────────────

def test_classify_exact_folder_name_match():
    assert classify_extra_from_stem("trailers") == "trailers"
    assert classify_extra_from_stem("deleted scenes") == "deleted scenes"


def test_classify_singular_variant_match():
    assert classify_extra_from_stem("trailer") == "trailers"
    assert classify_extra_from_stem("interview") == "interviews"


def test_classify_no_space_variant_match():
    assert classify_extra_from_stem("behindthescenes") == "behind the scenes"
    assert classify_extra_from_stem("deletedscenes") == "deleted scenes"


def test_classify_suffix_token_at_end_of_stem():
    assert classify_extra_from_stem("Movie Title-trailer") == "trailers"
    assert classify_extra_from_stem("Movie Title.deleted") == "deleted scenes"
    assert classify_extra_from_stem("Movie Title_featurette") == "featurettes"
    assert classify_extra_from_stem("Movie Title-blooper") == "bloopers"
    assert classify_extra_from_stem("Movie Title-gagreel") == "bloopers"


def test_classify_suffix_token_must_be_at_the_end():
    # "trailer" appears but not as a trailing token preceded by a separator
    assert classify_extra_from_stem("trailerpark") is None


def test_classify_no_match_returns_none():
    assert classify_extra_from_stem("Inception (2010)") is None
    assert classify_extra_from_stem("random_filename_123") is None


def test_classify_case_insensitive():
    assert classify_extra_from_stem("TRAILER") == "trailers"
    assert classify_extra_from_stem("Deleted Scenes") == "deleted scenes"


def test_classify_trailing_space_variants():
    assert classify_extra_from_stem("Movie Title trailer") == "trailers"
    assert classify_extra_from_stem("Movie Title sample") == "samples"


# ── classify_extra_category_from_stem ───────────────────────────────────────

def test_classify_category_returns_slug_not_folder():
    assert classify_extra_category_from_stem("trailer") == "trailer"
    assert classify_extra_category_from_stem("deleted scenes") == "deleted_scene"
    assert classify_extra_category_from_stem("behindthescenes") == "behind_the_scenes"


def test_classify_category_no_match_returns_none():
    assert classify_extra_category_from_stem("Inception (2010)") is None


def test_classify_category_uncategorized_folder_returns_none():
    # "extras"/"theme-music"/"backdrops" are recognized folders but have no
    # CATEGORY slug (see _UNCATEGORIZED_EXTRA_FOLDERS) — still needs review.
    assert classify_extra_category_from_stem("extras") is None
    assert classify_extra_category_from_stem("theme-music") is None

"""
Shared taxonomy for non-main-feature ("extras") media files: deleted scenes,
trailers, behind-the-scenes footage, etc.

This is the single source of truth for extras classification, replacing three
independent copies that previously existed (jellyfin_movie_organizer.py,
jellyfin_show_organizer.py, library_compliance_service.py) and disagreed with
each other in places. It provides two related but distinct vocabularies:

- CATEGORY: a stable slug (e.g. "deleted_scene") stored in
  AssignmentExtraFile.category and used by the API/review UI.
- FOLDER: the on-disk Jellyfin extras subfolder name (e.g. "deleted scenes")
  that files actually get moved into.

`CATEGORY_TO_FOLDER` / `FOLDER_TO_CATEGORY` translate between the two.
"""

import re
from typing import Dict, Optional, Set

# Canonical category slugs, in the order they should be offered in review UIs.
CATEGORIES = [
    "behind_the_scenes",
    "deleted_scene",
    "interview",
    "featurette",
    "trailer",
    "scene",
    "sample",
    "short",
    "clip",
    "blooper",
    "other",
]

CATEGORY_TO_FOLDER: Dict[str, str] = {
    "behind_the_scenes": "behind the scenes",
    "deleted_scene": "deleted scenes",
    "interview": "interviews",
    "featurette": "featurettes",
    "trailer": "trailers",
    "scene": "scenes",
    "sample": "samples",
    "short": "shorts",
    "clip": "clips",
    "blooper": "bloopers",
    "other": "other",
}

FOLDER_TO_CATEGORY: Dict[str, str] = {v: k for k, v in CATEGORY_TO_FOLDER.items()}

# Additional Jellyfin-recognized extras folders that this taxonomy doesn't
# assign a review category to (no corresponding CATEGORY slug), but that
# _classify_extra_from_stem/EXTRA_FOLDERS still need to recognize as valid
# "this is an extras folder" names for the movie/show organizers and the
# compliance scanner.
_UNCATEGORIZED_EXTRA_FOLDERS = {"extras", "theme-music", "backdrops"}

# All valid on-disk extras folder names (used by library_compliance_service's
# membership check).
EXTRA_FOLDER_NAMES: Set[str] = set(CATEGORY_TO_FOLDER.values()) | _UNCATEGORIZED_EXTRA_FOLDERS

# Friendly-name-variant -> canonical folder name. Includes singular/plural,
# no-space forms, so a literal folder name found on disk (however it was
# spelled) normalizes to one canonical folder name.
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
    "bloopers": "bloopers",
    "blooper": "bloopers",
    "gag reel": "bloopers",
    "gagreel": "bloopers",
}

# Filename-suffix token (e.g. "-trailer.mkv") -> canonical folder name.
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
    "blooper": "bloopers",
    "gagreel": "bloopers",
}

_SUFFIX_TOKEN_RE = re.compile(
    r"(?:[ ._-]|^)(trailer|sample|scene|clip|interview|behindthescenes|"
    r"deletedscene|deleted|featurette|short|other|extra|blooper|gagreel)$"
)


def classify_extra_from_stem(stem: str) -> Optional[str]:
    """
    Infer the canonical on-disk FOLDER name for an extra file from its
    filename stem (no extension), or None if no pattern matches.
    """
    lowered = stem.strip().lower()
    if lowered in EXTRA_FOLDERS:
        return EXTRA_FOLDERS[lowered]

    tokenized = re.sub(r"[\s._-]+", " ", lowered).strip()
    if tokenized in EXTRA_FOLDERS:
        return EXTRA_FOLDERS[tokenized]

    if lowered.endswith(" trailer"):
        return "trailers"
    if lowered.endswith(" sample"):
        return "samples"

    m = _SUFFIX_TOKEN_RE.search(lowered)
    if m:
        return EXTRA_SUFFIX_TO_FOLDER.get(m.group(1))

    return None


def classify_extra_category_from_stem(stem: str) -> Optional[str]:
    """
    Infer the CATEGORY slug (for AssignmentExtraFile.category / the review UI)
    for an extra file from its filename stem. Returns None both when no
    pattern matches and when a pattern matches an uncategorized folder (e.g.
    "extras", "theme-music") — those still need manual review either way.
    """
    folder = classify_extra_from_stem(stem)
    if folder is None:
        return None
    return FOLDER_TO_CATEGORY.get(folder)


def folder_for_category(category: str) -> Optional[str]:
    """Canonical on-disk folder name for a category slug, or None if unknown."""
    return CATEGORY_TO_FOLDER.get(category)

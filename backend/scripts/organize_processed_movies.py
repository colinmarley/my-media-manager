#!/usr/bin/env python3
"""Reorganize processed Jellyfin movie folders to improve main/extras detection.

Usage:
    python scripts/organize_processed_movies.py --dry-run
    python scripts/organize_processed_movies.py --apply
    python scripts/organize_processed_movies.py --apply --movies-root /path/to/Movies
"""

import argparse
import json

from services.jellyfin_movie_organizer import JellyfinMovieOrganizer


def main() -> int:
    parser = argparse.ArgumentParser(description="Reorganize processed movie folders for Jellyfin")
    parser.add_argument(
        "--movies-root",
        dest="movies_root",
        default=None,
        help="Optional explicit path to the Movies root folder",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes (default mode is dry-run)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview only; do not modify files (default)",
    )
    parser.add_argument(
        "--limit-actions",
        type=int,
        default=200,
        help="Max actions to print in output summary",
    )

    args = parser.parse_args()
    dry_run = not args.apply
    if args.dry_run:
        dry_run = True

    organizer = JellyfinMovieOrganizer(dry_run=dry_run)
    result = organizer.reorganize_all_movies(movies_root=args.movies_root)

    actions = result.get("actions", [])
    shown_actions = actions[: max(args.limit_actions, 0)]

    output = {
        "success": result.get("success", False),
        "dryRun": result.get("dryRun", dry_run),
        "moviesRoot": result.get("moviesRoot"),
        "moviesScanned": result.get("moviesScanned", 0),
        "moviesChanged": result.get("moviesChanged", 0),
        "actionsShown": len(shown_actions),
        "actionsTotal": len(actions),
        "actions": shown_actions,
    }

    if result.get("error"):
        output["error"] = result["error"]

    print(json.dumps(output, indent=2))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())

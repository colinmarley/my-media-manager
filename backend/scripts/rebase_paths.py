#!/usr/bin/env python3
"""Rewrite a path prefix in the stored file paths (for moving the library or ingest root).

Usage (from backend/):
    python scripts/rebase_paths.py --from /ark/media/jellyfin/ingest --to /ark/media/ingest
    python scripts/rebase_paths.py --from /ark/media/jellyfin/ingest --to /ark/media/ingest --apply

Dry run by default: prints what would change and any unique-constraint
collisions. ``--apply`` writes the changes in one transaction and refuses to
run while there are collisions.

Columns rewritten:
    ingress_queue.file_path (unique), ingress_queue.ingress_path,
    media_files.file_path (unique), media_files.folder_path,
    ingest_operations.src

Only rows whose value equals the prefix or starts with ``<prefix>/`` change.
Files on disk are not touched.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

# Allow running from the backend/ directory without installing the package.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# table -> columns to rewrite
REBASE_COLUMNS: Dict[str, Tuple[str, ...]] = {
    "ingress_queue": ("file_path", "ingress_path"),
    "media_files": ("file_path", "folder_path"),
    "ingest_operations": ("src",),
}
# (table, column) pairs carrying a unique constraint
UNIQUE_COLUMNS: Tuple[Tuple[str, str], ...] = (
    ("ingress_queue", "file_path"),
    ("media_files", "file_path"),
)


@dataclass(frozen=True)
class PathChange:
    table: str
    row_id: str
    column: str
    old: str
    new: str


@dataclass(frozen=True)
class Collision:
    table: str
    column: str
    value: str
    row_ids: Tuple[str, ...]


@dataclass
class RebasePlan:
    changes: List[PathChange] = field(default_factory=list)
    collisions: List[Collision] = field(default_factory=list)

    def counts(self) -> Dict[str, int]:
        out: Dict[str, int] = defaultdict(int)
        for change in self.changes:
            out[f"{change.table}.{change.column}"] += 1
        return dict(out)


def _clean_prefix(prefix: str) -> str:
    text = (prefix or "").strip()
    stripped = text.rstrip("/")
    return stripped or text


def rebase_value(value: Optional[str], from_prefix: str, to_prefix: str) -> Optional[str]:
    """``value`` with ``from_prefix`` replaced by ``to_prefix``, or None when it does not start with it."""
    if not value:
        return None
    old = _clean_prefix(from_prefix)
    new = _clean_prefix(to_prefix)
    if not old:
        return None
    if value == old:
        return new
    head = old if old.endswith("/") else old + "/"
    if not value.startswith(head):
        return None
    tail = value[len(head):]
    return f"{new.rstrip('/')}/{tail}" if new != "/" else f"/{tail}"


def plan_rebase(
    rows: Mapping[str, Iterable[Mapping[str, Optional[str]]]],
    from_prefix: str,
    to_prefix: str,
    columns: Mapping[str, Sequence[str]] = REBASE_COLUMNS,
    unique_columns: Iterable[Tuple[str, str]] = UNIQUE_COLUMNS,
) -> RebasePlan:
    """Plan the rewrite. ``rows`` maps table -> row dicts with ``id`` and the path columns.

    A collision is any value of a unique column held by more than one row
    once the plan is applied: two rewritten rows landing on one path, or a
    rewritten row landing on a path another (unchanged) row already has.
    """
    plan = RebasePlan()
    materialized = {table: [dict(row) for row in table_rows] for table, table_rows in rows.items()}

    for table, table_rows in materialized.items():
        for row in table_rows:
            for column in columns.get(table, ()):
                new_value = rebase_value(row.get(column), from_prefix, to_prefix)
                if new_value is None or new_value == row.get(column):
                    continue
                plan.changes.append(
                    PathChange(table=table, row_id=str(row["id"]), column=column,
                               old=str(row[column]), new=new_value)
                )

    changed = {(c.table, c.row_id, c.column): c.new for c in plan.changes}
    for table, column in unique_columns:
        holders: Dict[str, List[str]] = defaultdict(list)
        for row in materialized.get(table, []):
            row_id = str(row["id"])
            final = changed.get((table, row_id, column), row.get(column))
            if final:
                holders[final].append(row_id)
        touched = {c.new for c in plan.changes if c.table == table and c.column == column}
        for value, row_ids in sorted(holders.items()):
            if len(row_ids) > 1 and value in touched:
                plan.collisions.append(
                    Collision(table=table, column=column, value=value, row_ids=tuple(sorted(row_ids)))
                )
    return plan


def format_plan(plan: RebasePlan, limit: int = 50) -> str:
    lines = [f"{len(plan.changes)} value(s) to rewrite"]
    for key, count in sorted(plan.counts().items()):
        lines.append(f"  {key}: {count}")
    for change in plan.changes[:limit]:
        lines.append(f"  {change.table}.{change.column} [{change.row_id}]: {change.old} -> {change.new}")
    if len(plan.changes) > limit:
        lines.append(f"  ... {len(plan.changes) - limit} more")
    if plan.collisions:
        lines.append(f"{len(plan.collisions)} unique-constraint collision(s):")
        for collision in plan.collisions:
            lines.append(
                f"  {collision.table}.{collision.column} = {collision.value} "
                f"(rows {', '.join(collision.row_ids)})"
            )
    else:
        lines.append("No unique-constraint collisions.")
    return "\n".join(lines)


async def _load_rows(session, columns: Mapping[str, Sequence[str]]) -> Dict[str, List[Dict[str, Optional[str]]]]:
    from sqlalchemy import text  # pylint: disable=import-outside-toplevel

    rows: Dict[str, List[Dict[str, Optional[str]]]] = {}
    for table, table_columns in columns.items():
        result = await session.execute(text(f"SELECT id, {', '.join(table_columns)} FROM {table}"))
        rows[table] = [dict(mapping) for mapping in result.mappings().all()]
    return rows


async def _apply(session, plan: RebasePlan) -> None:
    from sqlalchemy import text  # pylint: disable=import-outside-toplevel

    for change in plan.changes:
        await session.execute(
            text(f"UPDATE {change.table} SET {change.column} = :new WHERE id = :id AND {change.column} = :old"),
            {"new": change.new, "id": change.row_id, "old": change.old},
        )
    await session.commit()


async def run(from_prefix: str, to_prefix: str, apply: bool) -> int:
    from db.database import AsyncSessionLocal, engine  # pylint: disable=import-outside-toplevel

    try:
        async with AsyncSessionLocal() as session:
            rows = await _load_rows(session, REBASE_COLUMNS)
            plan = plan_rebase(rows, from_prefix, to_prefix)
            print(format_plan(plan))
            if not apply:
                print("Dry run: nothing written. Re-run with --apply to write.")
                return 0
            if plan.collisions:
                print("Refusing to apply while there are collisions.")
                return 2
            if not plan.changes:
                print("Nothing to apply.")
                return 0
            await _apply(session, plan)
            print(f"Applied {len(plan.changes)} change(s).")
            return 0
    finally:
        await engine.dispose()


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Rewrite a path prefix in stored file paths")
    parser.add_argument("--from", dest="from_prefix", required=True, help="Prefix to replace")
    parser.add_argument("--to", dest="to_prefix", required=True, help="Replacement prefix")
    parser.add_argument("--apply", action="store_true", help="Write the changes (default: dry run)")
    args = parser.parse_args(argv)
    if not _clean_prefix(args.from_prefix) or not _clean_prefix(args.to_prefix):
        parser.error("--from and --to must be non-empty")
    if _clean_prefix(args.from_prefix) == _clean_prefix(args.to_prefix):
        parser.error("--from and --to are the same prefix")
    return asyncio.run(run(args.from_prefix, args.to_prefix, args.apply))


if __name__ == "__main__":
    sys.exit(main())

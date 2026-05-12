"""
Migrate Firestore collections to PostgreSQL.

Usage (from backend/ with venv active):
    python3 scripts/migrate_from_firestore.py

Requires firebase-admin:
    pip install firebase-admin

Collections migrated: movies, series, discs
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# ── Firebase setup ──────────────────────────────────────────────────────────
import firebase_admin
from firebase_admin import credentials, firestore

SERVICE_ACCOUNT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "media-db-service-account.json",
)

cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
firebase_admin.initialize_app(cred)
fs_client = firestore.client()

# ── SQLAlchemy setup ────────────────────────────────────────────────────────
from sqlalchemy import select
from db.database import AsyncSessionLocal, engine, Base
from db.models import Movie, Series, Disc


# ── Helpers ─────────────────────────────────────────────────────────────────

def _sanitize(obj):
    """Recursively convert Firestore-specific types to JSON-serialisable values."""
    import datetime
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, datetime.datetime):
        return obj.isoformat()
    if isinstance(obj, datetime.date):
        return obj.isoformat()
    return obj


def _str(doc: dict, *keys: str) -> str | None:
    for k in keys:
        v = doc.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _external_imdb(doc: dict) -> str | None:
    ext = doc.get("externalIds") or {}
    return _str(ext, "imdbId") or _str(doc, "imdbId", "imdb_id")


def _fetch_collection(collection_name: str) -> list[dict]:
    """Fetch all documents from a Firestore collection."""
    print(f"  Fetching '{collection_name}' from Firestore …", end=" ", flush=True)
    docs = fs_client.collection(collection_name).stream()
    result = []
    for doc in docs:
        data = doc.to_dict() or {}
        data.setdefault("id", doc.id)
        result.append(data)
    print(f"{len(result)} docs")
    return result


# ── Per-collection upsert logic ──────────────────────────────────────────────

async def migrate_movies(session, docs: list[dict]) -> None:
    inserted = updated = skipped = 0
    for doc in docs:
        doc_id = doc.get("id") or doc.get("titleLower") or doc.get("title")
        if not doc_id:
            skipped += 1
            continue

        result = await session.execute(select(Movie).where(Movie.id == doc_id))
        row = result.scalar_one_or_none()

        if row is None:
            row = Movie(id=doc_id)
            session.add(row)
            inserted += 1
        else:
            updated += 1

        row.title        = _str(doc, "title") or "Untitled"
        row.release_date = _str(doc, "releaseDate", "release_date")
        row.runtime      = _str(doc, "runtime")
        row.imdb_id      = _external_imdb(doc)
        row.raw_data     = _sanitize(doc)

    await session.commit()
    print(f"    Movies  → inserted={inserted}  updated={updated}  skipped={skipped}")


async def migrate_series(session, docs: list[dict]) -> None:
    inserted = updated = skipped = 0
    for doc in docs:
        doc_id = doc.get("id") or doc.get("titleLower") or doc.get("title")
        if not doc_id:
            skipped += 1
            continue

        result = await session.execute(select(Series).where(Series.id == doc_id))
        row = result.scalar_one_or_none()

        if row is None:
            row = Series(id=doc_id)
            session.add(row)
            inserted += 1
        else:
            updated += 1

        row.title    = _str(doc, "title") or "Untitled"
        row.imdb_id  = _external_imdb(doc)
        row.status   = _str(doc, "status")
        row.network  = _str(doc, "network")
        row.raw_data = _sanitize(doc)

    await session.commit()
    print(f"    Series  → inserted={inserted}  updated={updated}  skipped={skipped}")


async def migrate_discs(session, docs: list[dict]) -> None:
    inserted = updated = skipped = 0
    for doc in docs:
        doc_id = doc.get("id")
        if not doc_id:
            skipped += 1
            continue

        result = await session.execute(select(Disc).where(Disc.id == doc_id))
        row = result.scalar_one_or_none()

        if row is None:
            row = Disc(id=doc_id)
            session.add(row)
            inserted += 1
        else:
            updated += 1

        row.title    = _str(doc, "title") or "Untitled"
        row.format   = _str(doc, "format")
        row.raw_data = _sanitize(doc)

    await session.commit()
    print(f"    Discs   → inserted={inserted}  updated={updated}  skipped={skipped}")


# ── Main ─────────────────────────────────────────────────────────────────────

async def main() -> None:
    print("Creating tables if missing …")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("  Done.\n")

    print("Fetching data from Firestore …")
    movie_docs  = _fetch_collection("movies")
    series_docs = _fetch_collection("series")
    disc_docs   = _fetch_collection("discs")
    print()

    print("Inserting into PostgreSQL …")
    async with AsyncSessionLocal() as session:
        await migrate_movies(session, movie_docs)
        await migrate_series(session, series_docs)
        await migrate_discs(session, disc_docs)

    print("\nMigration complete.")


if __name__ == "__main__":
    asyncio.run(main())

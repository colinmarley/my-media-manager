"""
One-time script to set (or reset) the app access passphrase.

Usage (from backend/ with venv active):
    python3 scripts/seed_password.py

The script prompts for the passphrase interactively so it is never stored in
shell history.
"""

import asyncio
import getpass
import sys
import os

# Allow running from the backend/ directory without installing the package.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import bcrypt
from sqlalchemy import select
from db.database import AsyncSessionLocal, engine, Base
from db.models import AppConfig


async def seed() -> None:
    password = getpass.getpass("New passphrase: ")
    if not password:
        print("Passphrase cannot be empty.")
        sys.exit(1)
    confirm = getpass.getpass("Confirm passphrase: ")
    if password != confirm:
        print("Passphrases do not match.")
        sys.exit(1)

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    # Ensure tables exist before writing
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(AppConfig).where(AppConfig.key == "password_hash"))
        existing = result.scalar_one_or_none()
        if existing:
            existing.value = hashed
        else:
            db.add(AppConfig(key="password_hash", value=hashed))
        await db.commit()

    print("Password hash stored successfully.")


if __name__ == "__main__":
    asyncio.run(seed())

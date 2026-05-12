"""
Global pytest configuration for the backend test suite.

This file is executed by pytest before any test module is imported.
It sets environment variables that point the application settings at the
isolated TEST database, so the test suite can NEVER connect to the
production database — even by accident.

Unit tests (the current suite) mock get_db entirely, so no real database
connection is made at all.  Integration tests (marked with @pytest.mark.integration)
use the test database started by `make test-integration` / docker-compose.test.yml.
"""

import os

# ---------------------------------------------------------------------------
# Guard: redirect the database URL to the test database BEFORE any app
# module is loaded.  pydantic-settings gives env vars higher priority than
# .env files, so this always wins.
# ---------------------------------------------------------------------------

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://media_user:test_password@localhost:5433/media_manager_test",
)

# Use a throwaway secret key — session tokens issued during tests must never
# be accepted by the production database.
os.environ.setdefault(
    "MEDIA_LIBRARY_SESSION_SECRET_KEY",
    "test-only-secret-key-do-not-use-in-production",
)

# =============================================================================
# Makefile  —  Developer workflow commands
#
# Three environments, zero accidents:
#
#   make test              Frontend + backend unit tests  (no database needed)
#   make test-integration  Spin up test DB, run all backend tests, tear down
#   make dev-db            Start a local dev database on port 5432
#   make docker-up         Start the full PRODUCTION stack (Docker only)
#
# See docs/TESTING.md for the full workflow guide.
# =============================================================================

.PHONY: test test-backend test-frontend \
        test-db-up test-db-down test-integration \
        dev-db \
	reset-library-to-ingest \
        docker-up docker-down \
        help

# Path to the Python interpreter inside the backend virtualenv
PYTHON := backend/venv/bin/python

# ── Help ──────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "  test              Run all unit tests (frontend + backend, no DB required)"
	@echo "  test-frontend     Run frontend (vitest) unit tests only"
	@echo "  test-backend      Run backend (pytest) unit tests only"
	@echo "  test-integration  Start test DB, run backend tests, stop test DB"
	@echo "  test-db-up        Start the isolated test database container"
	@echo "  test-db-down      Stop and wipe the test database container"
	@echo ""
	@echo "  dev-db            Start a local development database on port 5432"
	@echo "  reset-library-to-ingest  Move Jellyfin Movies/TV Shows back to ingest and wipe library catalog"
	@echo ""
	@echo "  docker-up         Start the production stack (Docker)"
	@echo "  docker-down       Stop the production stack"
	@echo ""

# ── Unit Tests (no real database needed) ─────────────────────────────────────

test-frontend:
	npx vitest run

test-backend:
	cd backend && $(CURDIR)/$(PYTHON) -m pytest tests/ -v

test: test-frontend test-backend

# ── Integration Tests (require the test database) ─────────────────────────────

test-db-up:
	docker compose -f docker-compose.test.yml up -d --wait
	@echo "Test database is ready on port 5433."

test-db-down:
	docker compose -f docker-compose.test.yml down -v
	@echo "Test database stopped and wiped."

test-integration: test-db-up
	cd backend && $(CURDIR)/$(PYTHON) -m pytest tests/ -v
	$(MAKE) test-db-down

# ── Local Development ─────────────────────────────────────────────────────────

dev-db:
	@echo "Starting development database on port 5432..."
	docker compose up postgres -d
	@echo "Dev database is ready. Connect with:"
	@echo "  postgresql://media_user:changeme_strong_password@localhost:5432/media_manager"

reset-library-to-ingest:
	bash scripts/reset-library-to-ingest.sh --yes

# ── Production (Docker only) ──────────────────────────────────────────────────

docker-up:
	docker compose up -d

docker-down:
	docker compose down

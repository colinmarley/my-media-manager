# Testing Environment Guide

## Overview

The project uses **three isolated environments**, each with its own database and configuration. Tests and local development never share data, and production is only reachable through Docker.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Environment   │  Database              │  Port  │  How started     │
├────────────────┼────────────────────────┼────────┼──────────────────┤
│  test          │  media_manager_test    │  5433  │  make test-*     │
│  dev           │  media_manager         │  5432  │  make dev-db     │
│  production    │  media_manager (Docker)│  5432  │  make docker-up  │
└─────────────────────────────────────────────────────────────────────┘
```

**The production database is only ever used when the stack runs via Docker.**  
Running `pytest` or `npm test` locally can never touch production data.

---

## How It Works

### Why tests never reach the production database

1. `docker-compose.yml` injects `DATABASE_URL` directly as a container environment variable, pointing to the Postgres service inside the Docker network. This only has effect when Docker starts the backend.

2. Outside Docker, `backend/tests/conftest.py` is the **first** thing pytest loads. It calls `os.environ.setdefault("DATABASE_URL", "...localhost:5433/media_manager_test")` before any application module is imported. pydantic-settings gives env vars higher priority than `.env` files, so the test value always wins.

3. The **current unit tests** mock `get_db` entirely — no real database connection is made. The `DATABASE_URL` guard in `conftest.py` is a safety net for future integration tests.

### Environment config files

| File | Purpose |
|------|---------|
| `backend/.env` | Local dev settings (create from `.env.example`, never commit) |
| `backend/.env.test` | Test settings reference — values are applied via `conftest.py` |
| `backend/.env.example` | Template; safe to commit |
| `docker-compose.yml` | Production — injects env vars directly, no `.env` file read |
| `docker-compose.test.yml` | Ephemeral test database — data wiped on `down` |

---

## Quick-Start: Running Tests

### Frontend (Vitest) — no database required

```bash
npm test
# or
make test-frontend
```

Frontend tests run in a jsdom environment and mock all API calls — no backend or database needed.

### Backend unit tests — no database required

```bash
cd backend
source venv/bin/activate
python -m pytest tests/ -v

# or from the project root:
make test-backend
```

The unit tests mock `get_db` so the database URL is never actually used. They run anywhere, any time.

### All unit tests in one command

```bash
make test
```

### Backend integration tests — requires the test database

Integration tests exercise real SQL queries. Start the test database first:

```bash
# Start isolated test Postgres (port 5433, in-memory)
make test-db-up

# Run the full backend test suite
make test-backend

# Stop and wipe the test database
make test-db-down

# Or run all three steps in one go:
make test-integration
```

The test database lives in a Docker `tmpfs` mount (RAM-backed) and is automatically wiped when the container stops — no manual cleanup required.

### End-to-end (Playwright) — needs a running app

Playwright drives a **live deployment**; it does not start one, because `webServer` cannot bootstrap the Postgres + backend + frontend stack. Two env vars control it:

| Variable | What it is | Default |
|---|---|---|
| `BASE_URL` | the app under test | `http://localhost:3010` — the `docker-compose.yml` frontend, published on `${FRONTEND_PORT:-3010}` |
| `E2E_PASSWORD` | the passphrase the specs sign in with | `APP_DEFAULT_PASSWORD` from `docker-compose.yml` |

Two suites with very different blast radii:

| Suite | What it touches | Safe against |
|---|---|---|
| `e2e/smoke/` | read-only: login, my library, one title's detail page, physical media, and opening then cancelling the disc edit dialog | any environment, including production — the dialog step fails the run if a `POST`/`PUT`/`PATCH`/`DELETE` leaves the browser |
| `e2e/write/` | creates and deletes its own physical-media and catalog records | a local or throwaway stack only |

```bash
# smoke suite — read-only
E2E_PASSWORD='the-app-passphrase' npm run test:e2e:smoke

# smoke + write — mutating, never against a shared instance
E2E_PASSWORD='the-app-passphrase' npm run test:e2e

# one spec, headed, while debugging
npx playwright test e2e/smoke/detail-and-disc-edit.spec.ts --headed
```

`npm run test:e2e:smoke` exits non-zero when any spec fails — including when `BASE_URL` is unreachable, which Playwright reports as a failed navigation — so QA can gate on the exit code.

#### Node >= 20

`@playwright/test` 1.62 declares `engines.node: ">=20"`. The factory host (ai-workstation) still runs Node 18, so it has to move to Node 20 or newer before the smoke suite runs there:

```bash
node --version                     # must print v20 or newer
npx playwright install chromium    # once per host: downloads the browser build
```

#### Reaching the app through an SSH tunnel

QA usually runs on a machine that is not the app host, and the app is only reachable on its own LAN. Forward the app's frontend port to the QA machine and point `BASE_URL` at the tunnel:

```bash
# on the QA machine — no remote shell, local 3010 -> app host's 3010
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:3010:127.0.0.1:3010 <user>@192.168.0.227

# in a second shell, run the suite through the tunnel
BASE_URL=http://127.0.0.1:3010 E2E_PASSWORD='the-app-passphrase' npm run test:e2e:smoke
```

- `192.168.0.227` is the box running `docker-compose.yml` — the same host `docs/api/endpoints.md` scrapes metrics from. Keep both sides of `-L` on `3010` unless `FRONTEND_PORT` is overridden.
- Bind the forward to `127.0.0.1` as shown, so the tunnel does not listen on the QA machine's LAN interface.
- Keep the tunnel up for the whole run; a dropped tunnel shows up as navigation failures, never as a pass.

---

## Local Development (non-Docker)

Start only the dev Postgres (port 5432):

```bash
make dev-db
```

Create your backend `.env` from the example and point it at the dev database:

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and set DATABASE_URL to:
# postgresql+asyncpg://media_user:changeme_strong_password@localhost:5432/media_manager
```

Run the backend locally:

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8082
```

Run the frontend:

```bash
npm run dev
```

---

## Production (Docker only)

```bash
make docker-up    # starts postgres + backend containers
make docker-down  # stops them
```

`docker-compose.yml` sets `DATABASE_URL` directly in the `backend` service's `environment` block, pointing to the `postgres` service inside the Docker network. No `.env` file is read or needed in production. The backend never connects to `localhost:5433` (the test port) or any environment file.

**Never run `make docker-up` with a `backend/.env` that contains a different `DATABASE_URL`** — Docker's explicit `environment:` key always wins, so the `.env` file has no effect inside the container. The concern is moot, but worth understanding.

---

## Adding Integration Tests

Mark any test that needs a real database with `@pytest.mark.integration`:

```python
import pytest

@pytest.mark.integration
async def test_list_movies_from_db(app):
    # This test will connect to localhost:5433/media_manager_test
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/api/catalog/movies")
    assert resp.status_code == 200
```

Run only integration tests:

```bash
make test-db-up
cd backend && venv/bin/python -m pytest tests/ -v -m integration
make test-db-down
```

Run only unit tests (skipping integration):

```bash
cd backend && venv/bin/python -m pytest tests/ -v -m "not integration"
```

Add this to `pytest.ini` to register the marker and suppress warnings:

```ini
[pytest]
asyncio_mode = auto
testpaths = tests
markers =
    integration: marks tests that require a real database (deselect with -m "not integration")
```

---

## Environment Variable Reference

| Variable | Test value (`conftest.py`) | Dev value (`.env`) | Prod value (`docker-compose.yml`) |
|---|---|---|---|
| `DATABASE_URL` | `...localhost:5433/media_manager_test` | `...localhost:5432/media_manager` | `...postgres:5432/media_manager` |
| `MEDIA_LIBRARY_SESSION_SECRET_KEY` | `test-only-secret-key` | your chosen secret | set in `.env` or secrets manager |

The hostname `postgres` in the production URL is the Docker Compose service name, not `localhost`. This is the key reason the backend container cannot accidentally reach any database that is not defined in `docker-compose.yml`.

---

## CI/CD

In a CI pipeline (GitHub Actions, etc.), override `DATABASE_URL` via a workflow environment variable to point at whatever service container the pipeline provides. `conftest.py` uses `os.environ.setdefault`, so a pre-set env var from the CI environment always takes precedence.

```yaml
# .github/workflows/test.yml (example)
env:
  DATABASE_URL: postgresql+asyncpg://media_user:test_password@localhost:5433/media_manager_test

services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_DB: media_manager_test
      POSTGRES_USER: media_user
      POSTGRES_PASSWORD: test_password
    ports:
      - 5433:5432
```

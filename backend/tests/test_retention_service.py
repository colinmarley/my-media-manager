"""
Tests for the data retention job (services/retention_service.py, issue #18).

Uses a mocked AsyncSession — no database connection is made. Statements the
job executes are captured and compiled with the PostgreSQL dialect so their
tables, filters and cutoffs can be asserted.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import postgresql

NOW = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)


def _session_factory(rowcount=3):
    db = AsyncMock()
    executed = []

    async def fake_execute(stmt):
        executed.append(stmt)
        result = MagicMock()
        result.rowcount = rowcount
        result.scalar.return_value = rowcount
        return result

    db.execute = AsyncMock(side_effect=fake_execute)
    db.commit = AsyncMock()

    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=db)
    factory.return_value.__aexit__ = AsyncMock(return_value=False)
    return factory, db, executed


def _compiled(stmt):
    return stmt.compile(dialect=postgresql.dialect())


def _by_table(executed):
    out = {}
    for stmt in executed:
        sql = str(_compiled(stmt))
        for table in ("ingress_processing_history", "ingress_queue", "mobile_tokens", "sessions"):
            if table in sql:
                out[table] = stmt
                break
    return out


class TestRunRetention:
    @pytest.mark.asyncio
    async def test_deletes_every_target_and_commits(self):
        from services.retention_service import run_retention

        factory, db, executed = _session_factory(rowcount=3)
        counts = await run_retention(
            factory, now=NOW, dry_run=False, history_days=180, completed_queue_days=90
        )

        assert counts == {
            "sessions": 3,
            "mobile_tokens": 3,
            "ingress_processing_history": 3,
            "ingress_queue_completed": 3,
        }
        assert len(executed) == 4
        assert all(str(_compiled(s)).startswith("DELETE FROM") for s in executed)
        db.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_cutoffs_use_configured_day_counts(self):
        from services.retention_service import run_retention

        factory, _db, executed = _session_factory()
        await run_retention(factory, now=NOW, dry_run=False, history_days=180, completed_queue_days=90)
        stmts = _by_table(executed)

        assert set(stmts) == {"sessions", "mobile_tokens", "ingress_processing_history", "ingress_queue"}
        assert NOW in _compiled(stmts["sessions"]).params.values()
        assert NOW in _compiled(stmts["mobile_tokens"]).params.values()
        assert NOW - timedelta(days=180) in _compiled(stmts["ingress_processing_history"]).params.values()
        assert NOW - timedelta(days=90) in _compiled(stmts["ingress_queue"]).params.values()

    @pytest.mark.asyncio
    async def test_queue_delete_only_targets_completed_items(self):
        from services.retention_service import run_retention

        factory, _db, executed = _session_factory()
        await run_retention(factory, now=NOW, dry_run=False, history_days=180, completed_queue_days=90)
        compiled = _compiled(_by_table(executed)["ingress_queue"])
        sql = str(compiled)

        assert "ingress_queue.status = " in sql
        statuses = [v for v in compiled.params.values() if isinstance(v, str)]
        assert statuses == ["completed"]
        assert "needs_review" not in sql and "failed" not in sql

    @pytest.mark.asyncio
    async def test_dry_run_counts_without_deleting(self):
        from services.retention_service import run_retention

        factory, db, executed = _session_factory(rowcount=7)
        counts = await run_retention(
            factory, now=NOW, dry_run=True, history_days=180, completed_queue_days=90
        )

        assert set(counts.values()) == {7}
        assert all(str(_compiled(s)).startswith("SELECT count(*)") for s in executed)
        db.commit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_logs_counts(self, monkeypatch):
        import services.retention_service as retention

        log = MagicMock()
        monkeypatch.setattr(retention, "logger", log)
        factory, _db, _executed = _session_factory(rowcount=2)

        await retention.run_retention(factory, now=NOW, dry_run=True)
        message, = log.info.call_args.args
        assert "would be deleted" in message
        assert log.info.call_args.kwargs["dry_run"] is True
        assert log.info.call_args.kwargs["sessions"] == 2

        await retention.run_retention(factory, now=NOW, dry_run=False)
        assert "deleted" in log.info.call_args.args[0]
        assert log.info.call_args.kwargs["dry_run"] is False

    @pytest.mark.asyncio
    async def test_settings_drive_defaults(self, monkeypatch):
        import services.retention_service as retention

        monkeypatch.setattr(retention.settings, "retention_dry_run", True)
        monkeypatch.setattr(retention.settings, "retention_ingress_history_days", 10)
        monkeypatch.setattr(retention.settings, "retention_completed_queue_days", 5)
        factory, db, executed = _session_factory()

        await retention.run_retention(factory, now=NOW)
        stmts = _by_table(executed)

        db.commit.assert_not_awaited()
        assert NOW - timedelta(days=10) in _compiled(stmts["ingress_processing_history"]).params.values()
        assert NOW - timedelta(days=5) in _compiled(stmts["ingress_queue"]).params.values()


class TestSettings:
    def test_defaults(self):
        from config.settings import LibrarySettings

        s = LibrarySettings()
        assert s.retention_enabled is True
        assert s.retention_dry_run is False
        assert s.retention_interval_hours == 24
        assert s.retention_ingress_history_days == 180
        assert s.retention_completed_queue_days == 90

    def test_env_overrides(self, monkeypatch):
        from config.settings import LibrarySettings

        monkeypatch.setenv("MEDIA_LIBRARY_RETENTION_DRY_RUN", "true")
        monkeypatch.setenv("MEDIA_LIBRARY_RETENTION_INGRESS_HISTORY_DAYS", "30")
        monkeypatch.setenv("MEDIA_LIBRARY_RETENTION_COMPLETED_QUEUE_DAYS", "14")
        s = LibrarySettings()
        assert s.retention_dry_run is True
        assert s.retention_ingress_history_days == 30
        assert s.retention_completed_queue_days == 14


class TestRetentionLoop:
    @pytest.mark.asyncio
    async def test_runs_immediately_then_daily_and_survives_errors(self, monkeypatch):
        import services.retention_service as retention

        run = AsyncMock(side_effect=[RuntimeError("db down"), {}, asyncio.CancelledError()])
        sleeps = []

        async def fake_sleep(seconds):
            sleeps.append(seconds)

        monkeypatch.setattr(retention, "run_retention", run)
        monkeypatch.setattr(retention.asyncio, "sleep", fake_sleep)

        with pytest.raises(asyncio.CancelledError):
            await retention.run_retention_loop(MagicMock(), interval_hours=24)

        assert run.await_count == 3
        assert sleeps == [24 * 3600, 24 * 3600]


class TestLifespanWiring:
    def test_main_schedules_retention_loop(self):
        import inspect

        import main
        from services.retention_service import run_retention_loop

        assert main.run_retention_loop is run_retention_loop
        source = inspect.getsource(main.lifespan)
        assert "settings.retention_enabled" in source
        assert "run_retention_loop(AsyncSessionLocal)" in source

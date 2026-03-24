"""Tests for the Chapel Ridge obituary scraper duplicate-detection logic."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app, obits_db


@pytest.fixture(autouse=True)
def _clear_db():
    """Reset the in-memory store before each test."""
    obits_db.clear()
    yield
    obits_db.clear()


def _make_mock_response(records: list[dict]) -> MagicMock:
    """Build a mock httpx.Response matching the FrontRunnerPro shape."""
    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"success": True, "data": records}
    return mock_resp


SAMPLE_RECORDS = [
    {"name": "Alice Smith", "dod": "2026-03-01", "url": "https://example.com/alice"},
    {"name": "Bob Jones", "dod": "2026-03-05", "url": "https://example.com/bob"},
]


def _scrape(client, records):
    """Run a scrape request with mocked upstream returning *records*."""
    mock_resp = _make_mock_response(records)

    async def fake_post(*args, **kwargs):
        return mock_resp

    with patch("app.routers.scrape_chapelridge.httpx.AsyncClient") as mock_cls:
        instance = AsyncMock()
        instance.post = AsyncMock(return_value=mock_resp)
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        return client.post("/api/obits/scrape/chapelridge/")


class TestDeduplication:
    """Verify that scraper skips records already present in obits_db."""

    def test_first_scrape_inserts_all(self):
        client = TestClient(app)
        resp = _scrape(client, SAMPLE_RECORDS)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert len(obits_db) == 2

    def test_second_scrape_skips_duplicates(self):
        client = TestClient(app)

        first = _scrape(client, SAMPLE_RECORDS)
        assert len(first.json()) == 2

        second = _scrape(client, SAMPLE_RECORDS)
        assert len(second.json()) == 0
        assert len(obits_db) == 2  # no new records added

    def test_partial_overlap_inserts_only_new(self):
        client = TestClient(app)

        _scrape(client, [SAMPLE_RECORDS[0]])
        assert len(obits_db) == 1

        resp = _scrape(client, SAMPLE_RECORDS)
        data = resp.json()
        assert len(data) == 1
        assert data[0]["deceased_name"] == "Bob Jones"
        assert len(obits_db) == 2

    def test_same_name_different_dod_not_duplicate(self):
        """Two people with the same name but different dates are distinct."""
        client = TestClient(app)
        records = [
            {"name": "Alice Smith", "dod": "2026-03-01", "url": ""},
            {"name": "Alice Smith", "dod": "2026-03-10", "url": ""},
        ]
        resp = _scrape(client, records)
        assert len(resp.json()) == 2
        assert len(obits_db) == 2

    def test_same_dod_different_name_not_duplicate(self):
        """Two people with the same date but different names are distinct."""
        client = TestClient(app)
        records = [
            {"name": "Alice Smith", "dod": "2026-03-01", "url": ""},
            {"name": "Bob Jones", "dod": "2026-03-01", "url": ""},
        ]
        resp = _scrape(client, records)
        assert len(resp.json()) == 2
        assert len(obits_db) == 2

    def test_duplicates_within_same_batch(self):
        """If upstream returns duplicates in a single batch, only insert once."""
        client = TestClient(app)
        records = [
            {"name": "Alice Smith", "dod": "2026-03-01", "url": ""},
            {"name": "Alice Smith", "dod": "2026-03-01", "url": ""},
        ]
        resp = _scrape(client, records)
        assert len(resp.json()) == 1
        assert len(obits_db) == 1

import asyncio
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import main


class FakePool:
    """Stands in for the asyncpg connection pool."""

    def __init__(self, total=0, buckets=None, referers=None, fail=False):
        self.total = total
        self.buckets = buckets or []
        self.referers = referers or []
        self.fail = fail
        self.executed = []
        self.fetch_args = []

    async def execute(self, query, *args):
        if self.fail:
            raise RuntimeError("database down")
        self.executed.append(args)

    async def fetchval(self, query, *args):
        return self.total

    async def fetch(self, query, *args):
        self.fetch_args.append(args)
        return self.buckets if "time_bucket" in query else self.referers


class FakeProcess:
    """Mimics aio_pika's message.process(): ack on success, reject on error."""

    def __init__(self, message):
        self.message = message

    async def __aenter__(self):
        return self.message

    async def __aexit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.message.acked = True
        else:
            self.message.rejected = True
        return False


class FakeMessage:
    def __init__(self, body: bytes):
        self.body = body
        self.acked = False
        self.rejected = False

    def process(self, requeue=False):
        return FakeProcess(self)


def valid_event(**overrides):
    event = {
        "shortCode": "abc1234",
        "timestamp": "2026-10-24T13:00:00.000Z",
        "userAgent": "test-agent",
        "referer": None,
        "ip": "10.0.0.1",
    }
    event.update(overrides)
    return json.dumps(event).encode()


def test_valid_click_event_is_stored_and_acknowledged(monkeypatch):
    pool = FakePool()
    monkeypatch.setitem(main.state, "pool", pool)
    message = FakeMessage(valid_event())

    asyncio.run(main.handle_message(message))

    assert message.acked
    assert pool.executed == [
        (datetime(2026, 10, 24, 13, 0, tzinfo=timezone.utc), "abc1234", "test-agent", None, "10.0.0.1")
    ]


@pytest.mark.parametrize(
    "body",
    [
        b"this is not json",
        json.dumps({"timestamp": "2026-10-24T13:00:00Z"}).encode(),  # missing shortCode
        json.dumps({"shortCode": "abc1234"}).encode(),  # missing timestamp
        json.dumps({"shortCode": "abc1234", "timestamp": "yesterday-ish"}).encode(),  # bad timestamp
    ],
)
def test_malformed_events_are_dropped_not_retried(monkeypatch, body):
    pool = FakePool()
    monkeypatch.setitem(main.state, "pool", pool)
    message = FakeMessage(body)

    asyncio.run(main.handle_message(message))

    assert pool.executed == []
    assert message.acked  # acknowledged so it is not redelivered forever
    assert not message.rejected


def test_database_failure_rejects_the_message_so_it_is_requeued(monkeypatch):
    monkeypatch.setitem(main.state, "pool", FakePool(fail=True))
    message = FakeMessage(valid_event())

    with pytest.raises(RuntimeError):
        asyncio.run(main.handle_message(message))

    assert message.rejected
    assert not message.acked


def test_stats_returns_totals_hourly_buckets_and_referers(monkeypatch):
    pool = FakePool(
        total=5,
        buckets=[{"bucket": datetime(2026, 10, 24, 13, 0, tzinfo=timezone.utc), "clicks": 5}],
        referers=[{"referer": "direct", "clicks": 5}],
    )
    monkeypatch.setitem(main.state, "pool", pool)
    client = TestClient(main.app)

    response = client.get("/stats/abc1234?hours=6")

    assert response.status_code == 200
    assert response.json() == {
        "shortCode": "abc1234",
        "totalClicks": 5,
        "clicksPerHour": [{"hour": "2026-10-24T13:00:00+00:00", "clicks": 5}],
        "topReferers": [{"referer": "direct", "clicks": 5}],
    }
    assert ("abc1234", 6) in pool.fetch_args  # the hours parameter reached the query


def test_stats_for_a_code_with_no_clicks_is_all_zeros(monkeypatch):
    monkeypatch.setitem(main.state, "pool", FakePool())
    client = TestClient(main.app)

    response = client.get("/stats/unknown")

    assert response.status_code == 200
    body = response.json()
    assert body["totalClicks"] == 0
    assert body["clicksPerHour"] == []
    assert body["topReferers"] == []


def test_health_endpoint():
    client = TestClient(main.app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "analytics-service"}